import { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Sparkles, Database, Wifi, History, X, ChevronRight, ChevronDown, CalendarDays, MessageSquare, Pin } from 'lucide-react';
import AIPanel from './AIPanel';

const MONTHS_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export default function ContactView({
    chatName,
    targetPhone,
    messages,
    contactFound,
    syncStatus,
    syncLog = [],
    geminiKey,
    onRefresh,
    onLoadAll,
    scrollMode = 'bottom',
    onScrollModeReset,
}) {
    const [showAI, setShowAI] = useState(false);
    const [messageLimit, setMessageLimit] = useState(500);
    const [limitInput, setLimitInput] = useState('500');

    const [expandedYears, setExpandedYears] = useState(new Set());
    const [expandedMonths, setExpandedMonths] = useState(new Set());
    const [selectedDay, setSelectedDay] = useState(null); // 'YYYY-MM-DD'

    // Message pinner : active le contexte IA élargi depuis le jour sélectionné
    const [pinnedMsgId, setPinnedMsgId] = useState(null);

    const bottomRef = useRef(null);
    const logRef = useRef(null);
    const prevMsgCount = useRef(0);

    // Arbre année/mois/jour
    const tree = useMemo(() => {
        const t = {};
        messages.forEach(msg => {
            const d = new Date(msg.timestamp * 1000);
            const y = d.getFullYear().toString();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            if (!t[y]) t[y] = {};
            if (!t[y][mo]) t[y][mo] = {};
            if (!t[y][mo][day]) t[y][mo][day] = [];
            t[y][mo][day].push(msg);
        });
        return t;
    }, [messages]);

    const years = Object.keys(tree).sort((a, b) => Number(b) - Number(a));

    // Auto-expand année/mois les plus récents
    useEffect(() => {
        if (messages.length !== prevMsgCount.current) {
            prevMsgCount.current = messages.length;
            if (years.length > 0) {
                const latestYear = years[0];
                const latestMonth = Object.keys(tree[latestYear]).sort().at(-1);
                setExpandedYears(prev => new Set([...prev, latestYear]));
                if (latestMonth) setExpandedMonths(prev => new Set([...prev, `${latestYear}-${latestMonth}`]));
            }
            if (scrollMode === 'top' && years.length > 0) {
                const oldestYear = years.at(-1);
                const oldestMonth = Object.keys(tree[oldestYear]).sort()[0];
                if (oldestMonth) {
                    const oldestDay = Object.keys(tree[oldestYear][oldestMonth]).sort()[0];
                    if (oldestDay) {
                        setSelectedDay(`${oldestYear}-${oldestMonth}-${oldestDay}`);
                        setExpandedYears(new Set([oldestYear]));
                        setExpandedMonths(new Set([`${oldestYear}-${oldestMonth}`]));
                    }
                }
                onScrollModeReset?.();
            }
        }
    }, [messages, scrollMode, onScrollModeReset]);

    // Reset pin quand on change de jour
    useEffect(() => {
        setPinnedMsgId(null);
    }, [selectedDay]);

    // Scroll vers le bas quand on change de jour
    useEffect(() => {
        if (selectedDay) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    }, [selectedDay]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [syncLog]);

    // Messages du jour sélectionné (affichage)
    const dayMessages = useMemo(() => {
        if (!selectedDay) return [];
        const [y, mo, d] = selectedDay.split('-');
        return (tree[y]?.[mo]?.[d] || []).slice().sort((a, b) => a.timestamp - b.timestamp);
    }, [selectedDay, tree]);

    // Contexte IA : si un message est pinned → tout depuis le début de ce jour jusqu'à aujourd'hui (limité)
    // Sinon → juste les messages du jour affiché
    const aiContextMessages = useMemo(() => {
        if (!pinnedMsgId || !selectedDay) return dayMessages;
        const [y, mo, d] = selectedDay.split('-');
        const fromTs = Math.floor(new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0).getTime() / 1000);
        return [...messages]
            .filter(m => m.timestamp >= fromTs)
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(0, messageLimit);
    }, [pinnedMsgId, selectedDay, messages, messageLimit]);

    // Nombre total dans la plage (avant limite)
    const totalInRange = useMemo(() => {
        if (!pinnedMsgId || !selectedDay) return 0;
        const [y, mo, d] = selectedDay.split('-');
        const fromTs = Math.floor(new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0).getTime() / 1000);
        return messages.filter(m => m.timestamp >= fromTs).length;
    }, [pinnedMsgId, selectedDay, messages]);

    const handlePinMsg = (msgId) => {
        setPinnedMsgId(prev => prev === msgId ? null : msgId);
    };

    const toggleYear = (y) => {
        setExpandedYears(prev => { const n = new Set(prev); n.has(y) ? n.delete(y) : n.add(y); return n; });
    };
    const toggleMonth = (key) => {
        setExpandedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    };
    const handleSelectDay = (dayKey) => {
        setSelectedDay(prev => prev === dayKey ? null : dayKey);
    };
    const handleLimitChange = (val) => {
        setLimitInput(val);
        const n = parseInt(val);
        if (!isNaN(n) && n > 0) setMessageLimit(n);
    };

    const formatTime = (ts) => new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const syncColor = {
        fetching: 'text-yellow-400',
        db: 'text-blue-400',
        done: 'text-green-400',
        error: 'text-red-400',
    }[syncStatus?.status] || 'text-gray-400';

    const isLoading = syncStatus?.status === 'fetching' && messages.length === 0;
    const isRefreshing = syncStatus?.status === 'fetching' && messages.length > 0;

    const selectedDayLabel = useMemo(() => {
        if (!selectedDay) return '';
        const [y, mo, d] = selectedDay.split('-');
        return new Date(Number(y), Number(mo) - 1, Number(d))
            .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }, [selectedDay]);

    return (
        <div className="flex-1 flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-green-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {(chatName || targetPhone).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="font-semibold text-white truncate text-sm">{chatName || targetPhone}</p>
                        <p className="text-xs text-gray-500 truncate">{targetPhone} · {messages.length} messages</p>
                    </div>
                </div>

                {syncStatus && (
                    <div className={`flex items-center gap-1.5 text-xs ${syncColor} max-w-[180px]`}>
                        {syncStatus.status === 'fetching'
                            ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
                            : syncStatus.status === 'db'
                                ? <Database className="w-3 h-3 flex-shrink-0" />
                                : <Wifi className="w-3 h-3 flex-shrink-0" />}
                        <span className="truncate">{syncStatus.message}</span>
                    </div>
                )}

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={onLoadAll}
                        disabled={syncStatus?.status === 'fetching'}
                        title="Charger tout l'historique"
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-900/40 text-blue-300 hover:bg-blue-800/60 transition disabled:opacity-50 border border-blue-800/50"
                    >
                        <History className="w-3.5 h-3.5" />
                        Historique
                    </button>
                    <button
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        title="Actualiser depuis WhatsApp"
                        className="p-2 hover:bg-gray-800 rounded-lg transition disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={() => setShowAI(p => !p)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition font-medium ${showAI ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        IA
                    </button>
                </div>
            </div>

            {/* Sync log bar */}
            {isRefreshing && syncLog.length > 0 && (
                <div className="border-b border-gray-800 bg-gray-950 flex-shrink-0">
                    <div ref={logRef} className="max-h-20 overflow-y-auto px-4 py-2 font-mono text-xs space-y-0.5">
                        {syncLog.map((line, i) => (
                            <div key={i} className={`flex gap-2 items-start ${i === syncLog.length - 1 ? 'text-green-300' : 'text-gray-600'}`}>
                                <span className="text-gray-700 flex-shrink-0 select-none">›</span>
                                <span>{line.text}</span>
                                {i === syncLog.length - 1 && <span className="inline-block w-1 h-3 bg-green-400 animate-pulse ml-0.5" />}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Corps : sidebar + messages + overlay IA */}
            <div className="flex flex-1 overflow-hidden min-h-0 relative">

                {/* Sidebar */}
                <div className="w-52 flex-shrink-0 bg-gray-950 border-r border-gray-800 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 space-y-1 font-mono text-xs">
                            {syncLog.length === 0
                                ? <p className="text-gray-600 animate-pulse">Démarrage…</p>
                                : syncLog.map((line, i) => (
                                    <div key={i} className={`flex gap-1.5 ${i === syncLog.length - 1 ? 'text-green-300' : 'text-gray-600'}`}>
                                        <span className="text-gray-700 flex-shrink-0">›</span>
                                        <span>{line.text}</span>
                                    </div>
                                ))}
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="p-6 text-center">
                            <CalendarDays className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                            <p className="text-xs text-gray-600">Aucun message</p>
                            <button onClick={onLoadAll} className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline">
                                Charger l&apos;historique
                            </button>
                        </div>
                    ) : (
                        <div className="py-1">
                            {years.map(year => {
                                const yearExp = expandedYears.has(year);
                                const months = Object.keys(tree[year]).sort((a, b) => Number(b) - Number(a));
                                const yearTotal = months.reduce((acc, mo) =>
                                    acc + Object.values(tree[year][mo]).reduce((a, d) => a + d.length, 0), 0);
                                return (
                                    <div key={year}>
                                        <button onClick={() => toggleYear(year)}
                                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 transition group">
                                            {yearExp
                                                ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                                                : <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                                            <span className="font-bold text-sm text-white flex-1 text-left">{year}</span>
                                            <span className="text-xs text-gray-600 group-hover:text-gray-400">{yearTotal}</span>
                                        </button>
                                        {yearExp && months.map(mo => {
                                            const monthKey = `${year}-${mo}`;
                                            const monthExp = expandedMonths.has(monthKey);
                                            const days = Object.keys(tree[year][mo]).sort((a, b) => Number(b) - Number(a));
                                            const monthTotal = days.reduce((acc, d) => acc + tree[year][mo][d].length, 0);
                                            return (
                                                <div key={monthKey}>
                                                    <button onClick={() => toggleMonth(monthKey)}
                                                        className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 hover:bg-gray-800/40 transition group">
                                                        {monthExp
                                                            ? <ChevronDown className="w-3 h-3 text-gray-600 flex-shrink-0" />
                                                            : <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
                                                        <span className="text-xs font-semibold text-gray-300 flex-1 text-left">{MONTHS_FR[Number(mo) - 1]}</span>
                                                        <span className="text-xs text-gray-600 group-hover:text-gray-400">{monthTotal}</span>
                                                    </button>
                                                    {monthExp && days.map(day => {
                                                        const dayKey = `${year}-${mo}-${day}`;
                                                        const count = tree[year][mo][day].length;
                                                        const isSel = selectedDay === dayKey;
                                                        const dow = new Date(Number(year), Number(mo) - 1, Number(day))
                                                            .toLocaleDateString('fr-FR', { weekday: 'short' });
                                                        return (
                                                            <button key={dayKey} onClick={() => handleSelectDay(dayKey)}
                                                                className={`w-full flex items-center gap-2 pl-10 pr-3 py-1 transition ${isSel
                                                                    ? 'bg-green-900/50 text-green-200'
                                                                    : 'text-gray-500 hover:bg-gray-800/30 hover:text-gray-300'}`}>
                                                                {isSel && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
                                                                <span className={`text-xs flex-1 text-left font-mono ${isSel ? 'font-bold' : ''}`}>{day}</span>
                                                                <span className="text-[10px] text-gray-600">{dow}</span>
                                                                <span className={`text-[10px] tabular-nums ${isSel ? 'text-green-500' : 'text-gray-700'}`}>{count}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Zone messages */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    {!selectedDay ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
                            <CalendarDays className="w-12 h-12 text-gray-700" />
                            {messages.length === 0 ? (
                                <>
                                    <p className="text-sm text-gray-600">Aucun message chargé</p>
                                    <button onClick={onLoadAll} className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1">
                                        <History className="w-3 h-3" /> Charger l&apos;historique complet
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-gray-500">Sélectionne un jour</p>
                                    <p className="text-xs text-gray-700">{messages.length} messages disponibles</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* En-tête du jour */}
                            <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/70 border-b border-gray-800 flex-shrink-0">
                                <CalendarDays className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                <span className="text-xs font-semibold text-gray-300 flex-1 truncate capitalize">{selectedDayLabel}</span>
                                <span className="text-xs text-gray-600 flex items-center gap-1 flex-shrink-0">
                                    <MessageSquare className="w-3 h-3" />{dayMessages.length}
                                </span>
                                <span className="text-[10px] text-gray-600 flex-shrink-0 ml-2">Lim IA:</span>
                                <input
                                    type="number"
                                    value={limitInput}
                                    onChange={e => handleLimitChange(e.target.value)}
                                    className="w-14 text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 text-center focus:outline-none focus:border-green-600 flex-shrink-0"
                                    min="10" max="10000" step="100"
                                    title="Limite de messages pour le contexte IA"
                                />
                            </div>

                            {/* Barre contexte IA élargi (visible seulement si un message est pinné) */}
                            {pinnedMsgId && (
                                <div className="flex items-center gap-2 px-4 py-1.5 bg-green-950/60 border-b border-green-800/40 flex-shrink-0">
                                    <Pin className="w-3 h-3 text-green-400 flex-shrink-0" />
                                    <span className="text-xs text-green-300 flex-1">
                                        Contexte IA : <strong>{aiContextMessages.length}</strong> msg depuis ce jour
                                        {totalInRange > messageLimit && (
                                            <span className="text-yellow-400 ml-1"> · tronqué ({totalInRange} au total)</span>
                                        )}
                                    </span>
                                    <button onClick={() => setPinnedMsgId(null)} className="p-0.5 hover:bg-green-900 rounded flex-shrink-0" title="Réinitialiser contexte">
                                        <X className="w-3 h-3 text-green-600 hover:text-green-300" />
                                    </button>
                                </div>
                            )}

                            {/* Messages du jour (scrollable) */}
                            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                                {dayMessages.map((msg) => {
                                    const isPinned = pinnedMsgId === msg.id;
                                    return (
                                        <div key={msg.id} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'} mb-1`}>
                                            <div
                                                className="group relative max-w-[75%] cursor-pointer"
                                                onClick={() => handlePinMsg(msg.id)}
                                                title="Clic = définir le contexte IA depuis ce jour"
                                            >
                                                <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed transition-all ${msg.fromMe
                                                    ? `bg-green-700 text-white ${isPinned ? 'ring-2 ring-green-300' : 'group-hover:bg-green-600'}`
                                                    : `bg-gray-800 text-gray-100 ${isPinned ? 'ring-2 ring-green-400' : 'group-hover:bg-gray-700'}`
                                                    }`}>
                                                    {isPinned && (
                                                        <div className="flex items-center gap-1 text-xs text-green-300 mb-1 font-medium">
                                                            <Pin className="w-3 h-3" />
                                                            <span>Contexte IA depuis ce jour activé</span>
                                                        </div>
                                                    )}
                                                    {msg.body}
                                                </div>
                                                <div className={`text-xs text-gray-600 mt-0.5 ${msg.fromMe ? 'text-right' : 'text-left'}`}>
                                                    {formatTime(msg.timestamp)}
                                                </div>
                                                {/* Indicateur hover */}
                                                {!isPinned && (
                                                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Pin className="w-3 h-3 text-gray-400" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={bottomRef} />
                            </div>

                            {/* Footer */}
                            <div className="px-4 py-1.5 bg-gray-900 border-t border-gray-800 flex-shrink-0 text-xs text-gray-600 flex items-center justify-between">
                                <span>
                                    {pinnedMsgId
                                        ? <span className="text-green-500">IA : {aiContextMessages.length} messages (depuis ce jour)</span>
                                        : <span>Clic sur un message → enrichir le contexte IA avec tous les messages depuis ce jour</span>
                                    }
                                </span>
                                {!pinnedMsgId && totalInRange === 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-gray-700">Limite :</span>
                                        <input
                                            type="number"
                                            value={limitInput}
                                            onChange={e => handleLimitChange(e.target.value)}
                                            className="w-16 text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 text-center focus:outline-none focus:border-green-600"
                                            min="10" max="10000" step="100"
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Backdrop semi-transparent (cliquable pour fermer) */}
            {showAI && (
                <div
                    className="absolute inset-0 bg-black/25 z-10"
                    onClick={() => setShowAI(false)}
                />
            )}

            {/* Panneau IA — drawer glissant depuis la droite, toujours monté */}
            <div
                className={`absolute inset-y-0 right-0 z-20 w-[62%] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${showAI ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <AIPanel
                    contextMessages={aiContextMessages}
                    geminiKey={geminiKey}
                    chatName={chatName || targetPhone}
                    onClose={() => setShowAI(false)}
                />
            </div>
        </div>
    );
}
