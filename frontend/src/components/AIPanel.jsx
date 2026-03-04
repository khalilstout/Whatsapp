import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import { Send, X, Sparkles, Copy, Check } from 'lucide-react';

const SUGGESTIONS = [
    "Résume cette conversation en quelques points clés.",
    "Quelles sont les tensions ou désaccords dans cette conversation ?",
    "Quel est le ton général de la conversation ?",
    "Liste les actions ou décisions prises dans cette conversation.",
    "Y a-t-il des informations importantes ou urgentes ?",
];

export default function AIPanel({ contextMessages, geminiKey, chatName, onClose }) {
    const [question, setQuestion] = useState('');
    const [response, setResponse] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [copied, setCopied] = useState(false);
    const responseRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => {
        socket.on('ai-start', () => {
            setResponse('');
            setStreaming(true);
        });

        socket.on('ai-chunk', ({ text }) => {
            setResponse((prev) => prev + text);
        });

        socket.on('ai-done', () => {
            setStreaming(false);
        });

        return () => {
            socket.off('ai-start');
            socket.off('ai-chunk');
            socket.off('ai-done');
        };
    }, []);

    useEffect(() => {
        if (responseRef.current) {
            responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
    }, [response]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!question.trim() || streaming) return;

        socket.emit('analyze', {
            geminiKey,
            question: question.trim(),
            contextMessages,
        });
    };

    const handleSuggestion = (s) => {
        setQuestion(s);
        textareaRef.current?.focus();
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(response).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="w-1/2 flex flex-col bg-gray-950 border-l border-gray-800">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-400" />
                    <div>
                        <p className="font-semibold text-white text-sm">Analyse IA — Gemini</p>
                        <p className="text-xs text-gray-500">{contextMessages.length} messages dans le contexte · {chatName}</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded-lg transition">
                    <X className="w-4 h-4 text-gray-400" />
                </button>
            </div>

            {/* Context info */}
            {contextMessages.length === 0 && (
                <div className="mx-4 mt-3 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
                    <p className="text-xs text-yellow-400">
                        Aucun message dans le contexte. Chargez d'abord une conversation ou définissez un point de départ.
                    </p>
                </div>
            )}

            {/* Response area */}
            <div
                ref={responseRef}
                className="flex-1 overflow-y-auto px-4 py-4"
            >
                {!response && !streaming && (
                    <div className="space-y-2">
                        <p className="text-xs text-gray-500 mb-3">Suggestions de questions :</p>
                        {SUGGESTIONS.map((s, i) => (
                            <button
                                key={i}
                                onClick={() => handleSuggestion(s)}
                                className="w-full text-left text-sm px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg text-gray-300 transition"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {(response || streaming) && (
                    <div className="relative">
                        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-purple-400 rounded-full" />
                                    <span className="text-xs font-medium text-purple-400">Gemini</span>
                                    {streaming && (
                                        <span className="text-xs text-gray-500 animate-pulse">En train d'écrire...</span>
                                    )}
                                </div>
                                {!streaming && response && (
                                    <button
                                        onClick={handleCopy}
                                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
                                    >
                                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copied ? 'Copié' : 'Copier'}
                                    </button>
                                )}
                            </div>
                            <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                                {response}
                                {streaming && (
                                    <span className="inline-block w-2 h-4 bg-purple-400 ml-0.5 animate-pulse rounded-sm" />
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <form
                onSubmit={handleSubmit}
                className="px-4 py-3 border-t border-gray-800 bg-gray-900 flex-shrink-0"
            >
                <div className="flex gap-2">
                    <textarea
                        ref={textareaRef}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                        placeholder="Posez votre question sur cette conversation... (Entrée pour envoyer)"
                        disabled={streaming || contextMessages.length === 0}
                        rows={3}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none disabled:opacity-50 transition"
                    />
                    <button
                        type="submit"
                        disabled={!question.trim() || streaming || contextMessages.length === 0}
                        className="self-end p-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition"
                    >
                        {streaming ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                    </button>
                </div>
                <p className="text-xs text-gray-600 mt-1.5">Shift+Entrée pour un saut de ligne.</p>
            </form>
        </div>
    );
}
