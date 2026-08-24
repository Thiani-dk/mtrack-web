import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StoredReceipt } from '../types';
import { useReceiptStore } from '../lib/useReceiptStore';
import { generateReceiptPDF } from '../lib/receiptGenerator';
import { downloadPDF, getReceiptFilenames } from '../lib/downloadUtils';
import { ArrowLeft, Download, Trash2, Inbox, Tag, Users } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface HistoryScreenProps {
    onBack: () => void;
    onDemoClick: () => void;
}

function fmt(n: number) {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function relativeTime(ts: number): string {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return 'Just now';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min !== 1 ? 's' : ''} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr !== 1 ? 's' : ''} ago`;
    const day = Math.floor(hr / 24);
    if (day === 1) return 'Yesterday';
    if (day < 7) return `${day} days ago`;
    const week = Math.floor(day / 7);
    if (week < 5) return `${week} week${week !== 1 ? 's' : ''} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month !== 1 ? 's' : ''} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year !== 1 ? 's' : ''} ago`;
}

function ReceiptCard({
    receipt, onDelete, confirmingDelete, onRequestDelete,
}: {
    receipt: StoredReceipt;
    onDelete: (id: string) => void;
    confirmingDelete: boolean;
    onRequestDelete: (id: string | null) => void;
}) {
    const [downloading, setDownloading] = useState(false);

    const handleRedownload = async () => {
        setDownloading(true);
        try {
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(receipt.transactions, receipt.dateRange),
                getReceiptFilenames(receipt.transactions),
            ]);
            downloadPDF(blob, filenames.pdf);
        } finally {
            setDownloading(false);
        }
    };

    const handleDeleteTap = () => {
        if (confirmingDelete) {
            onDelete(receipt.id);
        } else {
            onRequestDelete(receipt.id);
        }
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="glass-card overflow-hidden p-4 space-y-3"
        >
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{relativeTime(receipt.createdAt)}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{receipt.dateRange}</p>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{fmt(receipt.totalSpent)}</p>
                    <p className="text-xs text-[var(--text-muted)]">{receipt.transactionCount} transaction{receipt.transactionCount !== 1 ? 's' : ''}</p>
                </div>
            </div>

            {receipt.totalFees > 0 && (
                <p className="text-xs" style={{ color: 'var(--warn-heading)' }}>
                    {fmt(receipt.totalFees)} in fees paid
                </p>
            )}

            {receipt.topRecipients.length > 0 && (
                <div className="flex items-start gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1.5">
                        {receipt.topRecipients.map(r => (
                            <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                                {r}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {receipt.labels.length > 0 && (
                <div className="flex items-start gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1.5">
                        {receipt.labels.map(l => (
                            <span key={l} className="text-xs px-2 py-0.5 rounded-full border"
                                style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)', color: 'var(--accent)' }}>
                                {l}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 pt-1">
                <motion.button
                    onClick={handleRedownload}
                    disabled={downloading}
                    className="btn-secondary flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                    whileTap={{ scale: 0.97 }}
                >
                    <Download className="w-3.5 h-3.5" />
                    {downloading ? 'Generating…' : 'Save again'}
                </motion.button>
                <motion.button
                    onClick={handleDeleteTap}
                    className="min-h-[40px] px-3 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors"
                    style={confirmingDelete
                        ? { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                    whileTap={{ scale: 0.97 }}
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    {confirmingDelete ? 'Tap again to delete' : 'Delete'}
                </motion.button>
            </div>
        </motion.div>
    );
}

export function HistoryScreen({ onBack, onDemoClick }: HistoryScreenProps) {
    const { receipts, isLoading, isAvailable, deleteReceipt } = useReceiptStore();
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const handleDelete = (id: string) => {
        setConfirmDeleteId(null);
        deleteReceipt(id);
    };

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="glass-header sticky top-0 z-10 h-14 border-b border-[var(--border-glass)] flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    whileTap={{ scale: 0.88 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Past summaries</span>
                </div>
                <ThemeToggle />
            </div>

            <div className="flex-1 px-4 pt-5 pb-10 space-y-3 max-w-md mx-auto w-full">
                {!isAvailable && (
                    <p className="text-xs text-center text-[var(--text-muted)] rounded-xl px-3 py-2 bg-[var(--bg-elevated)]">
                        Can't save history in private browsing — everything else works fine, it just won't stick around after you close this.
                    </p>
                )}

                {isLoading ? (
                    <p className="text-center text-sm text-[var(--text-muted)] py-16">Loading…</p>
                ) : receipts.length === 0 ? (
                    <motion.div
                        className="flex flex-col items-center justify-center text-center py-20 space-y-4"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    >
                        <Inbox className="w-14 h-14 text-[var(--text-muted)]" />
                        <p className="text-sm text-[var(--text-secondary)] max-w-[260px]">
                            Nothing here yet. Summaries you generate will show up here — try the demo if you want to see what that looks like first.
                        </p>
                        <motion.button
                            onClick={onDemoClick}
                            className="btn-primary min-h-[48px] px-6 rounded-2xl font-semibold text-sm"
                            whileTap={{ scale: 0.97 }}
                        >
                            Try the demo
                        </motion.button>
                    </motion.div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {receipts.map(receipt => (
                            <ReceiptCard
                                key={receipt.id}
                                receipt={receipt}
                                onDelete={handleDelete}
                                confirmingDelete={confirmDeleteId === receipt.id}
                                onRequestDelete={setConfirmDeleteId}
                            />
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
}
