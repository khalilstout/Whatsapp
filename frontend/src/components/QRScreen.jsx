import { useState } from 'react';
import { Smartphone, QrCode } from 'lucide-react';

export default function QRScreen({ qrData, sessionName }) {
    return (
        <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-sm">
                <h2 className="text-2xl font-bold text-white text-center mb-1">
                    Connexion WhatsApp
                </h2>
                {sessionName && (
                    <p className="text-center text-gray-500 text-sm mb-6">Session : <span className="text-gray-300">{sessionName}</span></p>
                )}

                <div className="text-center">
                    <p className="text-gray-400 mb-6 text-sm">
                        Ouvrez WhatsApp &rarr;{' '}
                        <span className="text-white">Appareils connectés</span> &rarr; Connecter un appareil
                    </p>

                    {qrData ? (
                        <div className="bg-white p-4 rounded-2xl inline-block shadow-2xl">
                            <img src={qrData} alt="QR Code WhatsApp" className="w-56 h-56" />
                        </div>
                    ) : (
                        <div className="w-64 h-64 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto border-2 border-dashed border-gray-700">
                            <div className="text-center space-y-3">
                                <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full mx-auto" />
                                <p className="text-xs text-gray-500">Génération en cours…</p>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2 justify-center mt-6 text-gray-400 text-sm">
                        <Smartphone className="w-4 h-4" />
                        <span>En attente du scan…</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                        Le QR code expire toutes les 20&nbsp;secondes. Un nouveau est généré automatiquement.
                    </p>
                    <p className="text-xs text-green-600 mt-3 font-medium">
                        ✓ Ce scan est permanent — vous ne devrez pas le refaire.
                    </p>
                </div>
            </div>
        </div>
    );
}

