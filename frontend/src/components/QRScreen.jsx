import { useState, useEffect, useRef } from 'react';
import { Smartphone, QrCode, Hash, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import socket from '../socket';

// ─── Tab: QR Code ─────────────────────────────────────────────────────────────
function QRTab({ qrData }) {
    return (
        <div className="text-center">
            <p className="text-gray-400 mb-6 text-sm">
                Ouvrez WhatsApp →{' '}
                <span className="text-white">Appareils connectés</span> → Connecter un appareil
            </p>

            {qrData ? (
                <div className="bg-white p-4 rounded-2xl inline-block shadow-2xl">
                    <img src={qrData} alt="QR Code WhatsApp" className="w-56 h-56" />
                </div>
            ) : (
                <div className="w-64 h-64 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto border-2 border-dashed border-gray-700">
                    <div className="text-center space-y-3">
                        <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full mx-auto" />
                        <p className="text-xs text-gray-500">Génération en cours...</p>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 justify-center mt-6 text-gray-400 text-sm">
                <Smartphone className="w-4 h-4" />
                <span>En attente du scan...</span>
            </div>
            <p className="text-xs text-gray-600 mt-2">
                Le QR code expire toutes les 20&nbsp;secondes. Un nouveau est généré automatiquement.
            </p>
        </div>
    );
}

// ─── Tab: Pairing Code ────────────────────────────────────────────────────────
function PairingTab({ clientReady }) {
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [pairingCode, setPairingCode] = useState(null);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    // If user clicks before client is ready, we queue the request
    const pendingPhone = useRef(null);

    useEffect(() => {
        // If client just became ready and we have a pending request, fire it now
        if (clientReady && pendingPhone.current) {
            doRequest(pendingPhone.current);
            pendingPhone.current = null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientReady]);

    useEffect(() => {
        socket.on('pairing-code', ({ code }) => {
            setPairingCode(code);
            setLoading(false);
            setError(null);
        });

        socket.on('pairing-code-error', ({ message }) => {
            setError(message);
            setLoading(false);
        });

        return () => {
            socket.off('pairing-code');
            socket.off('pairing-code-error');
        };
    }, []);

    function doRequest(number) {
        setLoading(true);
        setError(null);
        setPairingCode(null);
        socket.emit('request-pairing-code', { phoneNumber: number });
    }

    const handleSubmit = (e) => {
        e.preventDefault();
        const normalized = phone.replace(/\D/g, '');
        if (!normalized) return;

        if (!clientReady) {
            // Client still initializing — queue the request until QR arrives
            pendingPhone.current = normalized;
            setLoading(true);
            setError(null);
            return;
        }

        doRequest(normalized);
    };

    const handleCopy = () => {
        if (!pairingCode) return;
        navigator.clipboard.writeText(pairingCode).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // Format as XXXX-XXXX for readability
    const displayCode = pairingCode
        ? pairingCode.replace(/(.{4})(.{4})/, '$1-$2')
        : null;

    return (
        <div className="text-center">
            <p className="text-gray-400 mb-6 text-sm">
                Ouvrez WhatsApp →{' '}
                <span className="text-white">Appareils connectés</span> → Associer avec un numéro de téléphone
            </p>

            <form onSubmit={handleSubmit} className="space-y-3 max-w-xs mx-auto">
                <div>
                    <label className="block text-xs text-gray-400 mb-1.5 text-left">
                        Numéro de téléphone (format international, sans le +)
                    </label>
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="33612345678"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-center text-lg tracking-widest focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
                        disabled={loading}
                        required
                    />
                    <p className="text-xs text-gray-600 mt-1 text-left">
                        Ex : 33612345678 pour +33 6 12 34 56 78
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={!phone.replace(/\D/g, '') || loading}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-6 rounded-lg transition flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {!clientReady ? 'Initialisation...' : 'Demande en cours...'}
                        </>
                    ) : (
                        <>
                            <Hash className="w-4 h-4" />
                            Obtenir le code
                        </>
                    )}
                </button>
            </form>

            {/* Error */}
            {error && (
                <div className="mt-4 flex items-start gap-2 bg-red-900/30 border border-red-700/50 rounded-lg p-3 max-w-xs mx-auto text-left">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-300">{error}</p>
                </div>
            )}

            {/* Pairing Code display */}
            {displayCode && (
                <div className="mt-6">
                    <p className="text-xs text-gray-400 mb-3">Entrez ce code dans WhatsApp :</p>
                    <div className="bg-gray-800 border border-green-700/50 rounded-2xl p-6 inline-block shadow-xl">
                        <p className="text-5xl font-bold tracking-[0.25em] text-green-400 font-mono">
                            {displayCode}
                        </p>
                    </div>
                    <div className="mt-3 flex items-center justify-center">
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
                        >
                            {copied
                                ? <Check className="w-3.5 h-3.5 text-green-400" />
                                : <Copy className="w-3.5 h-3.5" />}
                            {copied ? 'Copié !' : 'Copier le code'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">Ce code expire dans quelques minutes.</p>
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function QRScreen({ qrData }) {
    const [tab, setTab] = useState('qr'); // 'qr' | 'pairing'

    // qrData arriving means the WA client is initialized and waiting for auth
    const clientReady = !!qrData;

    const tabs = [
        { id: 'qr', icon: QrCode, label: 'Scanner un QR Code' },
        { id: 'pairing', icon: Smartphone, label: 'Je suis sur mon téléphone' },
    ];

    return (
        <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-sm">
                <h2 className="text-2xl font-bold text-white text-center mb-6">
                    Connexion WhatsApp
                </h2>

                {/* Tab selector */}
                <div className="flex bg-gray-800 rounded-xl p-1 mb-8 gap-1">
                    {tabs.map(({ id, icon: Icon, label }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`flex-1 flex items-center justify-center gap-2 text-xs font-medium py-2.5 px-3 rounded-lg transition-all ${tab === id
                                    ? 'bg-green-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                {tab === 'qr'
                    ? <QRTab qrData={qrData} />
                    : <PairingTab clientReady={clientReady} />}
            </div>
        </div>
    );
}
