import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import type { ParsedTransaction } from '../types';
import { generateReceiptHTML, generateReceiptPDF } from '../lib/receiptGenerator';
import { generateLedgerCSV, generateLedgerSummaryCSV } from '../lib/ledgerGenerator';
import { downloadHTML, downloadCSV, downloadPDF, getMpesaFilenames } from '../lib/downloadUtils';
import { ArrowLeft, Inbox, Download, Tag, ChevronDown, Share2, ClipboardCopy, Check } from 'lucide-react';

interface OutputScreenProps {
    mode: 'receipt' | 'ledger';
    transactions: ParsedTransaction[];
    dateRangeLabel: string;
    onReset: () => void;
    onBack: () => void;
}

// ── CountUp ───────────────────────────────────────────────────────────────────

function CountUp({ to, decimals = 2 }: { to: number; decimals?: number }) {
    const [display, setDisplay] = useState(0);
    const raf   = useRef<number>(0);
    const start = useRef<number | null>(null);

    useEffect(() => {
        start.current = null;
        const animate = (ts: number) => {
            if (!start.current) start.current = ts;
            const p = Math.min((ts - start.current) / 900, 1);
            setDisplay((1 - Math.pow(1 - p, 3)) * to);
            if (p < 1) raf.current = requestAnimationFrame(animate);
        };
        raf.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(raf.current);
    }, [to]);

    return <>{display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</>;
}

// ── AnimatedCheck ─────────────────────────────────────────────────────────────

function AnimatedCheck() {
    return (
        <div className="relative flex items-center justify-center w-16 h-16 mx-auto">
            <motion.div className="absolute inset-0 rounded-full bg-[#00A651]/10"
                initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }}
                transition={{ duration: 0.5, times: [0, 0.6, 1] }} />
            <motion.div className="absolute inset-0 rounded-full border-2 border-[#00A651]/20"
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 2.2, opacity: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }} />
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <motion.circle cx="32" cy="32" r="28" stroke="#00A651" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5 }} />
                <motion.path d="M20 32l9 9 15-16" stroke="#00A651" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ delay: 0.4, duration: 0.4 }} />
            </svg>
        </div>
    );
}

// ── Label picker ──────────────────────────────────────────────────────────────

const LABEL_PRESETS = ['Transport', 'Accommodation', 'Fuel', 'Medical Aid'];

function LabelPicker({
    current, onChange, onClose,
}: {
    current: string | null;
    onChange: (v: string | null) => void;
    onClose: () => void;
}) {
    const [custom, setCustom] = useState(
        current && !LABEL_PRESETS.includes(current) ? current : ''
    );
    const [showCustom, setShowCustom] = useState(
        !!(current && !LABEL_PRESETS.includes(current))
    );

    function select(v: string) { onChange(v); onClose(); }
    function submitCustom() { if (custom.trim()) { onChange(custom.trim()); onClose(); } }
    function clear() { onChange(null); onClose(); }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute z-20 top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
        >
            <div className="p-1.5 space-y-0.5">
                {LABEL_PRESETS.map(p => (
                    <button key={p} onClick={() => select(p)}
                        className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                            current === p ? 'bg-green-50 text-green-700 font-semibold' : 'hover:bg-gray-50 text-gray-700'
                        }`}>
                        {p}
                    </button>
                ))}
                <button onClick={() => setShowCustom(s => !s)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-500 flex items-center justify-between">
                    Other <ChevronDown className="w-3 h-3" />
                </button>
                {showCustom && (
                    <div className="px-2 pb-1 flex gap-1">
                        <input autoFocus value={custom} onChange={e => setCustom(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCustom()}
                            placeholder="Type label…"
                            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-green-400" />
                        <button onClick={submitCustom} className="text-xs bg-green-500 text-white px-2 rounded-lg">✓</button>
                    </div>
                )}
                {current && (
                    <button onClick={clear} className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-red-50 text-red-500">
                        Remove label
                    </button>
                )}
            </div>
        </motion.div>
    );
}

// ── Static config ─────────────────────────────────────────────────────────────

const statRows = [
    { key: 'received',   label: 'Received',          dot: 'bg-green-500'   },
    { key: 'personSend', label: 'Sent to people',    dot: 'bg-red-400'     },
    { key: 'pochi',      label: 'Pochi la Biashara', dot: 'bg-rose-400'    },
    { key: 'paybill',    label: 'Paybill & Till',    dot: 'bg-blue-400'    },
    { key: 'airtime',    label: 'Airtime',            dot: 'bg-yellow-400'  },
    { key: 'data',       label: 'Data Bundles',       dot: 'bg-orange-400'  },
    { key: 'withdrawal', label: 'Cash withdrawals',  dot: 'bg-purple-400'  },
    { key: 'mshwari',    label: 'M-Shwari',          dot: 'bg-emerald-400' },
    { key: 'investment', label: 'Investments',        dot: 'bg-teal-400'    },
] as const;

const subTypeLabel = (t: ParsedTransaction) => ({
    person_send: 'Send', person_receive: 'Received', pochi_send: 'Pochi',
    paybill: 'Paybill', airtime: 'Airtime', data: 'Data',
    withdrawal: 'Withdrawal', mshwari: 'M-Shwari', investment: 'Investment', unknown: 'Other',
} as Record<string, string>)[t.subType] ?? t.type;

const subTypeBadge = (t: ParsedTransaction) => ({
    person_receive: 'bg-green-100 text-green-800',  pochi_send: 'bg-rose-100 text-rose-800',
    paybill: 'bg-blue-100 text-blue-800',           airtime: 'bg-yellow-100 text-yellow-800',
    data: 'bg-orange-100 text-orange-800',          withdrawal: 'bg-purple-100 text-purple-800',
    mshwari: 'bg-emerald-100 text-emerald-800',     investment: 'bg-teal-100 text-teal-800',
} as Record<string, string>)[t.subType] ?? 'bg-red-100 text-red-800';

const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.2 } }
};
const rowAnim: Variants = {
    hidden: { opacity: 0, x: -16 },
    show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSummaryText(
    dateRangeLabel: string,
    totalReceived: number,
    trueOutflow: number,
    netFlow: number,
    totalFees: number,
): string {
    const fmt = (n: number) => `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
    const lines = [
        `M-Track Summary — ${dateRangeLabel}`,
        `─────────────────────────`,
        `Received:  ${fmt(totalReceived)}`,
        `Spent:     ${fmt(trueOutflow)}`,
        ...(totalFees > 0 ? [`Fees paid: ${fmt(totalFees)}`] : []),
        `Net:       ${fmt(netFlow)}`,
        `─────────────────────────`,
        `Generated by M-Track`,
    ];
    return lines.join('\n');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OutputScreen({ mode, transactions: initialTransactions, dateRangeLabel, onReset, onBack }: OutputScreenProps) {
    const [txns, setTxns] = useState<ParsedTransaction[]>(initialTransactions);
    const [downloading, setDownloading]   = useState<string | null>(null);
    const [openLabelId, setOpenLabelId]   = useState<string | null>(null);
    const [copied, setCopied]             = useState(false);
    const [shareError, setShareError]     = useState<string | null>(null);

    const activeTxns = txns.filter(t => !t.excludedFromReceipt);
    const totalFees  = activeTxns.reduce((s, t) => s + (t.transactionCost ?? 0), 0);

    const sum = (fn: (t: ParsedTransaction) => boolean) =>
        activeTxns.filter(fn).reduce((s, t) => s + t.amount, 0);

    const totalReceived   = sum(t => t.subType === 'person_receive');
    const personSendTotal = sum(t => t.subType === 'person_send');
    const paybillTotal    = sum(t => t.subType === 'paybill');
    const airtimeTotal    = sum(t => t.subType === 'airtime');
    const withdrawalTotal = sum(t => t.subType === 'withdrawal');
    const mshwariTotal    = sum(t => t.subType === 'mshwari');
    const pochiTotal      = sum(t => t.subType === 'pochi_send');
    const dataTotal       = sum(t => t.subType === 'data');
    const investmentTotal = sum(t => t.subType === 'investment');
    const trueOutflow     = personSendTotal + pochiTotal + paybillTotal + airtimeTotal + dataTotal + withdrawalTotal;
    const netFlow         = totalReceived - trueOutflow;

    const statValues: Record<string, number> = {
        received: totalReceived, personSend: personSendTotal, pochi: pochiTotal,
        paybill: paybillTotal, airtime: airtimeTotal, data: dataTotal,
        withdrawal: withdrawalTotal, mshwari: mshwariTotal, investment: investmentTotal,
    };

    const fmt = (n: number) => `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

    function setLabel(code: string, label: string | null) {
        setTxns(prev => prev.map(t => t.transactionCode === code ? { ...t, receiptLabel: label } : t));
    }
    function toggleExclude(code: string) {
        setTxns(prev => prev.map(t =>
            t.transactionCode === code ? { ...t, excludedFromReceipt: !t.excludedFromReceipt } : t
        ));
    }

    // ── Share ────────────────────────────────────────────────────────────────

    const handleShare = async () => {
        const text = buildSummaryText(dateRangeLabel, totalReceived, trueOutflow, netFlow, totalFees);
        // Try sharing a generated HTML file first (desktop/mobile), fall back to text
        if (navigator.share) {
            try {
                await navigator.share({ title: 'M-Track Summary', text });
                return;
            } catch (err) {
                // User cancelled — not an error worth showing
                if ((err as Error).name === 'AbortError') return;
            }
        }
        // Fallback: copy to clipboard
        try {
            await navigator.clipboard.writeText(text);
            setShareError('Web Share not supported — summary copied to clipboard instead');
            setTimeout(() => setShareError(null), 3500);
        } catch {
            setShareError('Unable to share on this device');
            setTimeout(() => setShareError(null), 3000);
        }
    };

    // ── Copy summary ─────────────────────────────────────────────────────────

    const handleCopySummary = async () => {
        const text = buildSummaryText(dateRangeLabel, totalReceived, trueOutflow, netFlow, totalFees);
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked — silently ignore
        }
    };

    // ── Download handlers ────────────────────────────────────────────────────

    const handleDownloadPDF = async () => {
        setDownloading('pdf');
        try {
            const [blob, filenames] = await Promise.all([
                Promise.resolve(generateReceiptPDF(txns, dateRangeLabel)),
                getMpesaFilenames(txns, mode),
            ]);
            downloadPDF(blob, filenames.pdf);
        } finally { setDownloading(null); }
    };

    const handleDownloadHTML = async () => {
        setDownloading('html');
        try {
            const [html, filenames] = await Promise.all([
                Promise.resolve(generateReceiptHTML(txns, dateRangeLabel)),
                getMpesaFilenames(txns, mode),
            ]);
            downloadHTML(html, filenames.html);
        } finally { setDownloading(null); }
    };

    const handleDownloadCSV = async () => {
        setDownloading('csv');
        try {
            const [csv, filenames] = await Promise.all([
                Promise.resolve(generateLedgerCSV(txns, dateRangeLabel)),
                getMpesaFilenames(txns, mode),
            ]);
            downloadCSV(csv, filenames.csv);
        } finally { setDownloading(null); }
    };

    const handleDownloadCSVSummary = async () => {
        setDownloading('csvSummary');
        try {
            const [csv, filenames] = await Promise.all([
                Promise.resolve(generateLedgerSummaryCSV(txns)),
                getMpesaFilenames(txns, mode),
            ]);
            downloadCSV(csv, filenames.csvSummary);
        } finally { setDownloading(null); }
    };

    // ── Empty state ──────────────────────────────────────────────────────────

    if (txns.length === 0) {
        return (
            <motion.div className="flex flex-col items-center justify-center min-h-screen p-6 bg-white"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
                <div className="max-w-md w-full space-y-5 text-center">
                    <Inbox className="w-16 h-16 mx-auto text-gray-200" />
                    <h2 className="text-xl font-bold text-gray-900">No messages detected</h2>
                    <p className="text-sm text-gray-500">Make sure you copied full M-PESA confirmation messages.</p>
                    <motion.button onClick={onBack} className="w-full min-h-[52px] rounded-2xl bg-[#00A651] text-white font-semibold" whileTap={{ scale: 0.97 }}>
                        Go back and try again
                    </motion.button>
                    <motion.button onClick={onReset} className="w-full min-h-[52px] rounded-2xl bg-gray-100 text-gray-600 font-semibold" whileTap={{ scale: 0.97 }}>
                        Start over
                    </motion.button>
                </div>
            </motion.div>
        );
    }

    // ── Download button ──────────────────────────────────────────────────────

    function DownloadButton({ dlKey, label, primary, onClick }: {
        dlKey: string; label: string; primary: boolean; onClick: () => void;
    }) {
        const isLoading = downloading === dlKey;
        return (
            <motion.button onClick={onClick} disabled={downloading !== null}
                className={`relative w-full min-h-[52px] rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 overflow-hidden transition-opacity
                    ${primary ? 'bg-[#00A651] text-white' : 'bg-white text-[#00A651] border border-[#00A651]/30'}
                    ${downloading !== null && !isLoading ? 'opacity-50' : ''}`}
                style={primary ? { boxShadow: '0 4px 16px rgba(0,166,81,0.25)' } : {}}
                whileTap={{ scale: 0.97 }}>
                <AnimatePresence mode="wait">
                    {isLoading ? (
                        <motion.div key="loading" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <motion.div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent"
                                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }} />
                            Generating…
                        </motion.div>
                    ) : (
                        <motion.div key="label" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <Download className="w-4 h-4" />{label}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.button>
        );
    }

    const previewTxns    = txns.slice(0, 5);
    const remainingCount = txns.length - 5;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <motion.div className="flex flex-col min-h-screen bg-gray-50"
            initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}>

            {/* Header */}
            <div className="sticky top-0 z-10 h-14 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center px-4">
                <motion.button onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 text-gray-600"
                    whileTap={{ scale: 0.88 }}>
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-gray-900">M-Track</span>
                </div>
                <div className="w-9" />
            </div>

            <div className="flex-1 px-4 pt-5 pb-10 space-y-5 max-w-md mx-auto w-full">

                {/* Success header */}
                <motion.div className="text-center space-y-3 pt-2"
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
                    <AnimatedCheck />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            {mode === 'receipt' ? 'Receipt ready' : 'Ledger ready'}
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            {activeTxns.length} transaction{activeTxns.length !== 1 ? 's' : ''} · {dateRangeLabel}
                        </p>
                    </div>

                    {/* Share + Copy row */}
                    <div className="flex items-center justify-center gap-3 pt-1">
                        <motion.button onClick={handleShare}
                            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 px-4 py-2 rounded-xl"
                            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                            whileTap={{ scale: 0.95 }}>
                            <Share2 className="w-4 h-4" />
                            Share
                        </motion.button>
                        <motion.button onClick={handleCopySummary}
                            className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl border transition-colors ${
                                copied
                                    ? 'bg-green-50 border-green-200 text-green-700'
                                    : 'bg-white border-gray-200 text-gray-600'
                            }`}
                            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                            whileTap={{ scale: 0.95 }}>
                            {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                            {copied ? 'Copied!' : 'Copy summary'}
                        </motion.button>
                    </div>

                    {/* Share error / fallback notice */}
                    <AnimatePresence>
                        {shareError && (
                            <motion.p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2"
                                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                {shareError}
                            </motion.p>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Stats card */}
                <motion.div className="bg-white rounded-2xl overflow-hidden"
                    style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 28 }}>
                    <div className="px-4 py-3 border-b border-gray-100">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Breakdown</span>
                    </div>
                    <motion.div variants={container} initial="hidden" animate="show">
                        {statRows.map(({ key, label, dot }) => (
                            <motion.div key={key} variants={rowAnim}
                                className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                                <div className="flex items-center gap-2.5">
                                    <span className={`w-2 h-2 rounded-full ${dot} flex-shrink-0`} />
                                    <span className="text-sm text-gray-700">{label}</span>
                                </div>
                                <span className={`text-sm font-semibold tabular-nums ${key === 'received' ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                    Ksh <CountUp to={statValues[key]} />
                                </span>
                            </motion.div>
                        ))}
                    </motion.div>
                    {/* Net row */}
                    <motion.div className="px-4 py-3 bg-gray-50 border-t border-gray-100"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-800">Net flow</span>
                            <span className={`text-sm font-bold tabular-nums ${netFlow >= 0 ? 'text-[#00A651]' : 'text-red-600'}`}>
                                {netFlow < 0 ? '-' : ''}Ksh <CountUp to={Math.abs(netFlow)} />
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Savings &amp; investments excluded</p>
                    </motion.div>
                    {/* Fees row */}
                    {totalFees > 0 && (
                        <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-amber-800">M-PESA fees paid</span>
                                <span className="text-sm font-bold tabular-nums text-amber-700">{fmt(totalFees)}</span>
                            </div>
                            <p className="text-xs text-amber-600 mt-0.5">Included in your receipt total</p>
                        </div>
                    )}
                </motion.div>

                {/* Receipt builder — receipt mode only */}
                {mode === 'receipt' && (
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, type: 'spring', stiffness: 380, damping: 28 }}>
                        <div className="flex items-center justify-between mb-2 px-1">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Build Receipt</p>
                            <p className="text-xs text-gray-400">{activeTxns.length} of {txns.length} included</p>
                        </div>
                        <div className="bg-white rounded-2xl overflow-hidden divide-y divide-gray-50"
                            style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
                            {txns.map(t => (
                                <div key={t.transactionCode}
                                    className={`px-4 py-3 transition-opacity ${t.excludedFromReceipt ? 'opacity-40' : ''}`}>
                                    <div className="flex items-start gap-3">
                                        <button onClick={() => toggleExclude(t.transactionCode)}
                                            className="flex-shrink-0 mt-0.5"
                                            aria-label={t.excludedFromReceipt ? 'Add to receipt' : 'Remove from receipt'}>
                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                                t.excludedFromReceipt ? 'border-gray-200 bg-white' : 'border-[#00A651] bg-[#00A651]'
                                            }`}>
                                                {!t.excludedFromReceipt && (
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                        <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                                    </svg>
                                                )}
                                            </div>
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-gray-900 truncate">
                                                    {t.recipient.length > 22 ? t.recipient.slice(0, 22) + '…' : t.recipient}
                                                </p>
                                                <span className={`text-sm font-semibold tabular-nums flex-shrink-0 ${t.type === 'received' ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                                    {t.type === 'sent' ? '-' : '+'}{fmt(t.amount)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-gray-400">
                                                    {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {t.transactionCode}
                                                </span>
                                                {t.transactionCost != null && t.transactionCost > 0 && (
                                                    <span className="text-xs text-amber-600">fee {fmt(t.transactionCost)}</span>
                                                )}
                                            </div>
                                        </div>
                                        {!t.excludedFromReceipt && (
                                            <div className="relative flex-shrink-0">
                                                <button
                                                    onClick={() => setOpenLabelId(
                                                        openLabelId === t.transactionCode ? null : t.transactionCode
                                                    )}
                                                    className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                                        t.receiptLabel
                                                            ? 'bg-green-50 border-green-200 text-green-700'
                                                            : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'
                                                    }`}>
                                                    <Tag className="w-3 h-3" />
                                                    {t.receiptLabel ? t.receiptLabel : 'Label'}
                                                </button>
                                                <AnimatePresence>
                                                    {openLabelId === t.transactionCode && (
                                                        <LabelPicker
                                                            current={t.receiptLabel}
                                                            onChange={v => setLabel(t.transactionCode, v)}
                                                            onClose={() => setOpenLabelId(null)}
                                                        />
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Preview table — ledger mode only */}
                {mode === 'ledger' && (
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25, type: 'spring', stiffness: 380, damping: 28 }}>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">Preview</p>
                        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
                            <table className="w-full text-sm">
                                <thead className="border-b border-gray-100">
                                    <tr>
                                        <th className="text-left p-3 text-xs font-medium text-gray-400">Date</th>
                                        <th className="text-left p-3 text-xs font-medium text-gray-400">Type</th>
                                        <th className="text-right p-3 text-xs font-medium text-gray-400">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewTxns.map((t, idx) => (
                                        <motion.tr key={idx} className="border-b border-gray-50 last:border-0"
                                            initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.3 + idx * 0.06, type: 'spring', stiffness: 380, damping: 28 }}>
                                            <td className="p-3 text-xs text-gray-500">{t.date.toLocaleDateString('en-GB')}</td>
                                            <td className="p-3">
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${subTypeBadge(t)}`}>
                                                    {subTypeLabel(t)}
                                                </span>
                                            </td>
                                            <td className={`p-3 text-xs font-semibold text-right tabular-nums ${t.type === 'received' ? 'text-[#00A651]' : 'text-gray-900'}`}>
                                                {fmt(t.amount)}
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {remainingCount > 0 && (
                            <p className="text-center text-xs text-gray-400 mt-2">
                                + {remainingCount} more transaction{remainingCount !== 1 ? 's' : ''}
                            </p>
                        )}
                    </motion.div>
                )}

                {/* Download buttons */}
                <motion.div className="space-y-3"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, type: 'spring', stiffness: 380, damping: 28 }}>
                    {mode === 'receipt' ? (
                        <>
                            <DownloadButton dlKey="pdf"  label="Download Receipt (PDF)"  primary={true}  onClick={handleDownloadPDF}  />
                            <DownloadButton dlKey="html" label="Download Receipt (HTML)" primary={false} onClick={handleDownloadHTML} />
                            <p className="text-xs text-gray-400 text-center">PDF · thermal format · HTML · print to PDF from browser</p>
                        </>
                    ) : (
                        <>
                            <DownloadButton dlKey="csv"        label="Download Full Ledger (CSV)"      primary={true}  onClick={handleDownloadCSV}        />
                            <DownloadButton dlKey="csvSummary" label="Download Category Summary (CSV)" primary={false} onClick={handleDownloadCSVSummary} />
                            <p className="text-xs text-gray-400 text-center">Opens in Excel, Google Sheets or Numbers</p>
                        </>
                    )}
                </motion.div>

                {/* Start over */}
                <motion.div className="border-t border-gray-200 pt-4 pb-4"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    <motion.button onClick={onReset}
                        className="w-full min-h-[48px] rounded-2xl bg-white text-gray-500 font-medium border border-gray-200 text-sm"
                        whileTap={{ scale: 0.97 }}
                        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                        Start over
                    </motion.button>
                </motion.div>

            </div>

            {/* Dismiss label picker on outside click */}
            {openLabelId && (
                <div className="fixed inset-0 z-10" onClick={() => setOpenLabelId(null)} />
            )}
        </motion.div>
    );
}