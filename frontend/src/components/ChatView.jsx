import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';
import AIPanel from './AIPanel';
import { ArrowLeft, ChevronUp, Sparkles, Pin } from 'lucide-react';

export default function ChatView({ chat, geminiKey, onBack }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    const limitRef = useRef(50);
    const [startingPoint, setStartingPoint] = useState(null); // message id
    const [showAI, setShowAI] = useState(false);
    const bottomRef = useRef(null);
    const topRef = useRef(null);

    const loadMessages = useCallback(
        (lim, isMore = false) => {
            if (isMore) setLoadingMore(true);
            else setLoading(true);
            socket.emit('get-messages', { chatId: chat.id, limit: lim });
        },
        [chat.id]
    );

    useEffect(() => {
        limitRef.current = 50;
        setFetchError(null);
        loadMessages(50);

        const handler = ({ chatId, messages: msgs, error }) => {
            if (chatId !== chat.id) return;
            setMessages(msgs || []);
            setLoading(false);
            setLoadingMore(false);
            setFetchError(error ? `Erreur: ${error}` : null);
        };

        // Safety net: if no response from backend in 35s, unblock the UI
        const timeoutId = setTimeout(() => {
            setLoading(false);
            setLoadingMore(false);
            setFetchError("Délai dépassé — WhatsApp n'a pas répondu.");
        }, 35000);

        socket.on('messages', handler);

        return () => {
            clearTimeout(timeoutId);
            socket.off('messages', handler);
        };
    }, [chat.id, loadMessages]);

    useEffect(() => {
        if (!loading && !loadingMore) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [loading]);

    const handleLoadMore = () => {
        const newLimit = limitRef.current + 50;
        limitRef.current = newLimit;
        loadMessages(newLimit, true);
    };

    const handleSelectStartingPoint = (msgId) => {
        setStartingPoint((prev) => (prev === msgId ? null : msgId));
    };

    // Slice messages from startingPoint to end
    const contextMessages = startingPoint
        ? messages.slice(messages.findIndex((m) => m.id === startingPoint))
        : messages;

    const formatTime = (ts) => {
        return new Date(ts * 1000).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatDate = (ts) => {
        return new Date(ts * 1000).toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
    };

    // Group messages by date
    const grouped = messages.reduce((acc, msg) => {
        const dateStr = formatDate(msg.timestamp);
        if (!acc[dateStr]) acc[dateStr] = [];
        acc[dateStr].push(msg);
        return acc;
    }, {});

    return (
        <div className="flex-1 flex overflow-hidden">
            {/* ── Chat column ── */}
            <div className={`flex flex-col ${showAI ? 'w-1/2' : 'flex-1'} border-r border-gray-800 transition-all`}>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                    <button onClick={onBack} className="p-1.5 hover:bg-gray-800 rounded-lg transition">
                        <ArrowLeft className="w-5 h-5 text-gray-400" />
                    </button>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{chat.name}</p>
                        {startingPoint && (
                            <p className="text-xs text-green-400">
                                Contexte : {contextMessages.length} message(s) sélectionné(s)
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => setShowAI((p) => !p)}
                        className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition font-medium ${showAI
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                    >
                        <Sparkles className="w-4 h-4" />
                        Analyser avec IA
                    </button>
                </div>

                {/* Load more */}
                <div className="flex justify-center py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
                    <button
                        onClick={handleLoadMore}
                        disabled={loading || loadingMore}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition disabled:opacity-50"
                    >
                        {loadingMore
                            ? <span className="animate-spin w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full" />
                            : <ChevronUp className="w-4 h-4" />}
                        {loadingMore ? 'Chargement…' : 'Charger plus de messages anciens'}
                    </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-3">
                            <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
                            <p className="text-xs text-gray-500">Chargement des messages…</p>
                        </div>
                    ) : fetchError ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-6">
                            <p className="text-red-400 text-sm font-medium">Impossible de charger les messages</p>
                            <p className="text-gray-500 text-xs">{fetchError}</p>
                            <button
                                onClick={() => { setFetchError(null); setLoading(true); loadMessages(limitRef.current); }}
                                className="mt-2 px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded-lg transition"
                            >
                                Réessayer
                            </button>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex items-center justify-center h-40">
                            <p className="text-gray-500 text-sm">Aucun message à afficher.</p>
                        </div>
                    ) : (
                        Object.entries(grouped).map(([date, msgs]) => (
                            <div key={date}>
                                {/* Date separator */}
                                <div className="flex items-center gap-2 my-3">
                                    <div className="flex-1 h-px bg-gray-800" />
                                    <span className="text-xs text-gray-500 capitalize">{date}</span>
                                    <div className="flex-1 h-px bg-gray-800" />
                                </div>

                                {msgs.map((msg) => {
                                    const isStart = msg.id === startingPoint;
                                    const inContext =
                                        startingPoint &&
                                        messages.findIndex((m) => m.id === msg.id) >=
                                        messages.findIndex((m) => m.id === startingPoint);

                                    return (
                                        <div
                                            key={msg.id}
                                            className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'} mb-1`}
                                        >
                                            <div
                                                className={`relative group max-w-[75%] cursor-pointer`}
                                                onClick={() => handleSelectStartingPoint(msg.id)}
                                                title="Cliquer pour définir comme point de départ"
                                            >
                                                {/* Starting point indicator */}
                                                {isStart && (
                                                    <div className="absolute -left-6 top-1/2 -translate-y-1/2">
                                                        <Pin className="w-4 h-4 text-green-400" />
                                                    </div>
                                                )}

                                                <div
                                                    className={`px-3 py-2 rounded-2xl text-sm leading-relaxed transition-all ${msg.fromMe
                                                        ? 'bg-green-700 text-white rounded-br-sm'
                                                        : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                                                        } ${isStart ? 'ring-2 ring-green-400' : ''}
                          ${inContext && !isStart ? 'ring-1 ring-green-700/50' : ''}
                          group-hover:ring-1 group-hover:ring-gray-500`}
                                                >
                                                    {!msg.fromMe && msg.author && (
                                                        <p className="text-xs font-semibold text-green-400 mb-0.5">
                                                            {msg.author.split('@')[0]}
                                                        </p>
                                                    )}
                                                    {msg.type !== 'chat' && msg.type !== 'text' ? (
                                                        <span className="italic text-gray-400">
                                                            [{msg.type}]
                                                        </span>
                                                    ) : (
                                                        <span className="whitespace-pre-wrap break-words">{msg.body}</span>
                                                    )}
                                                </div>
                                                <p
                                                    className={`text-[10px] text-gray-500 mt-0.5 ${msg.fromMe ? 'text-right' : 'text-left'
                                                        }`}
                                                >
                                                    {formatTime(msg.timestamp)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                    <div ref={bottomRef} />
                </div>

                {startingPoint && (
                    <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-400 flex items-center gap-2 flex-shrink-0">
                        <Pin className="w-3 h-3 text-green-400" />
                        Point de départ défini. {contextMessages.length} messages dans le contexte.
                        <button
                            onClick={() => setStartingPoint(null)}
                            className="text-red-400 hover:text-red-300 ml-auto"
                        >
                            Réinitialiser
                        </button>
                    </div>
                )}
            </div>

            {/* ── AI Panel ── */}
            {showAI && (
                <AIPanel
                    contextMessages={contextMessages}
                    geminiKey={geminiKey}
                    chatName={chat.name}
                    onClose={() => setShowAI(false)}
                />
            )}
        </div>
    );
}
