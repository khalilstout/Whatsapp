import { useState, useEffect } from 'react';
import socket from '../socket';
import { Plus, Trash2, Wifi, WifiOff, Loader2, KeyRound, MessageSquare } from 'lucide-react';

// Status badge helper
function StatusBadge({ status }) {
    const map = {
        ready: { label: 'Connecté', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
        authenticated: { label: 'Auth OK', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
        initializing: { label: 'Démarrage…', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
        qr: { label: 'Attente QR', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
        offline: { label: 'Hors-ligne', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
        disconnected: { label: 'Déconnecté', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
        auth_failure: { label: 'Échec auth', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };
    const { label, cls } = map[status] || map.offline;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
            {label}
        </span>
    );
}

export default function SessionsScreen({ onConnect, onCreateNew }) {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiKey') || '');
    const [newName, setNewName] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [deleting, setDeleting] = useState(null);

    useEffect(() => {
        socket.emit('list-sessions');

        const onSessions = (data) => {
            setSessions(data);
            setLoading(false);
        };
        const onDeleted = ({ name }) => {
            setSessions((prev) => prev.filter((s) => s.name !== name));
            setDeleting(null);
        };

        socket.on('sessions', onSessions);
        socket.on('session-deleted', onDeleted);
        return () => {
            socket.off('sessions', onSessions);
            socket.off('session-deleted', onDeleted);
        };
    }, []);

    const handleGeminiSave = () => {
        localStorage.setItem('geminiKey', geminiKey.trim());
    };

    const handleCreate = (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        if (!geminiKey.trim()) {
            alert('Veuillez entrer votre clé API Gemini d\'abord.');
            return;
        }
        localStorage.setItem('geminiKey', geminiKey.trim());
        onCreateNew(name, geminiKey.trim());
        setNewName('');
        setShowNew(false);
    };

    const handleConnect = (session) => {
        if (!geminiKey.trim()) {
            alert('Veuillez entrer votre clé API Gemini d\'abord.');
            return;
        }
        localStorage.setItem('geminiKey', geminiKey.trim());
        onConnect(session.name, geminiKey.trim());
    };

    const handleDelete = (name) => {
        if (!window.confirm(`Supprimer la session "${name}" ? Le QR code devra être scanné à nouveau.`)) return;
        setDeleting(name);
        socket.emit('delete-session', { name });
    };

    return (
        <div className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
            <div className="w-full max-w-lg space-y-6">
                {/* Header */}
                <div className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <MessageSquare className="w-8 h-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-white">WhatsApp AI Analyzer</h1>
                    <p className="text-gray-400 text-sm mt-1">Sélectionnez une session ou créez-en une nouvelle.</p>
                </div>

                {/* Gemini key */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        <span className="flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-green-400" />
                            Clé API Google Gemini
                        </span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={geminiKey}
                            onChange={(e) => setGeminiKey(e.target.value)}
                            onBlur={handleGeminiSave}
                            placeholder="AIza..."
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition text-sm"
                        />
                    </div>
                    <p className="text-xs text-gray-600 mt-1.5">Sauvegardée localement dans votre navigateur.</p>
                </div>

                {/* Sessions list */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                        <h2 className="font-semibold text-white text-sm">Sessions sauvegardées</h2>
                        <button
                            onClick={() => setShowNew((v) => !v)}
                            className="flex items-center gap-1.5 text-xs font-medium text-green-400 hover:text-green-300 transition"
                        >
                            <Plus className="w-4 h-4" />
                            Nouvelle session
                        </button>
                    </div>

                    {/* New session form */}
                    {showNew && (
                        <form onSubmit={handleCreate} className="border-b border-gray-800 px-5 py-4 bg-gray-800/40">
                            <label className="block text-xs text-gray-400 mb-1.5">Nom de la session</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="ex: Mon WhatsApp perso"
                                    autoFocus
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
                                />
                                <button
                                    type="submit"
                                    disabled={!newName.trim()}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
                                >
                                    Créer
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1.5">Un QR code sera affiché pour l'associer à WhatsApp.</p>
                        </form>
                    )}

                    {/* List */}
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500 text-sm">
                            <WifiOff className="w-8 h-8 mx-auto mb-3 text-gray-700" />
                            Aucune session. Créez-en une nouvelle ci-dessus.
                        </div>
                    ) : (
                        sessions.map((s) => (
                            <div
                                key={s.name}
                                className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/60 last:border-b-0 hover:bg-gray-800/30 transition"
                            >
                                {/* Icon */}
                                <div className="w-10 h-10 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0">
                                    <Wifi className="w-5 h-5 text-white" />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-white truncate">{s.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <StatusBadge status={s.status} />
                                        <span className="text-xs text-gray-600">
                                            {new Date(s.createdAt).toLocaleDateString('fr-FR')}
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => handleConnect(s)}
                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded-lg transition"
                                    >
                                        Ouvrir
                                    </button>
                                    <button
                                        onClick={() => handleDelete(s.name)}
                                        disabled={deleting === s.name}
                                        className="p-1.5 text-gray-500 hover:text-red-400 transition disabled:opacity-50"
                                        title="Supprimer la session"
                                    >
                                        {deleting === s.name
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : <Trash2 className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <p className="text-xs text-gray-600 text-center">
                    Les sessions sont persistantes — le QR code n'est scanné qu'une seule fois.
                </p>
            </div>
        </div>
    );
}
