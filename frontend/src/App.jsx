import { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import SessionsScreen from './components/SessionsScreen';
import QRScreen from './components/QRScreen';
import ContactView from './components/ContactView';

const TARGET_PHONE = '+33648144945';

// App states: 'sessions' | 'connecting' | 'qr' | 'authenticated' | 'ready'
export default function App() {
    const [appState, setAppState] = useState('sessions');
    const [geminiKey, setGeminiKey] = useState('');
    const [qrData, setQrData] = useState(null);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(socket.connected);
    const [currentSession, setCurrentSession] = useState(null);

    // Contact conversation state
    const [messages, setMessages] = useState([]);
    const [chatName, setChatName] = useState(TARGET_PHONE);
    const [contactFound, setContactFound] = useState(null); // null | true | false
    const [syncStatus, setSyncStatus] = useState(null); // { status, message }
    const [syncLog, setSyncLog] = useState([]); // accumulated progress lines
    const [scrollMode, setScrollMode] = useState('bottom'); // 'bottom' | 'top'

    useEffect(() => {
        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        socket.on('qr', (data) => {
            setQrData(data);
            setAppState('qr');
        });

        socket.on('wa-status', ({ status }) => {
            if (status === 'authenticated') {
                setAppState('authenticated');
            } else if (status === 'ready') {
                setAppState('ready');
                setQrData(null);
                // Charger immédiatement la conversation cible
                socket.emit('connect-to-contact');
            } else if (status === 'disconnected' || status === 'auth_failure') {
                setAppState('sessions');
                setQrData(null);
                setCurrentSession(null);
                setMessages([]);
                setContactFound(null);
            }
        });

        // Messages de la conversation (depuis DB ou WA)
        socket.on('contact-messages', ({ found, fromDb, messages: msgs, newCount, chatName: cn, scrollTop }) => {
            setContactFound(found);
            if (cn) setChatName(cn);
            if (msgs) setMessages(msgs);
            if (scrollTop) {
                setScrollMode('top');
            } else if (!fromDb) {
                setScrollMode('bottom');
            }
            if (fromDb && !scrollTop) {
                setSyncStatus({ status: 'db', message: `${msgs.length} messages chargés (base de données)` });
            } else if (!fromDb) {
                setSyncStatus({ status: 'done', message: `Synchronisé — ${newCount} nouveau(x) message(s)` });
                // Garder le log visible 6s puis le vider
                setTimeout(() => { setSyncStatus(null); setSyncLog([]); }, 6000);
            }
        });

        socket.on('sync-clear', () => {
            setSyncStatus(null);
            setSyncLog([]);
        });

        socket.on('contact-not-found', ({ error: e }) => {
            setContactFound(false);
            setSyncStatus({ status: 'error', message: `Contact introuvable : ${e}` });
        });

        socket.on('sync-progress', ({ status: s, message: m }) => {
            setSyncStatus({ status: s, message: m });
            setSyncLog(prev => [...prev.slice(-50), { text: m, ts: Date.now() }]);
        });

        socket.on('error', ({ message }) => {
            setError(message);
            setTimeout(() => setError(null), 6000);
        });

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('qr');
            socket.off('wa-status');
            socket.off('contact-messages');
            socket.off('contact-not-found');
            socket.off('sync-progress');
            socket.off('sync-clear');
            socket.off('error');
        };
    }, []);

    const handleConnect = useCallback((sessionName, key) => {
        setGeminiKey(key);
        setCurrentSession(sessionName);
        setAppState('connecting');
        setQrData(null);
        setMessages([]);
        setContactFound(null);
        setSyncStatus(null);
        setSyncLog([]);
        socket.emit('connect-session', { name: sessionName });
    }, []);

    const handleCreateNew = useCallback((sessionName, key) => {
        setGeminiKey(key);
        setCurrentSession(sessionName);
        setAppState('connecting');
        setQrData(null);
        setMessages([]);
        setContactFound(null);
        setSyncStatus(null);
        socket.emit('create-session', { name: sessionName });
    }, []);

    const handleRefresh = useCallback(() => {
        setScrollMode('bottom');
        setSyncStatus({ status: 'fetching', message: 'Récupération nouveaux messages…' });
        setSyncLog([{ text: '🔄 Rafraîchissement lancé…', ts: Date.now() }]);
        socket.emit('refresh-contact');
    }, []);

    const handleLoadAll = useCallback(() => {
        setSyncStatus({ status: 'db', message: "Chargement de tout l'historique\u2026" });
        setSyncLog([]);
        socket.emit('load-all-history');
    }, []);

    const handleBackToSessions = useCallback(() => {
        setAppState('sessions');
        setCurrentSession(null);
        setQrData(null);
        setMessages([]);
        setContactFound(null);
        setSyncStatus(null);
    }, []);

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            {/* Top bar */}
            <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">W</div>
                    <span className="font-semibold text-white">WhatsApp AI Analyzer</span>
                    {currentSession && (
                        <span className="text-xs text-gray-500 ml-1">— {currentSession}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {appState !== 'sessions' && (
                        <button
                            onClick={handleBackToSessions}
                            className="text-xs text-gray-400 hover:text-white transition underline underline-offset-2"
                        >
                            Changer de session
                        </button>
                    )}
                    <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
                    <span className="text-xs text-gray-400">{connected ? 'Connecté' : 'Déconnecté'}</span>
                </div>
            </header>

            {/* Error toast */}
            {error && (
                <div className="fixed top-4 right-4 z-50 bg-red-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg max-w-sm">
                    {error}
                </div>
            )}

            {/* Main content */}
            <main className="flex-1 flex overflow-hidden">
                {appState === 'sessions' && (
                    <SessionsScreen onConnect={handleConnect} onCreateNew={handleCreateNew} />
                )}

                {appState === 'connecting' && !qrData && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-4">
                            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-white font-semibold">Connexion à la session…</p>
                            <p className="text-gray-400 text-sm">Si la session est déjà authentifiée, WhatsApp démarre automatiquement.</p>
                        </div>
                    </div>
                )}

                {(appState === 'qr' || (appState === 'connecting' && qrData)) && (
                    <QRScreen qrData={qrData} sessionName={currentSession} />
                )}

                {appState === 'authenticated' && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-4">
                            <div className="relative w-16 h-16 mx-auto">
                                <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
                                <div className="relative w-16 h-16 bg-green-600 rounded-full flex items-center justify-center">
                                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                    </svg>
                                </div>
                            </div>
                            <div>
                                <p className="text-white font-semibold">Connexion établie !</p>
                                <p className="text-gray-400 text-sm mt-1">Synchronisation de WhatsApp en cours…</p>
                            </div>
                        </div>
                    </div>
                )}

                {appState === 'ready' && (
                    <ContactView
                        chatName={chatName}
                        targetPhone={TARGET_PHONE}
                        messages={messages}
                        contactFound={contactFound}
                        syncStatus={syncStatus}
                        syncLog={syncLog}
                        geminiKey={geminiKey}
                        onRefresh={handleRefresh}
                        onLoadAll={handleLoadAll}
                        scrollMode={scrollMode}
                        onScrollModeReset={() => setScrollMode('bottom')}
                    />
                )}
            </main>
        </div>
    );
}
