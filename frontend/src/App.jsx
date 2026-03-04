import { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import SetupScreen from './components/SetupScreen';
import QRScreen from './components/QRScreen';
import ChatList from './components/ChatList';
import ChatView from './components/ChatView';

// App states: 'setup' | 'qr' | 'authenticated' | 'ready'
export default function App() {
    const [appState, setAppState] = useState('setup');
    const [geminiKey, setGeminiKey] = useState('');
    const [qrData, setQrData] = useState(null);
    const [selectedChat, setSelectedChat] = useState(null);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => {
            setConnected(false);
            setAppState('setup');
            setQrData(null);
            setSelectedChat(null);
        });

        socket.on('qr', (data) => {
            setQrData(data);
            setAppState('qr');
        });

        socket.on('wa-status', ({ status }) => {
            if (status === 'authenticated') setAppState('authenticated');
            if (status === 'ready') setAppState('ready');
            if (status === 'disconnected') {
                setAppState('setup');
                setQrData(null);
                setSelectedChat(null);
            }
        });

        socket.on('error', ({ message }) => {
            setError(message);
            setTimeout(() => setError(null), 5000);
        });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('qr');
            socket.off('wa-status');
            socket.off('error');
        };
    }, []);

    const handleStart = useCallback(
        (key) => {
            if (!key.trim()) return;
            setGeminiKey(key.trim());
            setError(null);
            socket.emit('init-wa');
        },
        []
    );

    const handleSelectChat = useCallback((chat) => {
        setSelectedChat(chat);
    }, []);

    const handleBack = useCallback(() => {
        setSelectedChat(null);
    }, []);

    return (
        <div className="min-h-screen flex flex-col">
            {/* Top bar */}
            <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">W</div>
                    <span className="font-semibold text-white">WhatsApp AI Analyzer</span>
                </div>
                <div className="flex items-center gap-2">
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
                {appState === 'setup' && <SetupScreen onStart={handleStart} />}

                {appState === 'qr' && <QRScreen qrData={qrData} />}

                {appState === 'authenticated' && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-4" />
                            <p className="text-gray-400">Chargement de WhatsApp...</p>
                        </div>
                    </div>
                )}

                {appState === 'ready' && (
                    selectedChat ? (
                        <ChatView
                            chat={selectedChat}
                            geminiKey={geminiKey}
                            onBack={handleBack}
                        />
                    ) : (
                        <ChatList onSelectChat={handleSelectChat} />
                    )
                )}
            </main>
        </div>
    );
}
