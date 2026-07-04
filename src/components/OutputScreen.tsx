import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import type { ParsedTransaction } from '../types';
import { generateReceiptHTML, generateReceiptPDF } from '../lib/receiptGenerator';
import { generateLedgerCSV, generateLedgerSummaryCSV } from '../lib/ledgerGenerator';
import { downloadHTML, downloadCSV, downloadPDF, getMpesaFilenames } from '../lib/downloadUtils';
import { ArrowLeft, Inbox, Download, FileText, Table2 } from 'lucide-react';

interface OutputScreenProps {
    mode: 'receipt' | 'ledger';
    range: string;
    transactions: ParsedTransaction[];
    dateRangeLabel: string;
    onReset: () => void;
    onBack: () => void;
}

// Animated counting number
function CountUp({ to, prefix = '', decimals = 2 }: { to: number; prefix?: string; decimals?: number }) {
    const [display, setDisplay] = useState(0);
    const raf = useRef<number>(0);
    const start = useRef<number | null>(null);
    const duration = 900;

    useEffect(() => {
        start.current = null;
        const animate = (ts: number) => {
            if (!start.current) start.current = ts;
            const progress = Math.min((ts - start.current) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(eased * to);
            if (progress < 1) raf.current = requestAnimationFrame(animate);
        };
        raf.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(raf.current);
    }, [to]);

    const formatted = display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return <>{prefix}{formatted}</>;
}

// Animated checkmark SVG
function AnimatedCheck() {
    return (
        <div className="relative flex items-center justify-center w-16 h-16 mx-auto">
            <motion.div
                className="absolute inset-0 rounded-full bg-[#00A651]/10"
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.3, 1] }}
                transition={{ duration: 0.5, times: [0, 0.6, 1], ease: 'easeOut' }}
            />
            <motion.div
                className="absolute inset-0 rounded-full border-2 border-[#00A651]/20"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
            />
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <motion.circle
                    cx="32" cy="32" r="28"
                    stroke="#00A651"
                    strokeWidth="2.5"
                    fill="none"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                />
                <motion.path
                    d="M20 32l9 9 15-16"
                    stroke="#00A651"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.4, duration: 0.4, ease: 'easeOut' }}
                />
            </svg>
        </div>
    );
}

const statRows = [
    { key: 'received',    label: 'Received',           dot: 'bg-green-500'   },
    { key: 'personSend',  label: 'Sent to people',     dot: 'bg-red-400'     },
    { key: 'pochi',       label: 'Pochi la Biashara',  dot: 'bg-rose-400'    },
    { key: 'paybill',     label: 'Paybill & Till',     dot: 'bg-blue-400'    },
    { key: 'airtime',     label: 'Airtime',             dot: 'bg-yellow-400'  },
    { key: 'data',        label: 'Data Bundles',        dot: 'bg-orange-400'  },
    { key: 'withdrawal',  label: 'Cash withdrawals',   dot: 'bg-purple-400'  },
    { key: 'mshwari',     label: 'M-Shwari',           dot: 'bg-emerald-400' },
    { key: 'investment',  label: 'Investments',         dot: 'bg-teal-400'    },
] as const;

const subTypeLabel = (t: ParsedTransaction) => {
    const map: Record<string, string> = {
        person_send:    'Send',
        person_receive: 'Received',
        pochi_send:     'Pochi',
        paybill:        'Paybill',
        airtime:        'Airtime',
        data:           'Data',
        withdrawal:     'Withdrawal',
        mshwari:        'M-Shwari',
        investment:     'Investment',
        unknown:        'Other',
    };
    return map[t.subType] ?? t.type;
};

const subTypeBadge = (t: ParsedTransaction) => {
    const map: Record<string, string> = {
        person_receive: 'bg-green-100 text-green-800',
        pochi_send:     'bg-rose-100 text-rose-800',
        paybill:        'bg-blue-100 text-blue-800',
        airtime:        'bg-yellow-100 text-yellow-800',
        data:           'bg-orange-100 text-orange-800',
        withdrawal:     'bg-purple-100 text-purple-800',
        mshwari:        'bg-emerald-100 text-emerald-800',
        investment:     'bg-teal-100 text-teal-800',
    };
    return map[t.subType] ?? 'bg-red-100 text-red-800';
};

const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.2 } }
};

const row: Variants = {
    hidden: { opacity: 0, x: -16 },
    show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } }
};

export function OutputScreen({ mode, range, transactions, dateRangeLabel, onReset, onBack }: OutputScreenProps) {
    const [downloading, setDownloading] = useState<string | null>(null);

    const sum = (filter: (t: ParsedTransaction) => boolean) =>
        transactions.filter(filter).reduce((s, t) => s + t.amount, 0);

    const totalTransactions = transactions.length;
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
        received:   totalReceived,
        personSend: personSendTotal,
        pochi:      pochiTotal,
        paybill:    paybillTotal,
        airtime:    airtimeTotal,
        data:       dataTotal,
        withdrawal: withdrawalTotal,
        mshwari:    mshwariTotal,
        investment: investmentTotal,
    };

    const fmt = (n: number) => `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

    // ── Download handlers ────────────────────────────────────────────────────

    const handleDownloadPDF = async () => {
        setDownloading('pdf');
        try {
            const [pdfBlob, filenames] = await Promise.all([
                Promise.resolve(generateReceiptPDF(transactions, dateRangeLabel)),
                getMpesaFilenames(transactions, mode),
            ]);
            downloadPDF(pdfBlob, filenames.pdf);
        } finally {
            setDownloading(null);
        }
    };

    const handleDownloadHTML = async () => {
        setDownloading('html');
        try {
            const [html, filenames] = await Promise.all([
                Promise.resolve(generateReceiptHTML(transactions, dateRangeLabel)),
                getMpesaFilenames(transactions, mode),
            ]);
            downloadHTML(html, filenames.html);
        } finally {
            setDownloading(null);
        }
    };

    const handleDownloadCSV = async () => {
        setDownloading('csv');
        try {
            const [csv, filenames] = await Promise.all([
                Promise.resolve(generateLedgerCSV(transactions, dateRangeLabel)),
                getMpesaFilenames(transactions, mode),
            ]);
            downloadCSV(csv, filenames.csv);
        } finally {
            setDownloading(null);
        }
    };

    const handleDownloadCSVSummary = async () => {
        setDownloading('csvSummary');
        try {
            const [csv, filenames] = await Promise.all([
                Promise.resolve(generateLedgerSummaryCSV(transactions)),
                getMpesaFilenames(transactions, mode),
            ]);
            downloadCSV(csv, filenames.csvSummary);
        } finally {
            setDownloading(null);
        }
    };

    // ── Empty state ──────────────────────────────────────────────────────────

    if (totalTransactions === 0) {
        return (
            <motion.div
                className="flex flex-col items-center justify-center min-h-screen p-6 bg-white"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            >
                <div className="max-w-md w-full space-y-5 text-center">
                    <motion.div
                        initial={{ rotate: -10, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 300 }}
                    >
                        <Inbox className="w-16 h-16 mx-auto text-gray-200" />
                    </motion.div>
                    <h2 className="text-xl font-bold text-gray-900">No messages detected</h2>
                    <p className="text-sm text-gray-500">
                        Make sure you pasted full M-PESA confirmation messages, or that your XML backup file is complete.
                    </p>
                    <motion.button
                        onClick={onBack}
                        className="w-full min-h-[52px] rounded-2xl bg-[#00A651] text-white font-semibold"
                        whileTap={{ scale: 0.97 }}
                    >
                        Go back and try again
                    </motion.button>
                    <motion.button
                        onClick={onReset}
                        className="w-full min-h-[52px] rounded-2xl bg-gray-100 text-gray-600 font-semibold"
                        whileTap={{ scale: 0.97 }}
                    >
                        Start over
                    </motion.button>
                </div>
            </motion.div>
        );
    }

    const previewTransactions = transactions.slice(0, 5);
    const remainingCount = totalTransactions - 5;

    // ── Shared download button renderer ─────────────────────────────────────

    function DownloadButton({
        dlKey,
        label,
        primary,
        onClick,
    }: {
        dlKey: string;
        label: string;
        primary: boolean;
        onClick: () => void;
    }) {
        const isLoading = downloading === dlKey;
        return (
            <motion.button
                onClick={onClick}
                disabled={downloading !== null}
                className={`relative w-full min-h-[52px] rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 overflow-hidden transition-opacity ${
                    primary
                        ? 'bg-[#00A651] text-white'
                        : 'bg-white text-[#00A651] border border-[#00A651]/30'
                } ${downloading !== null && !isLoading ? 'opacity-50' : ''}`}
                style={primary ? { boxShadow: '0 4px 16px rgba(0,166,81,0.25)' } : {}}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400 }}
            >
                <AnimatePresence mode="wait">
                    {isLoading ? (
                        <motion.div
                            key="loading"
                            className="flex items-center gap-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="w-4 h-4 rounded-full border-2 border-current border-t-transparent"
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                            />
                            Generating…
                        </motion.div>
                    ) : (
                        <motion.div
                            key="label"
                            className="flex items-center gap-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <Download className="w-4 h-4" />
                            {label}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.button>
        );
    }

    // ── Main render ──────────────────────────────────────────────────────────

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-gray-50"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="sticky top-0 z-10 h-14 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 text-gray-600"
                    whileTap={{ scale: 0.88 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-gray-900">M-Track</span>
                </div>
                <div className="w-9" />
            </div>

            <div className="flex-1 px-4 pt-5 pb-10 space-y-5 max-w-md mx-auto w-full">

                {/* Success header */}
                <motion.div
                    className="text-center space-y-3 pt-2"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <AnimatedCheck />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            {mode === 'receipt' ? 'Receipt ready' : 'Ledger ready'}
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            {totalTransactions} transaction{totalTransactions !== 1 ? 's' : ''} · {dateRangeLabel}
                        </p>
                    </div>
                </motion.div>

                {/* Stats card */}
                <motion.div
                    className="bg-white rounded-2xl overflow-hidden"
                    style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="px-4 py-3 border-b border-gray-100">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Breakdown</span>
                    </div>

                    <motion.div variants={container} initial="hidden" animate="show">
                        {statRows.map(({ key, label, dot }) => (
                            <motion.div
                                key={key}
                                variants={row}
                                className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0"
                            >
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
                    <motion.div
                        className="px-4 py-3 bg-gray-50 border-t border-gray-100"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-800">Net flow</span>
                            <span className={`text-sm font-bold tabular-nums ${netFlow >= 0 ? 'text-[#00A651]' : 'text-red-600'}`}>
                                {netFlow < 0 ? '-' : ''}Ksh <CountUp to={Math.abs(netFlow)} />
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">investments such as ZIDII excluded</p>
                    </motion.div>
                </motion.div>

                {/* Preview table */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25, type: 'spring', stiffness: 380, damping: 28 }}
                >
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
                                {previewTransactions.map((t, idx) => (
                                    <motion.tr
                                        key={idx}
                                        className="border-b border-gray-50 last:border-0"
                                        initial={{ opacity: 0, x: -12 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.3 + idx * 0.06, type: 'spring', stiffness: 380, damping: 28 }}
                                    >
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

                {/* Download buttons */}
                <motion.div
                    className="space-y-3"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    {mode === 'receipt' ? (
                        <>
                            <DownloadButton
                                dlKey="pdf"
                                label="Download Receipt (PDF)"
                                primary={true}
                                onClick={handleDownloadPDF}
                            />
                            <DownloadButton
                                dlKey="html"
                                label="Download Receipt (HTML)"
                                primary={false}
                                onClick={handleDownloadHTML}
                            />
                            <p className="text-xs text-gray-400 text-center">
                                PDF · 80mm thermal · HTML · print to PDF from browser
                            </p>
                        </>
                    ) : (
                        <>
                            <DownloadButton
                                dlKey="csv"
                                label="Download Full Ledger (CSV)"
                                primary={true}
                                onClick={handleDownloadCSV}
                            />
                            <DownloadButton
                                dlKey="csvSummary"
                                label="Download Daily Summary (CSV)"
                                primary={false}
                                onClick={handleDownloadCSVSummary}
                            />
                            <p className="text-xs text-gray-400 text-center">
                                Compatible with Excel, Google Sheets &amp; KRA filing
                            </p>
                        </>
                    )}
                </motion.div>

                {/* Start over */}
                <motion.div
                    className="border-t border-gray-200 pt-4 pb-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                >
                    <motion.button
                        onClick={onReset}
                        className="w-full min-h-[48px] rounded-2xl bg-white text-gray-500 font-medium border border-gray-200 text-sm"
                        whileTap={{ scale: 0.97 }}
                        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
                    >
                        Start over
                    </motion.button>
                    <p className="text-center text-xs text-gray-400 mt-3">Powered by M-PESA SMS data</p>
                </motion.div>

            </div>
        </motion.div>
    );
}