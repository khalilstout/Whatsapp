'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth, NoAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
});

// ─── In-Memory Session Store ───────────────────────────────────────────────────
// Map<socketId, { client: Client, status: string }>
const sessions = new Map();

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }));

// ─── Utility: destroy a WA client safely ──────────────────────────────────────
async function destroySession(socketId) {
    const session = sessions.get(socketId);
    if (!session) return;
    try {
        await session.client.destroy();
    } catch (_) {
        // Ignore errors during cleanup
    }
    sessions.delete(socketId);
    console.log(`[${socketId}] Session destroyed. Active sessions: ${sessions.size}`);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[${socket.id}] Client connected. Active sessions: ${sessions.size}`);

    // ── 1. Initialize WhatsApp session ──────────────────────────────────────────
    socket.on('init-wa', async () => {
        // Kill any existing session for this socket
        if (sessions.has(socket.id)) {
            await destroySession(socket.id);
        }

        const client = new Client({
            authStrategy: new NoAuth(),
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
                    '--single-process',
                    '--disable-gpu',
                ],
            },
        });

        sessions.set(socket.id, { client, status: 'initializing' });
        console.log(`[${socket.id}] WhatsApp client created.`);

        // QR code event
        client.on('qr', async (qr) => {
            const session = sessions.get(socket.id);
            if (session) session.status = 'qr';
            try {
                const qrDataURL = await qrcode.toDataURL(qr);
                socket.emit('qr', qrDataURL);
                console.log(`[${socket.id}] QR sent.`);
            } catch (err) {
                socket.emit('error', { message: 'Failed to generate QR code.' });
            }
        });

        // Authentication success
        client.on('authenticated', () => {
            const session = sessions.get(socket.id);
            if (session) session.status = 'authenticated';
            socket.emit('wa-status', { status: 'authenticated' });
            console.log(`[${socket.id}] Authenticated.`);
        });

        // Ready
        client.on('ready', () => {
            const session = sessions.get(socket.id);
            if (session) session.status = 'ready';
            socket.emit('wa-status', { status: 'ready' });
            console.log(`[${socket.id}] WhatsApp ready.`);
        });

        // Auth failure
        client.on('auth_failure', (msg) => {
            socket.emit('error', { message: `Auth failed: ${msg}` });
        });

        // Disconnected from WhatsApp
        client.on('disconnected', (reason) => {
            socket.emit('wa-status', { status: 'disconnected', reason });
            destroySession(socket.id);
        });

        // Start the client
        try {
            await client.initialize();
        } catch (err) {
            console.error(`[${socket.id}] Initialize error:`, err.message);
            socket.emit('error', { message: 'Failed to start WhatsApp client.' });
            await destroySession(socket.id);
        }
    });

    // ── 1b. Request Pairing Code ─────────────────────────────────────────────────
    socket.on('request-pairing-code', async ({ phoneNumber }) => {
        const session = sessions.get(socket.id);
        if (!session) {
            return socket.emit('pairing-code-error', {
                message: 'Aucune session active. Cliquez d\'abord sur "Obtenir le code".',
            });
        }

        // Normalize: digits only, strip leading +
        const normalized = String(phoneNumber || '').replace(/\D/g, '');
        if (!normalized || normalized.length < 7 || normalized.length > 15) {
            return socket.emit('pairing-code-error', {
                message: 'Numéro invalide. Format international requis (ex: 33612345678).',
            });
        }

        try {
            console.log(`[${socket.id}] Requesting pairing code for ${normalized}...`);
            const code = await session.client.requestPairingCode(normalized);
            console.log(`[${socket.id}] Pairing code obtained.`);
            socket.emit('pairing-code', { code });
        } catch (err) {
            console.error(`[${socket.id}] Pairing code error:`, err.message);
            socket.emit('pairing-code-error', {
                message: `WhatsApp a refusé la demande : ${err.message}`,
            });
        }
    });

    // ── 2. Get recent chats ──────────────────────────────────────────────────────
    socket.on('get-chats', async () => {
        const session = sessions.get(socket.id);
        if (!session || session.status !== 'ready') {
            return socket.emit('error', { message: 'WhatsApp not ready.' });
        }
        try {
            const chats = await session.client.getChats();
            const payload = chats.slice(0, 30).map((c) => ({
                id: c.id._serialized,
                name: c.name || c.id.user,
                isGroup: c.isGroup,
                lastMessage: c.lastMessage?.body?.slice(0, 80) || '',
                timestamp: c.timestamp,
                unreadCount: c.unreadCount,
            }));
            socket.emit('chats', payload);
        } catch (err) {
            socket.emit('error', { message: `Failed to fetch chats: ${err.message}` });
        }
    });

    // ── 3. Get messages for a chat ───────────────────────────────────────────────
    socket.on('get-messages', async ({ chatId, limit = 100 }) => {
        const session = sessions.get(socket.id);
        if (!session || session.status !== 'ready') {
            return socket.emit('error', { message: 'WhatsApp not ready.' });
        }
        try {
            const chat = await session.client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit: Math.min(limit, 500) });
            const payload = messages.map((m) => ({
                id: m.id._serialized,
                body: m.body,
                fromMe: m.fromMe,
                author: m.author || m.from,
                timestamp: m.timestamp,
                type: m.type,
            }));
            socket.emit('messages', { chatId, messages: payload });
        } catch (err) {
            socket.emit('error', { message: `Failed to fetch messages: ${err.message}` });
        }
    });

    // ── 4. Analyze with Gemini ───────────────────────────────────────────────────
    socket.on('analyze', async ({ geminiKey, question, contextMessages }) => {
        if (!geminiKey) {
            return socket.emit('error', { message: 'Gemini API key is required.' });
        }
        if (!question || !contextMessages || contextMessages.length === 0) {
            return socket.emit('error', { message: 'Question and context messages are required.' });
        }

        try {
            // Format conversation context
            const conversationText = contextMessages
                .map((m) => {
                    const date = new Date(m.timestamp * 1000).toLocaleString('fr-FR');
                    const who = m.fromMe ? 'Moi' : m.author || 'Interlocuteur';
                    return `[${date}] ${who}: ${m.body}`;
                })
                .join('\n');

            const prompt = `Tu es un assistant expert en analyse de conversations.

Voici une conversation WhatsApp :
---
${conversationText}
---

Question de l'utilisateur : ${question}

Réponds de manière claire, structurée et en français.`;

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
            console.error(`[${socket.id}] Gemini error:`, err.message);
            socket.emit('error', { message: `Gemini error: ${err.message}` });
        }
    });

    // ── 5. Disconnect cleanup ────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
        console.log(`[${socket.id}] Disconnected (${reason}). Cleaning up...`);
        await destroySession(socket.id);
    });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
