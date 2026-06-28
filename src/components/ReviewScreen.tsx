import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ParsedTransaction, ExpenseLabel } from '../types';
import { ArrowLeft, Tag, X, Check, ChevronRight, Search } from 'lucide-react';

interface ReviewScreenProps {
    mode: 'receipt' | 'ledger';
    transactions: ParsedTransaction[];
    onConfirm: (transactions: ParsedTransaction[]) => void;
    onBack: () => void;
}

const PRESET_LABELS: ExpenseLabel[] = [
    'Cost of Sales',
    'Transport & Travel',
    'Utilities',
    'Airtime & Data',
    'Supplier Payment',
    'Staff Payment',
    'Meals & Entertainment',
    'Medical',
    'Rent & Accommodation',
    'Equipment & Supplies',
    'Investment / Savings',
    'Personal',
    'Other Business Expense',
];

const LABEL_COLORS: Record<NonNullable<ExpenseLabel>, string> = {
    'Cost of Sales':          'bg-red-100 text-red-800',
    'Transport & Travel':     'bg-blue-100 text-blue-800',
    'Utilities':              'bg-yellow-100 text-yellow-800',
    'Airtime & Data':         'bg-orange-100 text-orange-800',
    'Supplier Payment':       'bg-purple-100 text-purple-800',
    'Staff Payment':          'bg-pink-100 text-pink-800',
    'Meals & Entertainment':  'bg-amber-100 text-amber-800',
    'Medical':                'bg-green-100 text-green-800',
    'Rent & Accommodation':   'bg-teal-100 text-teal-800',
    'Equipment & Supplies':   'bg-cyan-100 text-cyan-800',
    'Investment / Savings':   'bg-emerald-100 text-emerald-800',
    'Personal':               'bg-gray-100 text-gray-600',
    'Other Business Expense': 'bg-slate-100 text-slate-700',
};

const subTypeDisplay: Record<string, { label: string; badge: string }> = {
    person_send:    { label: 'Send',       badge: 'bg-red-100 text-red-800'      },
    person_receive: { label: 'Received',   badge: 'bg-green-100 text-green-800'  },
    pochi_send:     { label: 'Pochi',      badge: 'bg-rose-100 text-rose-800'    },
    paybill:        { label: 'Paybill',    badge: 'bg-blue-100 text-blue-800'    },
    airtime:        { label: 'Airtime',    badge: 'bg-yellow-100 text-yellow-800'},
    data:           { label: 'Data',       badge: 'bg-orange-100 text-orange-800'},
    withdrawal:     { label: 'Withdrawal', badge: 'bg-purple-100 text-purple-800'},
    mshwari:        { label: 'M-Shwari',   badge: 'bg-emerald-100 text-emerald-800'},
    investment:     { label: 'Investment', badge: 'bg-teal-100 text-teal-800'    },
    unknown:        { label: 'Other',      badge: 'bg-gray-100 text-gray-600'    },
};

function fmt(n: number) {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Smart label suggestion based on subType and recipient
function suggestLabel(t: ParsedTransaction): ExpenseLabel {
    const r = t.recipient.toLowerCase();
    if (t.subType === 'investment' || t.subType === 'mshwari') return 'Investment / Savings';
    if (t.subType === 'airtime') return 'Airtime & Data';
    if (t.subType === 'data') return 'Airtime & Data';
    if (t.subType === 'withdrawal') return 'Cost of Sales';
    if (/kplc|kenya power|water|nairobi water|sewerage/i.test(r)) return 'Utilities';
    if (/uber|bolt|little|taxi|matatu|bus|shuttle|autoexpress|express/i.test(r)) return 'Transport & Travel';
    if (/java|kfc|pizza|burger|restaurant|cafe|coffee|food|eat|kitchen|canteen|domino/i.test(r)) return 'Meals & Entertainment';
    if (/hospital|clinic|pharmacy|medical|health|doctor|dawa/i.test(r)) return 'Medical';
    if (/rent|house|apartment|bedsit|airbnb/i.test(r)) return 'Rent & Accommodation';
    if (/carrefour|naivas|quickmart|tuskys|supermarket|market|shop|store|mall/i.test(r)) return 'Cost of Sales';
    if (t.subType === 'paybill') return 'Supplier Payment';
    if (t.subType === 'person_send' || t.subType === 'pochi_send') return 'Staff Payment';
    return null;
}

export function ReviewScreen({ mode, transactions: initialTransactions, onConfirm, onBack }: ReviewScreenProps) {
    const [txns, setTxns] = useState<ParsedTransaction[]>(() =>
        initialTransactions.map(t => ({
            ...t,
            label: t.label ?? suggestLabel(t),
            customLabel: t.customLabel ?? null,
        }))
    );

    const [activeIdx, setActiveIdx] = useState<number | null>(null);
    const [customInput, setCustomInput] = useState('');
    const [search, setSearch] = useState('');
    const [filterLabel, setFilterLabel] = useState<ExpenseLabel | 'unlabelled' | null>(null);

    const setLabel = useCallback((idx: number, label: ExpenseLabel, custom?: string) => {
        setTxns(prev => prev.map((t, i) =>
            i === idx
                ? { ...t, label, customLabel: custom ?? null }
                : t
        ));
        setActiveIdx(null);
        setCustomInput('');
    }, []);

    const clearLabel = useCallback((idx: number) => {
        setTxns(prev => prev.map((t, i) =>
            i === idx ? { ...t, label: null, customLabel: null } : t
        ));
    }, []);

    const labelled = txns.filter(t => t.label !== null).length;
    const unlabelled = txns.length - labelled;

    const filtered = txns.filter(t => {
        const matchSearch = search === '' ||
            t.recipient.toLowerCase().includes(search.toLowerCase()) ||
            t.transactionCode.toLowerCase().includes(search.toLowerCase()) ||
            (t.label ?? '').toLowerCase().includes(search.toLowerCase());
        const matchFilter = filterLabel === null ? true
            : filterLabel === 'unlabelled' ? t.label === null
            : t.label === filterLabel;
        return matchSearch && matchFilter;
    });

    // Bulk label — apply a label to all currently visible transactions
    const bulkLabel = useCallback((label: ExpenseLabel) => {
        const visibleSet = new Set(filtered);
        setTxns(prev => prev.map(t =>
            visibleSet.has(t) ? { ...t, label, customLabel: null } : t
        ));
    }, [filtered]);

    const activeTransaction = activeIdx !== null ? txns[activeIdx] : null;

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-gray-50"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-100">
                <div className="h-14 flex items-center px-4">
                    <motion.button
                        onClick={onBack}
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 text-gray-600"
                        whileTap={{ scale: 0.88 }}
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </motion.button>
                    <div className="flex-1 text-center">
                        <span className="text-sm font-semibold text-gray-900">Review & Label</span>
                    </div>
                    <motion.button
                        onClick={() => onConfirm(txns)}
                        className="h-9 px-4 rounded-xl bg-[#00A651] text-white text-sm font-semibold"
                        whileTap={{ scale: 0.95 }}
                        style={{ boxShadow: '0 2px 8px rgba(0,166,81,0.3)' }}
                    >
                        Generate
                    </motion.button>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-gray-100">
                    <motion.div
                        className="h-full bg-[#00A651]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(labelled / txns.length) * 100}%` }}
                        transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                    />
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-gray-500">
                        <span className="font-semibold text-[#00A651]">{labelled}</span> labelled
                        {unlabelled > 0 && <span className="text-gray-400"> · {unlabelled} remaining</span>}
                    </span>
                    <span className="text-xs text-gray-400">{txns.length} transactions</span>
                </div>

                {/* Search */}
                <div className="px-4 pb-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search transactions..."
                            className="w-full pl-9 pr-4 py-2.5 bg-gray-100 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A651]/30"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                                <X className="w-4 h-4 text-gray-400" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Filter chips */}
                <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
                    {(['unlabelled', ...PRESET_LABELS] as const).map(l => (
                        <button
                            key={l ?? 'all'}
                            onClick={() => setFilterLabel(prev => prev === l ? null : l)}
                            className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                                filterLabel === l
                                    ? 'bg-[#00A651] text-white border-[#00A651]'
                                    : 'bg-white text-gray-600 border-gray-200'
                            }`}
                        >
                            {l === 'unlabelled' ? `Unlabelled (${unlabelled})` : l}
                        </button>
                    ))}
                </div>

                {/* Bulk label bar — appears when search or filter is active */}
                <AnimatePresence>
                    {(search !== '' || filterLabel !== null) && filtered.length > 0 && (
                        <motion.div
                            className="px-4 pb-3 flex items-center gap-2"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                        >
                            <span className="text-xs text-gray-500 flex-shrink-0">
                                Label all {filtered.length} visible:
                            </span>
                            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                                {PRESET_LABELS.slice(0, 5).map(l => (
                                    <button
                                        key={l}
                                        onClick={() => bulkLabel(l)}
                                        className="flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-[#00A651] hover:text-white transition-colors"
                                    >
                                        {l}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Transaction list */}
            <div className="flex-1 px-4 pt-3 pb-32 space-y-2 max-w-md mx-auto w-full">
                <AnimatePresence mode="popLayout">
                    {filtered.map((t) => {
                        const globalIdx = txns.indexOf(t);
                        const display = subTypeDisplay[t.subType] ?? subTypeDisplay.unknown;
                        const effectiveLabel = t.customLabel ?? t.label;

                        return (
                            <motion.div
                                key={t.transactionCode + globalIdx}
                                layout
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                                className="bg-white rounded-2xl overflow-hidden"
                                style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}
                            >
                                <div className="flex items-start gap-3 p-4">
                                    {/* Left: date + subtype */}
                                    <div className="flex-shrink-0 text-center min-w-[44px]">
                                        <div className="text-xs font-bold text-gray-900">
                                            {t.date.toLocaleDateString('en-GB', { day: '2-digit' })}
                                        </div>
                                        <div className="text-xs text-gray-400">
                                            {t.date.toLocaleDateString('en-GB', { month: 'short' })}
                                        </div>
                                        <span className={`mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${display.badge}`}>
                                            {display.label}
                                        </span>
                                    </div>

                                    {/* Middle: recipient + code */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-gray-900 truncate">{t.recipient}</p>
                                        <p className="text-xs text-gray-400 font-mono">{t.transactionCode}</p>
                                        <p className="text-xs text-gray-400">{t.time}</p>

                                        {/* Label chip */}
                                        <div className="mt-2 flex items-center gap-1.5">
                                            {effectiveLabel ? (
                                                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${LABEL_COLORS[effectiveLabel as NonNullable<ExpenseLabel>] ?? 'bg-gray-100 text-gray-600'}`}>
                                                    <Tag className="w-2.5 h-2.5" />
                                                    {effectiveLabel}
                                                    <button
                                                        onClick={() => clearLabel(globalIdx)}
                                                        className="ml-0.5 opacity-60 hover:opacity-100"
                                                    >
                                                        <X className="w-2.5 h-2.5" />
                                                    </button>
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-300 italic">unlabelled</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right: amount + label button */}
                                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                                        <span className={`text-sm font-bold tabular-nums ${t.type === 'received' ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                            {t.type === 'received' ? '+' : '-'}{fmt(t.amount)}
                                        </span>
                                        <motion.button
                                            onClick={() => {
                                                setActiveIdx(globalIdx);
                                                setCustomInput('');
                                            }}
                                            className="flex items-center gap-1 text-xs font-medium text-[#00A651] bg-green-50 px-2.5 py-1 rounded-lg"
                                            whileTap={{ scale: 0.92 }}
                                        >
                                            <Tag className="w-3 h-3" />
                                            {effectiveLabel ? 'Change' : 'Label'}
                                            <ChevronRight className="w-3 h-3" />
                                        </motion.button>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {filtered.length === 0 && (
                    <div className="text-center py-16 text-gray-400 text-sm">
                        No transactions match your search.
                    </div>
                )}
            </div>

            {/* Floating generate button */}
            <div className="fixed bottom-6 left-0 right-0 flex justify-center z-10 px-4">
                <motion.button
                    onClick={() => onConfirm(txns)}
                    className="w-full max-w-md min-h-[52px] rounded-2xl bg-[#00A651] text-white font-semibold text-[15px] flex items-center justify-center gap-2"
                    style={{ boxShadow: '0 4px 20px rgba(0,166,81,0.35)' }}
                    whileTap={{ scale: 0.97 }}
                    animate={{
                        boxShadow: ['0 4px 16px rgba(0,166,81,0.25)', '0 6px 28px rgba(0,166,81,0.40)', '0 4px 16px rgba(0,166,81,0.25)'],
                    }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
                >
                    <Check className="w-5 h-5" />
                    Generate {mode === 'receipt' ? 'Receipt' : 'Ledger'}
                    {labelled > 0 && (
                        <span className="ml-1 bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                            {labelled} labelled
                        </span>
                    )}
                </motion.button>
            </div>

            {/* Label bottom sheet */}
            <AnimatePresence>
                {activeIdx !== null && activeTransaction && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            className="fixed inset-0 bg-black/40 z-30"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setActiveIdx(null)}
                        />

                        {/* Sheet */}
                        <motion.div
                            className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-3xl max-h-[85vh] overflow-hidden flex flex-col"
                            style={{ boxShadow: '0 -8px 40px rgba(0,0,0,0.15)' }}
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                        >
                            {/* Sheet handle */}
                            <div className="flex justify-center pt-3 pb-1">
                                <div className="w-10 h-1 rounded-full bg-gray-200" />
                            </div>

                            {/* Sheet header */}
                            <div className="px-5 py-3 border-b border-gray-100">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-gray-900 truncate">{activeTransaction.recipient}</p>
                                        <p className="text-xs text-gray-400 font-mono">{activeTransaction.transactionCode}</p>
                                        <p className={`text-base font-bold mt-1 ${activeTransaction.type === 'received' ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                            {activeTransaction.type === 'received' ? '+' : '-'}{fmt(activeTransaction.amount)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setActiveIdx(null)}
                                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100"
                                    >
                                        <X className="w-4 h-4 text-gray-500" />
                                    </button>
                                </div>
                                <p className="text-xs text-[#00A651] font-medium mt-2">Choose a label for this transaction</p>
                            </div>

                            {/* Preset labels */}
                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                                {PRESET_LABELS.map(label => {
                                    const isActive = activeTransaction.label === label && !activeTransaction.customLabel;
                                    return (
                                        <motion.button
                                            key={label}
                                            onClick={() => setLabel(activeIdx, label)}
                                            className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border transition-all text-left ${
                                                isActive
                                                    ? 'border-[#00A651] bg-green-50'
                                                    : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                                            }`}
                                            whileTap={{ scale: 0.98 }}
                                        >
                                            <span className={`text-sm font-medium ${isActive ? 'text-[#00A651]' : 'text-gray-800'}`}>
                                                {label}
                                            </span>
                                            {isActive && <Check className="w-4 h-4 text-[#00A651] flex-shrink-0" />}
                                        </motion.button>
                                    );
                                })}

                                {/* Custom label input */}
                                <div className="pt-2 pb-1">
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Custom label</p>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={customInput}
                                            onChange={e => setCustomInput(e.target.value)}
                                            placeholder="e.g. Java lunch, Autoexpress, Bolt ride..."
                                            className="flex-1 px-4 py-3 bg-gray-100 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A651]/30"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && customInput.trim()) {
                                                    setLabel(activeIdx, 'Other Business Expense', customInput.trim());
                                                }
                                            }}
                                        />
                                        <motion.button
                                            onClick={() => {
                                                if (customInput.trim()) {
                                                    setLabel(activeIdx, 'Other Business Expense', customInput.trim());
                                                }
                                            }}
                                            disabled={!customInput.trim()}
                                            className="px-4 py-3 rounded-xl bg-[#00A651] text-white font-semibold text-sm disabled:opacity-40"
                                            whileTap={{ scale: 0.95 }}
                                        >
                                            Set
                                        </motion.button>
                                    </div>
                                </div>

                                {/* Clear label option */}
                                {activeTransaction.label && (
                                    <button
                                        onClick={() => {
                                            clearLabel(activeIdx);
                                            setActiveIdx(null);
                                        }}
                                        className="w-full py-3 text-sm text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        Remove label
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </motion.div>
    );
}