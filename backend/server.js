'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
});

// ─── Persistent Session Registry ──────────────────────────────────────────────
// Sessions are identified by a stable user-chosen name, NOT the socket.id.
// This means QR is only scanned once; subsequent browser visits reuse auth.
// Registry format: [{ name: string, createdAt: number }]
const AUTH_DATA_PATH = '/app/.wwebjs_auth';
const SESSIONS_FILE = path.join(AUTH_DATA_PATH, 'registry.json');

function loadRegistry() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        }
    } catch (_) { }
    return [];
}

function saveRegistry(registry) {
    try {
        fs.mkdirSync(AUTH_DATA_PATH, { recursive: true });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(registry, null, 2));
    } catch (err) {
        console.error('Failed to save registry:', err.message);
    }
}

// ─── In-Memory WA Clients ─────────────────────────────────────────────────────
// Map<sessionName, { client: Client, status: string, listeners: Set<socketId> }>
// Clients live independently of socket connections; they are never destroyed on
// socket disconnect so the user does not have to rescan the QR code.
const waClients = new Map();

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, clients: waClients.size }));

// ─── Broadcast an event to every socket subscribed to a session ───────────────
function broadcast(sessionName, event, data) {
    const entry = waClients.get(sessionName);
    if (!entry) return;
    for (const sid of entry.listeners) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit(event, data);
    }
}

// ─── Destroy a WA client safely ───────────────────────────────────────────────
async function destroyClient(sessionName) {
    const entry = waClients.get(sessionName);
    if (!entry) return;
    try { await entry.client.destroy(); } catch (_) { }
    waClients.delete(sessionName);
    console.log(`[${sessionName}] Client destroyed.`);
}

// ─── Create (or return existing) WA client for a session name ─────────────────
async function getOrCreateClient(sessionName) {
    if (waClients.has(sessionName)) {
        return waClients.get(sessionName);
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionName, dataPath: AUTH_DATA_PATH }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        },
    });

    const entry = { client, status: 'initializing', listeners: new Set() };
    waClients.set(sessionName, entry);

    client.on('qr', async (qr) => {
        entry.status = 'qr';
        try {
            const url = await qrcode.toDataURL(qr);
            broadcast(sessionName, 'qr', url);
            console.log(`[${sessionName}] QR sent.`);
        } catch (err) {
            broadcast(sessionName, 'error', { message: 'Failed to generate QR code.' });
        }
    });

    client.on('authenticated', () => {
        entry.status = 'authenticated';
        broadcast(sessionName, 'wa-status', { status: 'authenticated' });
        console.log(`[${sessionName}] Authenticated.`);
    });

    client.on('ready', () => {
        entry.status = 'ready';
        broadcast(sessionName, 'wa-status', { status: 'ready' });
        console.log(`[${sessionName}] Ready.`);
    });

    client.on('auth_failure', (msg) => {
        entry.status = 'auth_failure';
        broadcast(sessionName, 'wa-status', { status: 'auth_failure', reason: msg });
    });

    client.on('disconnected', (reason) => {
        entry.status = 'disconnected';
        broadcast(sessionName, 'wa-status', { status: 'disconnected', reason });
        destroyClient(sessionName);
    });

    // Initialize in background so caller is not blocked waiting for Chromium
    client.initialize().catch((err) => {
        console.error(`[${sessionName}] Initialize error:`, err.message);
        broadcast(sessionName, 'error', { message: 'Failed to start WhatsApp client.' });
        destroyClient(sessionName);
    });

    return entry;
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[${socket.id}] Browser connected.`);
    let currentSession = null; // session name this socket is watching

    function unsubscribe() {
        if (!currentSession) return;
        const entry = waClients.get(currentSession);
        if (entry) entry.listeners.delete(socket.id);
        currentSession = null;
    }

    function subscribe(sessionName) {
        unsubscribe();
        currentSession = sessionName;
        const entry = waClients.get(sessionName);
        if (entry) entry.listeners.add(socket.id);
    }

    // ── List saved sessions ────────────────────────────────────────────────────
    socket.on('list-sessions', () => {
        const registry = loadRegistry();
        const result = registry.map((s) => ({
            name: s.name,
            createdAt: s.createdAt,
            status: waClients.has(s.name) ? waClients.get(s.name).status : 'offline',
        }));
        socket.emit('sessions', result);
    });

    // ── Create a new named session (will ask for QR if no saved auth) ──────────
    socket.on('create-session', async ({ name }) => {
        if (!name || typeof name !== 'string' || !name.trim()) {
            return socket.emit('error', { message: 'Session name is required.' });
        }
        const sessionName = name.trim();

        // Persist to registry if new
        const registry = loadRegistry();
        if (!registry.find((s) => s.name === sessionName)) {
            registry.push({ name: sessionName, createdAt: Date.now() });
            saveRegistry(registry);
        }

        const entry = await getOrCreateClient(sessionName);
        subscribe(sessionName);
        entry.listeners.add(socket.id);

        // If client is already past QR phase, report current status immediately
        if (entry.status === 'ready') {
            socket.emit('wa-status', { status: 'ready' });
        } else if (entry.status === 'authenticated') {
            socket.emit('wa-status', { status: 'authenticated' });
        } else if (entry.status === 'qr') {
            // QR already generated; send it to this socket directly
            // (the next QR event will reach it via broadcast)
        }
    });

    // ── Connect to an existing saved session ───────────────────────────────────
    socket.on('connect-session', async ({ name }) => {
        const registry = loadRegistry();
        if (!registry.find((s) => s.name === name)) {
            return socket.emit('error', { message: 'Session not found.' });
        }

        const entry = await getOrCreateClient(name);
        subscribe(name);
        entry.listeners.add(socket.id);

        // Report current status so the UI can jump straight to 'ready' if cached
        socket.emit('wa-status', { status: entry.status });
    });

    // ── Delete a saved session ─────────────────────────────────────────────────
    socket.on('delete-session', async ({ name }) => {
        await destroyClient(name);
        const registry = loadRegistry().filter((s) => s.name !== name);
        saveRegistry(registry);
        // Remove LocalAuth data on disk
        try {
            fs.rmSync(path.join(AUTH_DATA_PATH, `session-${name}`), { recursive: true, force: true });
        } catch (_) { }
        socket.emit('session-deleted', { name });
        socket.emit('sessions', registry.map((s) => ({
            name: s.name,
            createdAt: s.createdAt,
            status: waClients.has(s.name) ? waClients.get(s.name).status : 'offline',
        })));
    });

    // ── Get chats ──────────────────────────────────────────────────────────────
    // Reads the 5 most recent chats directly from WA's in-memory store — no
    // full chat list fetch, returns in milliseconds.
    socket.on('get-chats', async () => {
        if (!currentSession) return socket.emit('error', { message: 'No active session.' });
        const entry = waClients.get(currentSession);
        if (!entry || entry.status !== 'ready') {
            return socket.emit('error', { message: 'WhatsApp not ready.' });
        }
        try {
            const chats = await entry.client.pupPage.evaluate(() => {
                try {
                    const all = window.Store.Chat.getModelsArray();
                    const sorted = all
                        .filter(c => c && c.id)
                        .sort((a, b) => (b.t || b.timestamp || 0) - (a.t || a.timestamp || 0))
                        .slice(0, 5);
                    return sorted.map(c => ({
                        id: c.id._serialized,
                        name: c.name || c.formattedTitle || c.id.user || '',
                        isGroup: c.isGroup || false,
                        lastMessage: (c.lastMessage && c.lastMessage.body ? c.lastMessage.body : '').slice(0, 80),
                        timestamp: c.t || c.timestamp || 0,
                        unreadCount: c.unreadCount || 0,
                    }));
                } catch (e) {
                    return { storeError: e.message };
                }
            });

            if (chats && chats.storeError) throw new Error(chats.storeError);
            socket.emit('chats', chats || []);
        } catch (err) {
            // Fallback to the standard API if store read fails
            console.warn(`[${currentSession}] store chat read failed (${err.message}) — falling back to getChats()`);
            try {
                const fallback = await entry.client.getChats();
                socket.emit('chats', fallback.slice(0, 5).map((c) => ({
                    id: c.id._serialized,
                    name: c.name || c.id.user,
                    isGroup: c.isGroup,
                    lastMessage: c.lastMessage?.body?.slice(0, 80) || '',
                    timestamp: c.timestamp,
                    unreadCount: c.unreadCount,
                })));
            } catch (fe) {
                socket.emit('error', { message: `Failed to fetch chats: ${fe.message}` });
            }
        }
    });

    // ── Get messages ───────────────────────────────────────────────────────────
    // Reads directly from the WA Web in-memory store — NO openChat/navigation,
    // no risk of hanging. Falls back to fetchMessages if store is empty.
    socket.on('get-messages', async ({ chatId, limit = 50 }) => {
        if (!currentSession) return socket.emit('error', { message: 'No active session.' });
        const entry = waClients.get(currentSession);
        if (!entry || entry.status !== 'ready') {
            return socket.emit('error', { message: 'WhatsApp not ready.' });
        }
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
        console.log(`[${currentSession}] get-messages chatId=${chatId} limit=${safeLimit}`);
        try {
            entry.client.pupPage.setDefaultTimeout(30000);

            const result = await entry.client.pupPage.evaluate(async (cid, lim) => {
                try {
                    const chat = window.Store.Chat.get(cid);
                    if (!chat) return { ok: false, error: 'Chat introuvable dans le store WA.' };

                    // Load older pages without navigating the UI
                    const MAX_PAGES = 8;
                    for (let i = 0; i < MAX_PAGES; i++) {
                        const before = chat.msgs.getModelsArray()
                            .filter(m => !m.isNotification && !m.isStatusV3).length;
                        if (before >= lim) break;
                        try {
                            const loaded = await window.Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
                            if (!loaded || loaded.length === 0) break;
                        } catch (_) { break; }
                        await new Promise(r => setTimeout(r, 250));
                    }

                    const all = chat.msgs.getModelsArray()
                        .filter(m => !m.isNotification && !m.isStatusV3)
                        .sort((a, b) => (a.t || 0) - (b.t || 0));

                    return {
                        ok: true,
                        msgs: all.slice(-lim).map(m => ({
                            id: m.id._serialized,
                            body: m.body || '',
                            fromMe: m.id.fromMe,
                            author: m.author || m.from || '',
                            timestamp: m.t || m.timestamp || 0,
                            type: m.type || 'chat',
                        })),
                    };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            }, chatId, safeLimit);

            if (!result || !result.ok) {
                const errMsg = result ? result.error : 'Évaluation échouée';
                console.warn(`[${currentSession}] store read failed (${errMsg}) — falling back to fetchMessages`);
                try {
                    const chat = await entry.client.getChatById(chatId);
                    const messages = await chat.fetchMessages({ limit: safeLimit });
                    return socket.emit('messages', {
                        chatId,
                        messages: messages.map(m => ({
                            id: m.id._serialized,
                            body: m.body || '',
                            fromMe: m.fromMe,
                            author: m.author || m.from || '',
                            timestamp: m.timestamp || 0,
                            type: m.type || 'chat',
                        })),
                    });
                } catch (fe) {
                    // Always unblock the frontend even on failure
                    return socket.emit('messages', { chatId, messages: [], error: fe.message });
                }
            }

            console.log(`[${currentSession}] returning ${result.msgs.length} messages`);
            socket.emit('messages', { chatId, messages: result.msgs });
        } catch (err) {
            console.error(`[${currentSession}] get-messages error:`, err.message);
            // Always respond so the frontend never stays stuck on the loading spinner
            socket.emit('messages', { chatId, messages: [], error: err.message });
        }
    });

    // ── Analyze with Gemini ────────────────────────────────────────────────────
    socket.on('analyze', async ({ geminiKey, question, contextMessages }) => {
        if (!geminiKey) return socket.emit('error', { message: 'Gemini API key is required.' });
        if (!question || !contextMessages?.length) {
            return socket.emit('error', { message: 'Question and context messages are required.' });
        }
        try {
            const conversationText = contextMessages
                .map((m) => {
                    const date = new Date(m.timestamp * 1000).toLocaleString('fr-FR');
                    const who = m.fromMe ? 'Moi' : m.author || 'Interlocuteur';
                    return `[${date}] ${who}: ${m.body}`;
                })
                .join('\n');

            const prompt = `Tu es un assistant expert en analyse de conversations.\n\nVoici une conversation WhatsApp :\n---\n${conversationText}\n---\n\nQuestion de l'utilisateur : ${question}\n\nRéponds de manière claire, structurée et en français.`;

            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            socket.emit('ai-start', {});
            const result = await model.generateContentStream(prompt);
            for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) socket.emit('ai-chunk', { text });
            }
            socket.emit('ai-done', {});
        } catch (err) {
            console.error('Gemini error:', err.message);
            socket.emit('error', { message: `Gemini error: ${err.message}` });
        }
    });

    // ── Disconnect — do NOT destroy the WA client ─────────────────────────────
    // The WA session lives on so the user doesn't need to scan again on reconnect.
    socket.on('disconnect', (reason) => {
        console.log(`[${socket.id}] Browser disconnected (${reason}).`);
        unsubscribe();
    });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
