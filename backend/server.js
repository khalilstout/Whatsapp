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
const Database = require('better-sqlite3');

// ─── Logging vers fichier ──────────────────────────────────────────────────────
const LOGS_DIR = '/app/logs';
const LOG_FILE = path.join(LOGS_DIR, 'output.log');

try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) { }

function writeLog(level, ...args) {
    const ts = new Date().toISOString();
    const msg = args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') return JSON.stringify(a);
        return String(a);
    }).join(' ');
    const line = `[${ts}] [${level}] ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (_) { }
    process.stdout.write(line);
}

const log = (...a) => writeLog('INFO', ...a);
const logW = (...a) => writeLog('WARN', ...a);
const logE = (...a) => writeLog('ERROR', ...a);
console.log = log;
console.warn = logW;
console.error = logE;
console.info = log;

// ─── Configuration ────────────────────────────────────────────────────────────
const TARGET_PHONE = '33648144945';
const TARGET_CHAT_ID = `${TARGET_PHONE}@c.us`;

// ─── SQLite database ──────────────────────────────────────────────────────────
const AUTH_DATA_PATH = '/app/.wwebjs_auth';
const SESSIONS_FILE = path.join(AUTH_DATA_PATH, 'registry.json');
const DB_PATH = path.join(AUTH_DATA_PATH, 'messages.db');

let db;
try {
    fs.mkdirSync(AUTH_DATA_PATH, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id        TEXT PRIMARY KEY,
            chat_id   TEXT    NOT NULL,
            body      TEXT    NOT NULL,
            from_me   INTEGER NOT NULL DEFAULT 0,
            author    TEXT    DEFAULT '',
            timestamp INTEGER NOT NULL,
            synced_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_chat_ts ON messages(chat_id, timestamp);
    `);
    log('SQLite OK:', DB_PATH);
} catch (err) {
    logE('SQLite init error:', err);
}

const stmtInsert = db.prepare(`
    INSERT OR IGNORE INTO messages (id, chat_id, body, from_me, author, timestamp)
    VALUES (@id, @chat_id, @body, @from_me, @author, @timestamp)
`);
const insertMany = db.transaction((msgs) => {
    let count = 0;
    for (const m of msgs) {
        const id = String(m.id ?? '');
        const body = String(m.body ?? '');
        if (!id || !body) continue; // ignorer les msgs invalides
        const info = stmtInsert.run({
            id,
            chat_id: TARGET_CHAT_ID,
            body,
            from_me: (m.fromMe === true || m.fromMe === 1) ? 1 : 0,
            author: String(m.author ?? ''),
            timestamp: Number(m.timestamp) || 0,
        });
        count += info.changes;
    }
    return count;
});

function getStoredMessages() {
    return db.prepare(
        'SELECT id, chat_id, body, from_me, author, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC'
    ).all(TARGET_CHAT_ID).map(m => ({ ...m, fromMe: m.from_me === 1 }));
}

function getLastTimestamp() {
    const row = db.prepare('SELECT MAX(timestamp) as ts FROM messages WHERE chat_id = ?').get(TARGET_CHAT_ID);
    return row?.ts || 0;
}

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
});

// ─── Sessions Registry ────────────────────────────────────────────────────────
function loadRegistry() {
    try {
        if (fs.existsSync(SESSIONS_FILE))
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch (_) { }
    return [];
}

function saveRegistry(registry) {
    try {
        fs.mkdirSync(AUTH_DATA_PATH, { recursive: true });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(registry, null, 2));
    } catch (err) { logE('Failed to save registry:', err.message); }
}

// ─── WA Clients ───────────────────────────────────────────────────────────────
const waClients = new Map();

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, clients: waClients.size }));

// ─── API: lire le fichier de log depuis le navigateur ─────────────────────────
app.get('/logs', (_req, res) => {
    try {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        res.type('text/plain').send(content);
    } catch (_) { res.type('text/plain').send('(aucun log encore)'); }
});

// Accessible via /api/logs (proxied par nginx)
app.get('/api/logs', (_req, res) => {
    try {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        res.type('text/plain').send(content);
    } catch (_) { res.type('text/plain').send('(aucun log encore)'); }
});

app.get('/api/db-stats', (_req, res) => {
    try {
        const count = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?').get(TARGET_CHAT_ID);
        const oldest = db.prepare('SELECT MIN(timestamp) as ts FROM messages WHERE chat_id = ?').get(TARGET_CHAT_ID);
        const newest = db.prepare('SELECT MAX(timestamp) as ts FROM messages WHERE chat_id = ?').get(TARGET_CHAT_ID);
        res.json({
            total: count.cnt,
            oldest: oldest.ts ? new Date(oldest.ts * 1000).toISOString() : null,
            newest: newest.ts ? new Date(newest.ts * 1000).toISOString() : null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

function broadcast(sessionName, event, data) {
    const entry = waClients.get(sessionName);
    if (!entry) return;
    for (const sid of entry.listeners) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit(event, data);
    }
}

async function destroyClient(sessionName) {
    const entry = waClients.get(sessionName);
    if (!entry) return;
    try { await entry.client.destroy(); } catch (_) { }
    waClients.delete(sessionName);
    log(`[${sessionName}] Client détruit.`);
}

async function getOrCreateClient(sessionName) {
    if (waClients.has(sessionName)) return waClients.get(sessionName);

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionName, dataPath: AUTH_DATA_PATH }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'],
        },
    });

    const entry = { client, status: 'initializing', listeners: new Set() };
    waClients.set(sessionName, entry);

    client.on('qr', async (qr) => {
        entry.status = 'qr';
        try {
            const url = await qrcode.toDataURL(qr);
            broadcast(sessionName, 'qr', url);
            log(`[${sessionName}] QR envoyé.`);
        } catch (err) { broadcast(sessionName, 'error', { message: 'Échec génération QR code.' }); }
    });

    client.on('authenticated', () => {
        entry.status = 'authenticated';
        broadcast(sessionName, 'wa-status', { status: 'authenticated' });
        log(`[${sessionName}] Authentifié.`);
    });

    client.on('ready', () => {
        entry.status = 'ready';
        broadcast(sessionName, 'wa-status', { status: 'ready' });
        log(`[${sessionName}] Prêt.`);
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

    // Supprimer les fichiers de verrou Chromium laissés par un container précédent
    try {
        const sessionDir = path.join(AUTH_DATA_PATH, `wwebjs_auth_${sessionName}`);
        for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            const p = path.join(sessionDir, lockFile);
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                log(`[${sessionName}] Verrou Chromium supprimé : ${lockFile}`);
            }
        }
    } catch (_) { }

    client.initialize().catch((err) => {
        logE(`[${sessionName}] Initialize error:`, err.message);
        broadcast(sessionName, 'error', { message: 'Échec démarrage client WhatsApp.' });
        destroyClient(sessionName);
    });

    return entry;
}

// ─── Sync messages du contact cible ───────────────────────────────────────────
function emitProgress(socket, message, extra = {}) {
    log(`[SYNC] ${message}`);
    socket.emit('sync-progress', { status: 'fetching', message, ...extra });
}

async function syncContactMessages(entry, socket, onlyNew) {
    const lastTs = onlyNew ? getLastTimestamp() : 0;
    log(`syncContactMessages onlyNew=${onlyNew} lastTs=${lastTs}`);

    // ── Étape 1 : vérifier que le chat existe ─────────────────────────────────
    emitProgress(socket, '🔍 Recherche du contact dans WhatsApp…');

    const chatInfo = await entry.client.pupPage.evaluate((chatId) => {
        const chat = window.Store.Chat.get(chatId);
        if (!chat) return { ok: false, error: `Chat ${chatId} introuvable dans le store.` };
        return {
            ok: true,
            name: chat.name || chat.formattedTitle || chatId,
            totalInMemory: chat.msgs.length,
        };
    }, TARGET_CHAT_ID);

    if (!chatInfo || !chatInfo.ok) {
        // ── Fallback via getChatById ──────────────────────────────────────────
        logW('Store read failed:', chatInfo?.error, '— fallback fetchMessages');
        emitProgress(socket, '⚠️ Store indisponible, utilisation de l\'API WhatsApp…');
        try {
            const chat = await entry.client.getChatById(TARGET_CHAT_ID);
            emitProgress(socket, `✅ Chat trouvé : ${chat.name || TARGET_PHONE} — récupération des messages…`);
            const raw = await chat.fetchMessages({ limit: 500 });
            emitProgress(socket, `📥 ${raw.length} messages récupérés, filtrage des textes…`);
            const textOnly = raw.filter(m => m.type === 'chat' && m.body?.trim() && m.timestamp > lastTs);
            emitProgress(socket, `📝 ${textOnly.length} messages texte trouvés, enregistrement en base…`);
            const mapped = textOnly.map(m => ({
                id: m.id._serialized, body: m.body, fromMe: m.fromMe,
                author: m.author || m.from || '', timestamp: m.timestamp,
            }));
            const saved = insertMany(mapped);
            emitProgress(socket, `💾 ${saved} nouveau(x) message(s) enregistré(s) en base de données.`);
            log(`Fallback: ${saved} nouveaux msgs sauvegardés`);
            socket.emit('contact-messages', {
                found: true, fromDb: false,
                messages: getStoredMessages(),
                newCount: saved, chatName: chat.name || TARGET_PHONE,
            });
        } catch (fe) {
            socket.emit('contact-not-found', { error: fe.message });
        }
        return;
    }

    emitProgress(socket, `✅ Contact trouvé : ${chatInfo.name} (${chatInfo.totalInMemory} msgs en mémoire)`);

    // ── Étape 2 : charger toutes les pages (max 200) ──────────────────────────
    emitProgress(socket, `📄 Chargement des pages de messages…`);
    let totalPagesLoaded = 0;
    const MAX_PAGES = 200;

    for (let i = 0; i < MAX_PAGES; i++) {
        const pageResult = await entry.client.pupPage.evaluate(async (chatId) => {
            const chat = window.Store.Chat.get(chatId);
            if (!chat) return { done: true, count: 0, total: 0 };
            try {
                const loaded = await window.Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
                return { done: !loaded || loaded.length === 0, count: loaded ? loaded.length : 0, total: chat.msgs.length };
            } catch (_) { return { done: true, count: 0, total: 0 }; }
        }, TARGET_CHAT_ID);

        if (pageResult.done || pageResult.count === 0) {
            emitProgress(socket, `📄 Chargement terminé : ${pageResult.total || totalPagesLoaded * 50} msgs en mémoire (${totalPagesLoaded} page(s))`);
            break;
        }

        totalPagesLoaded++;
        // Afficher la progression toutes les 5 pages pour ne pas spammer
        if (totalPagesLoaded % 5 === 0 || totalPagesLoaded <= 3) {
            emitProgress(socket, `📄 Page ${totalPagesLoaded} — ${pageResult.total} msgs en mémoire…`);
        }
        await new Promise(r => setTimeout(r, 150));
    }

    // ── Étape 3 : compter les messages texte disponibles ─────────────────────
    emitProgress(socket, `🔎 Comptage des messages texte (depuis ts=${lastTs})…`);

    const countInfo = await entry.client.pupPage.evaluate((chatId, sinceTs) => {
        try {
            const chat = window.Store.Chat.get(chatId);
            if (!chat) return { ok: false, error: 'Chat perdu.' };
            const all = chat.msgs.getModelsArray()
                .filter(m => !m.isNotification && !m.isStatusV3);
            const filtered = all.filter(m =>
                (m.type === 'chat' || !m.type) &&
                m.body && m.body.trim() !== '' &&
                (m.t || 0) > sinceTs
            );
            return { ok: true, total: filtered.length, chatName: chat.name || chat.formattedTitle || chatId };
        } catch (e) { return { ok: false, error: e.message }; }
    }, TARGET_CHAT_ID, lastTs);

    if (!countInfo || !countInfo.ok) {
        socket.emit('contact-not-found', { error: countInfo?.error || 'Impossible de lire les messages.' });
        return;
    }

    const chatName = countInfo.chatName || TARGET_PHONE;
    emitProgress(socket, `📝 ${countInfo.total} message(s) texte à enregistrer…`);

    // ── Étape 4 : récupérer et insérer par batches de 500 ────────────────────
    const BATCH_SIZE = 500;
    let totalSaved = 0;
    let batchOffset = 0;

    while (batchOffset < countInfo.total) {
        const batch = await entry.client.pupPage.evaluate((chatId, sinceTs, offset, batchSize) => {
            try {
                const chat = window.Store.Chat.get(chatId);
                if (!chat) return { ok: false, error: 'Chat perdu.' };
                const all = chat.msgs.getModelsArray()
                    .filter(m => !m.isNotification && !m.isStatusV3)
                    .sort((a, b) => (a.t || 0) - (b.t || 0));
                const filtered = all.filter(m =>
                    (m.type === 'chat' || !m.type) &&
                    m.body && m.body.trim() !== '' &&
                    (m.t || 0) > sinceTs
                );
                const slice = filtered.slice(offset, offset + batchSize);
                return {
                    ok: true,
                    msgs: slice.map(m => ({
                        id: m.id._serialized,
                        body: m.body || '',
                        fromMe: m.id.fromMe,
                        author: m.author || m.from || '',
                        timestamp: m.t || m.timestamp || 0,
                    })),
                };
            } catch (e) { return { ok: false, error: e.message }; }
        }, TARGET_CHAT_ID, lastTs, batchOffset, BATCH_SIZE);

        if (!batch || !batch.ok) {
            logE('Batch error:', batch?.error);
            break;
        }
        if (batch.msgs.length === 0) break;

        try {
            totalSaved += insertMany(batch.msgs);
        } catch (dbErr) {
            logE('insertMany error (batch):', dbErr.message);
            socket.emit('sync-progress', { status: 'error', message: `❌ Erreur DB : ${dbErr.message}` });
            break;
        }

        batchOffset += batch.msgs.length;
        emitProgress(socket, `💾 ${batchOffset}/${countInfo.total} traités — ${totalSaved} nouveaux enregistrés…`);

        // Envoyer les messages déjà enregistrés en temps réel toutes les 500
        socket.emit('contact-messages', {
            found: true, fromDb: true,
            messages: getStoredMessages(),
            newCount: totalSaved, chatName,
        });
    }

    emitProgress(socket, `✅ Terminé — ${totalSaved} nouveau(x) message(s) — total en base : ${getStoredMessages().length}`);
    log(`Sync terminée: ${countInfo.total} msgs texte traités, ${totalSaved} nouveaux insérés`);

    socket.emit('contact-messages', {
        found: true, fromDb: false,
        messages: getStoredMessages(),
        newCount: totalSaved, chatName,
    });
}







// ─── Socket.IO ────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    log(`[${socket.id}] Navigateur connecté.`);
    let currentSession = null;

    function unsubscribe() {
        if (!currentSession) return;
        const e = waClients.get(currentSession);
        if (e) e.listeners.delete(socket.id);
        currentSession = null;
    }

    function subscribe(sessionName) {
        unsubscribe();
        currentSession = sessionName;
        const e = waClients.get(sessionName);
        if (e) e.listeners.add(socket.id);
    }

    // ── Sessions ──────────────────────────────────────────────────────────────
    socket.on('list-sessions', () => {
        socket.emit('sessions', loadRegistry().map(s => ({
            name: s.name, createdAt: s.createdAt,
            status: waClients.has(s.name) ? waClients.get(s.name).status : 'offline',
        })));
    });

    socket.on('create-session', async ({ name }) => {
        if (!name?.trim()) return socket.emit('error', { message: 'Nom de session requis.' });
        const sessionName = name.trim();
        const registry = loadRegistry();
        if (!registry.find(s => s.name === sessionName)) {
            registry.push({ name: sessionName, createdAt: Date.now() });
            saveRegistry(registry);
        }
        const entry = await getOrCreateClient(sessionName);
        subscribe(sessionName);
        entry.listeners.add(socket.id);
        if (entry.status === 'ready') socket.emit('wa-status', { status: 'ready' });
        else if (entry.status === 'authenticated') socket.emit('wa-status', { status: 'authenticated' });
    });

    socket.on('connect-session', async ({ name }) => {
        if (!loadRegistry().find(s => s.name === name))
            return socket.emit('error', { message: 'Session introuvable.' });
        const entry = await getOrCreateClient(name);
        subscribe(name);
        entry.listeners.add(socket.id);
        socket.emit('wa-status', { status: entry.status });
    });

    socket.on('delete-session', async ({ name }) => {
        await destroyClient(name);
        const registry = loadRegistry().filter(s => s.name !== name);
        saveRegistry(registry);
        try { fs.rmSync(path.join(AUTH_DATA_PATH, `session-${name}`), { recursive: true, force: true }); } catch (_) { }
        socket.emit('session-deleted', { name });
        socket.emit('sessions', registry.map(s => ({
            name: s.name, createdAt: s.createdAt,
            status: waClients.has(s.name) ? waClients.get(s.name).status : 'offline',
        })));
    });

    // ── Charger le contact cible (DB puis sync WA) ────────────────────────────
    socket.on('connect-to-contact', async () => {
        log(`[${socket.id}] connect-to-contact`);

        // 1. Affichage immédiat depuis la base de données
        const stored = getStoredMessages();
        if (stored.length > 0) {
            socket.emit('contact-messages', {
                found: true, fromDb: true,
                messages: stored, newCount: 0, chatName: TARGET_PHONE,
            });
        }

        // 2. Sync depuis WhatsApp en arrière-plan
        if (!currentSession) return;
        const entry = waClients.get(currentSession);
        if (!entry || entry.status !== 'ready') return;
        try {
            await syncContactMessages(entry, socket, false);
        } catch (err) {
            logE('connect-to-contact error:', err);
            socket.emit('sync-progress', { status: 'error', message: `❌ ${err.message}` });
            // Toujours renvoyer ce qu'on a en base pour débloquer l'UI
            socket.emit('contact-messages', {
                found: true, fromDb: true,
                messages: getStoredMessages(),
                newCount: 0, chatName: TARGET_PHONE,
            });
        }
    });

    // ── Rafraîchir (sync complète, INSERT OR IGNORE pour les doublons) ─────────
    socket.on('refresh-contact', async () => {
        log(`[${socket.id}] refresh-contact`);
        if (!currentSession) return socket.emit('error', { message: 'Pas de session active.' });
        const entry = waClients.get(currentSession);
        if (!entry || entry.status !== 'ready')
            return socket.emit('error', { message: 'WhatsApp non prêt.' });
        try {
            await syncContactMessages(entry, socket, false); // lastTs=0 → tout l'historique
        } catch (err) {
            logE('refresh-contact error:', err);
            socket.emit('sync-progress', { status: 'error', message: `❌ ${err.message}` });
            socket.emit('contact-messages', {
                found: true, fromDb: true,
                messages: getStoredMessages(),
                newCount: 0, chatName: TARGET_PHONE,
            });
        }
    });

    // ── Messages stockés (sans sync WA) ──────────────────────────────────────
    socket.on('get-stored-messages', () => {
        const msgs = getStoredMessages();
        socket.emit('contact-messages', {
            found: msgs.length > 0, fromDb: true,
            messages: msgs, newCount: 0, chatName: TARGET_PHONE,
        });
    });

    // ── Charger TOUT l'historique depuis la DB (tri chronologique) ────────────
    socket.on('load-all-history', () => {
        log(`[${socket.id}] load-all-history`);
        const msgs = getStoredMessages(); // déjà trié par timestamp ASC
        socket.emit('contact-messages', {
            found: msgs.length > 0, fromDb: true,
            messages: msgs, newCount: 0, chatName: TARGET_PHONE,
            scrollTop: true, // signal au front de remonter en haut
        });
        socket.emit('sync-progress', {
            status: 'db',
            message: `📂 ${msgs.length} messages chargés depuis la base de données`,
        });
        setTimeout(() => socket.emit('sync-clear', {}), 4000);
    });

    // ── Analyser avec Gemini ──────────────────────────────────────────────────
    socket.on('analyze', async ({ geminiKey, question, contextMessages }) => {
        if (!geminiKey) return socket.emit('error', { message: 'Clé API Gemini requise.' });
        if (!question || !contextMessages?.length)
            return socket.emit('error', { message: 'Question et messages de contexte requis.' });
        try {
            const conversationText = contextMessages.map(m => {
                const date = new Date(m.timestamp * 1000).toLocaleString('fr-FR');
                const who = m.fromMe ? 'Moi' : (m.author || 'Contact');
                return `[${date}] ${who}: ${m.body}`;
            }).join('\n');

            const prompt = `Tu es un assistant expert en analyse de conversations WhatsApp.\n\nConversation avec +${TARGET_PHONE} :\n---\n${conversationText}\n---\n\nQuestion : ${question}\n\nRéponds de manière claire et en français.`;

            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            socket.emit('ai-start', {});
            const result = await model.generateContentStream(prompt);
            for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) socket.emit('ai-chunk', { text });
            }
            socket.emit('ai-done', {});
        } catch (err) {
            logE('Gemini error:', err.message);
            socket.emit('error', { message: `Erreur Gemini: ${err.message}` });
        }
    });

    socket.on('disconnect', (reason) => {
        log(`[${socket.id}] Déconnecté (${reason}).`);
        unsubscribe();
    });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    log(`Backend sur http://0.0.0.0:${PORT}`);
    log(`Contact cible : +${TARGET_PHONE} (${TARGET_CHAT_ID})`);
    log(`Log: ${LOG_FILE}`);
    log(`DB : ${DB_PATH}`);
});

