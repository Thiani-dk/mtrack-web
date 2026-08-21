import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import type { InputSource, ParsedTransaction } from '../types';
import { generateReceiptHTML, generateReceiptPDF } from '../lib/receiptGenerator';
import { downloadHTML, downloadPDF, getReceiptFilenames } from '../lib/downloadUtils';
import { detectFlags, type DangerFlag } from '../lib/flagDetector';
import { ArrowLeft, Inbox, Download, Tag, ChevronDown, Share2, ClipboardCopy, Check, AlertTriangle, Info, Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface OutputScreenProps {
    transactions: ParsedTransaction[];
    dateRangeLabel: string;
    inputSource: InputSource;
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
            <motion.div className="absolute inset-0 rounded-full bg-[#E8850A]/10"
                initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }}
                transition={{ duration: 0.5, times: [0, 0.6, 1] }} />
            <motion.div className="absolute inset-0 rounded-full border-2 border-[#E8850A]/20"
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 2.2, opacity: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }} />
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <motion.circle cx="32" cy="32" r="28" stroke="#E8850A" strokeWidth="2.5" fill="none"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5 }} />
                <motion.path d="M20 32l9 9 15-16" stroke="#E8850A" strokeWidth="3"
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
            className="glass-panel absolute z-20 top-full left-0 mt-1 w-52 rounded-xl overflow-hidden"
        >
            <div className="p-1.5 space-y-0.5">
                {LABEL_PRESETS.map(p => (
                    <button key={p} onClick={() => select(p)}
                        className="w-full text-left text-xs px-3 py-2 rounded-lg transition-colors"
                        style={current === p
                            ? { background: 'var(--accent-subtle)', color: 'var(--accent)', fontWeight: 600 }
                            : { color: 'var(--text-secondary)' }}>
                        {p}
                    </button>
                ))}
                <button onClick={() => setShowCustom(s => !s)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] flex items-center justify-between">
                    Other <ChevronDown className="w-3 h-3" />
                </button>
                {showCustom && (
                    <div className="px-2 pb-1 flex gap-1">
                        <input autoFocus value={custom} onChange={e => setCustom(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCustom()}
                            placeholder="Type label…"
                            className="flex-1 text-xs border border-[var(--border-glass)] bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[var(--accent)]" />
                        <button onClick={submitCustom} className="text-xs text-white px-2 rounded-lg" style={{ background: 'var(--accent)' }}>✓</button>
                    </div>
                )}
                {current && (
                    <button onClick={clear} className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-500">
                        Remove label
                    </button>
                )}
            </div>
        </motion.div>
    );
}

// ── PWO Danger Zone Card ──────────────────────────────────────────────────────

function PWOCard({ flags }: { flags: DangerFlag[] }) {
    const fmtAmount = (n: number) =>
        `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, type: 'spring', stiffness: 380, damping: 28 }}
            className="glass-card overflow-hidden"
        >
            {/* Card header */}
            <div className="px-4 pt-4 pb-3 border-b border-[var(--border-glass)] flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0">
                    <Search className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                </div>
                <div>
                    <p className="text-sm font-bold text-[var(--text-primary)]">PWO Pattern Check</p>
                    <p className="text-xs text-[var(--text-secondary)]">Based on your transaction history</p>
                </div>
            </div>

            {/* Flags */}
            <div className="divide-y divide-[var(--border-glass)]">
                {flags.map((flag, i) => (
                    <motion.div
                        key={flag.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.22 + i * 0.07, type: 'spring', stiffness: 380, damping: 28 }}
                        className="px-4 py-3.5"
                    >
                        {/* Flag header */}
                        <div className="flex items-start gap-3">
                            {flag.severity === 'warning' ? (
                                <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                                    style={{ background: 'var(--warn-bg)' }}>
                                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--warn-heading)' }} />
                                </div>
                            ) : (
                                <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                                    style={{ background: 'var(--info-bg)' }}>
                                    <Info className="w-3.5 h-3.5" style={{ color: 'var(--info-icon)' }} />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold"
                                    style={{ color: flag.severity === 'warning' ? 'var(--warn-heading)' : 'var(--info-heading)' }}>
                                    {flag.title}
                                </p>
                                <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">{flag.detail}</p>
                            </div>
                        </div>

                        {/* Matched transactions */}
                        {flag.matchedTransactions.length > 0 && (
                            <div className="mt-2.5 ml-9 space-y-1">
                                {flag.matchedTransactions.map(t => (
                                    <div
                                        key={t.transactionCode}
                                        className="flex items-center justify-between gap-2 bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5"
                                    >
                                        <span className="text-xs text-[var(--text-secondary)] truncate">
                                            {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                            {' · '}
                                            {t.recipient.length > 18 ? t.recipient.slice(0, 18) + '…' : t.recipient}
                                        </span>
                                        <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${
                                            t.type === 'received' ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
                                        }`}>
                                            {t.type === 'sent' ? '-' : '+'}{fmtAmount(t.amount)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </motion.div>
                ))}
            </div>

            {/* Footer disclaimer */}
            <div className="bg-[var(--bg-elevated)] border-t border-[var(--border-glass)] px-4 py-3">
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    This is informational only — not legal advice. Based on KRA's published PWO guidelines (April 2026).
                </p>
            </div>
        </motion.div>
    );
}

// ── Static config ─────────────────────────────────────────────────────────────

const statRows = [
    { key: 'received',   label: 'Received',          dot: 'bg-[#E8850A]'  },
    { key: 'personSend', label: 'Sent to people',    dot: 'bg-red-400'     },
    { key: 'pochi',      label: 'Pochi la Biashara', dot: 'bg-rose-400'    },
    { key: 'paybill',    label: 'Paybill & Till',    dot: 'bg-blue-400'    },
    { key: 'airtime',    label: 'Airtime',            dot: 'bg-yellow-400'  },
    { key: 'data',       label: 'Data Bundles',       dot: 'bg-orange-400'  },
    { key: 'withdrawal', label: 'Cash withdrawals',  dot: 'bg-purple-400'  },
    { key: 'mshwari',    label: 'M-Shwari',          dot: 'bg-emerald-400' },
    { key: 'investment', label: 'Investments',        dot: 'bg-teal-400'    },
] as const;

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

// ── Download button ──────────────────────────────────────────────────────────

function DownloadButton({ dlKey, label, primary, onClick, downloading }: {
    dlKey: string; label: string; primary: boolean; onClick: () => void; downloading: string | null;
}) {
    const isLoading = downloading === dlKey;
    return (
        <motion.button onClick={onClick} disabled={downloading !== null}
            className={`${primary ? 'btn-primary' : 'btn-secondary'} relative w-full min-h-[52px] rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 overflow-hidden`}
            style={isLoading ? { opacity: 1 } : undefined}
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

// ── Component ─────────────────────────────────────────────────────────────────

export function OutputScreen({ transactions: initialTransactions, dateRangeLabel, inputSource, onReset, onBack }: OutputScreenProps) {
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

    // PWO flags — only computed when source is XML, runs on filtered txns
    const pwoFlags: DangerFlag[] = inputSource === 'xml' ? detectFlags(txns) : [];

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
        if (navigator.share) {
            try {
                await navigator.share({ title: 'M-Track Summary', text });
                return;
            } catch (err) {
                if ((err as Error).name === 'AbortError') return;
            }
        }
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
                getReceiptFilenames(txns),
            ]);
            downloadPDF(blob, filenames.pdf);
        } finally { setDownloading(null); }
    };

    const handleDownloadHTML = async () => {
        setDownloading('html');
        try {
            const [html, filenames] = await Promise.all([
                Promise.resolve(generateReceiptHTML(txns, dateRangeLabel)),
                getReceiptFilenames(txns),
            ]);
            downloadHTML(html, filenames.html);
        } finally { setDownloading(null); }
    };

    // ── Empty state ──────────────────────────────────────────────────────────

    if (txns.length === 0) {
        return (
            <motion.div className="flex flex-col items-center justify-center min-h-screen p-6 bg-[var(--bg-base)]"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
                <div className="max-w-md w-full space-y-5 text-center">
                    <Inbox className="w-16 h-16 mx-auto text-[var(--text-muted)]" />
                    <h2 className="text-xl font-bold text-[var(--text-primary)]">No messages detected</h2>
                    <p className="text-sm text-[var(--text-secondary)]">Make sure you copied full M-PESA confirmation messages.</p>
                    <motion.button onClick={onBack} className="btn-primary w-full min-h-[52px] rounded-2xl font-semibold" whileTap={{ scale: 0.97 }}>
                        Go back and try again
                    </motion.button>
                    <motion.button onClick={onReset} className="btn-secondary w-full min-h-[52px] rounded-2xl font-semibold" whileTap={{ scale: 0.97 }}>
                        Start over
                    </motion.button>
                </div>
            </motion.div>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <motion.div className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}>

            {/* Header */}
            <div className="glass-header sticky top-0 z-10 h-14 border-b border-[var(--border-glass)] flex items-center px-4">
                <motion.button onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    whileTap={{ scale: 0.88 }}>
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">M-Track</span>
                </div>
                <ThemeToggle />
            </div>

            <div className="flex-1 px-4 pt-5 pb-10 space-y-5 max-w-md mx-auto w-full">

                {/* Success header */}
                <motion.div className="text-center space-y-3 pt-2"
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
                    <AnimatedCheck />
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                            Receipt ready
                        </h1>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">
                            {activeTxns.length} transaction{activeTxns.length !== 1 ? 's' : ''} · {dateRangeLabel}
                        </p>
                    </div>

                    {/* Share + Copy row */}
                    <div className="flex items-center justify-center gap-3 pt-1">
                        <motion.button onClick={handleShare}
                            className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-glass)] px-4 py-2 rounded-xl"
                            whileTap={{ scale: 0.95 }}>
                            <Share2 className="w-4 h-4" />
                            Share
                        </motion.button>
                        <motion.button onClick={handleCopySummary}
                            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl border transition-colors"
                            style={copied
                                ? { background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)', color: 'var(--accent)' }
                                : { background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                            whileTap={{ scale: 0.95 }}>
                            {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                            {copied ? 'Copied!' : 'Copy summary'}
                        </motion.button>
                    </div>

                    {/* Share error / fallback notice */}
                    <AnimatePresence>
                        {shareError && (
                            <motion.p className="text-xs rounded-lg px-3 py-2"
                                style={{ color: 'var(--warn-text)', background: 'var(--warn-bg)' }}
                                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                {shareError}
                            </motion.p>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Stats card */}
                <motion.div className="glass-card overflow-hidden"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 28 }}>
                    <div className="px-4 py-3 border-b border-[var(--border-glass)]">
                        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Breakdown</span>
                    </div>
                    <motion.div variants={container} initial="hidden" animate="show">
                        {statRows.map(({ key, label, dot }) => (
                            <motion.div key={key} variants={rowAnim}
                                className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-glass)] last:border-0">
                                <div className="flex items-center gap-2.5">
                                    <span className={`w-2 h-2 rounded-full ${dot} flex-shrink-0`} />
                                    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
                                </div>
                                <span className={`text-sm font-semibold tabular-nums ${key === 'received' ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                                    Ksh <CountUp to={statValues[key]} />
                                </span>
                            </motion.div>
                        ))}
                    </motion.div>
                    {/* Net row */}
                    <motion.div className="px-4 py-3 bg-[var(--bg-elevated)] border-t border-[var(--border-glass)]"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-[var(--text-primary)]">Net flow</span>
                            <span className={`text-sm font-bold tabular-nums ${netFlow >= 0 ? 'text-[var(--accent)]' : 'text-red-500'}`}>
                                {netFlow < 0 ? '-' : ''}Ksh <CountUp to={Math.abs(netFlow)} />
                            </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Savings &amp; investments excluded</p>
                    </motion.div>
                    {/* Fees row */}
                    {totalFees > 0 && (
                        <div className="px-4 py-3 border-t border-[var(--border-glass-accent)]" style={{ background: 'var(--accent-subtle)' }}>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-[var(--accent)]">M-PESA fees paid</span>
                                <span className="text-sm font-bold tabular-nums text-[var(--accent)]">{fmt(totalFees)}</span>
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Included in your receipt total</p>
                        </div>
                    )}
                </motion.div>

                {/* ── PWO Danger Zone Card — XML uploads only ── */}
                {inputSource === 'xml' && pwoFlags.length > 0 && (
                    <PWOCard flags={pwoFlags} />
                )}

                {/* Receipt builder */}
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, type: 'spring', stiffness: 380, damping: 28 }}>
                    <div className="flex items-center justify-between mb-2 px-1">
                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Build Receipt</p>
                        <p className="text-xs text-[var(--text-muted)]">{activeTxns.length} of {txns.length} included</p>
                    </div>
                    <div className="glass-card overflow-hidden divide-y divide-[var(--border-glass)]">
                        {txns.map(t => (
                            <div key={t.transactionCode}
                                className={`px-4 py-3 transition-opacity ${t.excludedFromReceipt ? 'opacity-40' : ''}`}>
                                <div className="flex items-start gap-3">
                                    <button onClick={() => toggleExclude(t.transactionCode)}
                                        className="flex-shrink-0 mt-0.5"
                                        aria-label={t.excludedFromReceipt ? 'Add to receipt' : 'Remove from receipt'}>
                                        <div className="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors"
                                            style={t.excludedFromReceipt
                                                ? { borderColor: 'var(--border-glass)', background: 'transparent' }
                                                : { borderColor: 'var(--accent)', background: 'var(--accent)' }}>
                                            {!t.excludedFromReceipt && (
                                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            )}
                                        </div>
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                                {t.recipient.length > 22 ? t.recipient.slice(0, 22) + '…' : t.recipient}
                                            </p>
                                            <span className={`text-sm font-semibold tabular-nums flex-shrink-0 ${t.type === 'received' ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                                                {t.type === 'sent' ? '-' : '+'}{fmt(t.amount)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-[var(--text-muted)]">
                                                {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {t.transactionCode}
                                            </span>
                                            {t.transactionCost != null && t.transactionCost > 0 && (
                                                <span className="text-xs" style={{ color: 'var(--warn-heading)' }}>fee {fmt(t.transactionCost)}</span>
                                            )}
                                        </div>
                                    </div>
                                    {!t.excludedFromReceipt && (
                                        <div className="relative flex-shrink-0">
                                            <button
                                                onClick={() => setOpenLabelId(
                                                    openLabelId === t.transactionCode ? null : t.transactionCode
                                                )}
                                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                                                style={t.receiptLabel
                                                    ? { background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)', color: 'var(--accent)' }
                                                    : { background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-muted)' }}>
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

                {/* Download buttons */}
                <motion.div className="space-y-3"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, type: 'spring', stiffness: 380, damping: 28 }}>
                    <DownloadButton dlKey="pdf"  label="Download Receipt (PDF)"  primary={true}  onClick={handleDownloadPDF}  downloading={downloading} />
                    <DownloadButton dlKey="html" label="Download Receipt (HTML)" primary={false} onClick={handleDownloadHTML} downloading={downloading} />
                </motion.div>

                {/* Start over */}
                <motion.div className="border-t border-[var(--border-glass)] pt-4 pb-4"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    <motion.button onClick={onReset}
                        className="btn-secondary w-full min-h-[48px] rounded-2xl font-medium text-sm"
                        whileTap={{ scale: 0.97 }}>
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
