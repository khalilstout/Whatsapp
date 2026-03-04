import { useState } from 'react';
import { KeyRound, MessageSquare } from 'lucide-react';

export default function SetupScreen({ onStart }) {
    const [key, setKey] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setLoading(true);
        onStart(key);
        // Loading state is reset when QR arrives (parent changes appState)
    };

    return (
        <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-md">
                {/* Icon */}
                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <MessageSquare className="w-10 h-10 text-white" />
                    </div>
                </div>

                <h1 className="text-3xl font-bold text-center text-white mb-2">
                    WhatsApp AI Analyzer
                </h1>
                <p className="text-gray-400 text-center mb-8">
                    Analysez vos conversations WhatsApp avec l'intelligence artificielle de Google Gemini.
                </p>

                <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-6 border border-gray-800 shadow-xl">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        <span className="flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-green-400" />
                            Clé API Google Gemini
                        </span>
                    </label>
                    <input
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition mb-4"
                        required
                    />

                    <button
                        type="submit"
                        disabled={loading || !key.trim()}
                        className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Génération du QR code...
                            </>
                        ) : (
                            'Générer le QR Code WhatsApp'
                        )}
                    </button>
                </form>

                <p className="text-xs text-gray-600 text-center mt-4">
                    Votre clé API n'est jamais stockée. Elle est utilisée uniquement pour les requêtes Gemini.
                </p>
            </div>
        </div>
    );
}
