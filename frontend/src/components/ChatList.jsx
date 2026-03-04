import { useState, useEffect } from 'react';
import socket from '../socket';
import { Users, User, RefreshCw } from 'lucide-react';

export default function ChatList({ onSelectChat }) {
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadChats = () => {
        setLoading(true);
        socket.emit('get-chats');
    };

    useEffect(() => {
        loadChats();

        socket.on('chats', (data) => {
            setChats(data);
            setLoading(false);
        });

        return () => socket.off('chats');
    }, []);

    const formatTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    };

    return (
        <div className="flex-1 flex flex-col max-w-lg mx-auto w-full border-x border-gray-800">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
                <h2 className="font-semibold text-white">Conversations récentes</h2>
                <button
                    onClick={loadChats}
                    disabled={loading}
                    className="p-2 hover:bg-gray-800 rounded-lg transition disabled:opacity-50"
                    title="Rafraîchir"
                >
                    <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
                    </div>
                ) : chats.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">Aucune conversation trouvée.</div>
                ) : (
                    chats.map((chat) => (
                        <button
                            key={chat.id}
                            onClick={() => onSelectChat(chat)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition border-b border-gray-800/50 text-left"
                        >
                            {/* Avatar */}
                            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${chat.isGroup ? 'bg-purple-700' : 'bg-green-700'}`}>
                                {chat.isGroup
                                    ? <Users className="w-5 h-5 text-white" />
                                    : <User className="w-5 h-5 text-white" />}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-white truncate">{chat.name}</span>
                                    <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{formatTime(chat.timestamp)}</span>
                                </div>
                                <p className="text-sm text-gray-400 truncate">{chat.lastMessage || '—'}</p>
                            </div>

                            {/* Unread badge */}
                            {chat.unreadCount > 0 && (
                                <div className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                                    <span className="text-xs font-bold text-white">{chat.unreadCount}</span>
                                </div>
                            )}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
