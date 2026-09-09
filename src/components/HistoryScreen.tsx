import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DocumentType, TrackedDocument } from '../types';
import { useDocumentStore } from '../lib/useDocumentStore';
import { computeReceiptData, generateReceiptPDF, type DocRenderMeta } from '../lib/receiptGenerator';
import { formatCovering, claimTotals } from '../lib/documentRender';
import { fmt as fmtKsh } from '../lib/receiptGenerator';
import { downloadPDF, getReceiptFilenames } from '../lib/downloadUtils';
import { ArrowLeft, Download, Trash2, Inbox, FileText, StickyNote, ReceiptText, HandCoins } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface HistoryScreenProps {
    onBack: () => void;
    onDemoClick: () => void;
    onResumeDraft: (sessionId: string) => void;
}

type FilterKey = 'all' | DocumentType;

const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expense_summary', label: 'Summaries' },
    { key: 'personal_note', label: 'Notes' },
    { key: 'point_of_sale', label: 'Receipts given' },
    { key: 'on_behalf_of', label: 'Claims' },
];

const TYPE_META: Record<DocumentType, { label: string; Icon: typeof FileText }> = {
    expense_summary: { label: 'Summary', Icon: FileText },
    personal_note: { label: 'Note', Icon: StickyNote },
    point_of_sale: { label: 'Receipt given', Icon: ReceiptText },
    on_behalf_of: { label: 'Claim', Icon: HandCoins },
};

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

function metaFor(doc: TrackedDocument): DocRenderMeta {
    return {
        documentType: doc.documentType,
        coveringFrom: doc.coveringFrom,
        coveringTo: doc.coveringTo,
        dataSource: doc.dataSource,
        merchantProfile: doc.merchantProfile,
        onBehalfOf: doc.onBehalfOf,
    };
}

function docTotal(doc: TrackedDocument): number {
    const data = computeReceiptData(doc.transactions);
    return doc.documentType === 'on_behalf_of' ? claimTotals(data).totalDue : data.grandTotal;
}

function draftStage(doc: TrackedDocument): string {
    const n = doc.transactions.filter(t => !t.excludedFromReceipt).length;
    if (n === 0) return 'Draft, just started';
    return `Draft, ${n} item${n === 1 ? '' : 's'} so far, not approved`;
}

function DocumentCard({
    doc, onDelete, confirmingDelete, onRequestDelete, onResume,
}: {
    doc: TrackedDocument;
    onDelete: (id: string) => void;
    confirmingDelete: boolean;
    onRequestDelete: (id: string | null) => void;
    onResume: (sessionId: string) => void;
}) {
    const [downloading, setDownloading] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const isDraft = doc.status === 'draft';
    const { label, Icon } = TYPE_META[doc.documentType];
    const covering = formatCovering(doc.coveringFrom, doc.coveringTo);

    const handleRedownload = async () => {
        setDownloading(true);
        try {
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(doc.transactions, metaFor(doc)),
                getReceiptFilenames(doc.transactions),
            ]);
            downloadPDF(blob, filenames.pdf);
        } catch (err) {
            console.error('Re-download failed:', err);
            setNotice("Couldn't generate the PDF, try again.");
            setTimeout(() => setNotice(null), 3000);
        } finally {
            setDownloading(false);
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
            style={isDraft ? { borderStyle: 'dashed', borderColor: 'var(--border-glass-accent)' } : undefined}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
                    </div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mt-0.5">{relativeTime(doc.updatedAt)}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {isDraft ? draftStage(doc) : (covering || 'No dates')}
                    </p>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{fmtKsh(docTotal(doc))}</p>
                    {(doc.dataSource === 'self_reported' || doc.dataSource === 'mixed') && (
                        <p className="text-[10px] text-[var(--text-muted)]">
                            {doc.dataSource === 'mixed' ? 'part entered by hand' : 'entered by hand'}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
                {isDraft ? (
                    <motion.button
                        onClick={() => onResume(doc.id)}
                        className="btn-primary flex-1 min-h-[40px] rounded-xl text-sm font-medium"
                        whileTap={{ scale: 0.97 }}
                    >
                        Continue
                    </motion.button>
                ) : (
                    <motion.button
                        onClick={handleRedownload}
                        disabled={downloading}
                        className="btn-secondary flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                        whileTap={{ scale: 0.97 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {downloading ? 'Generating…' : 'Save again'}
                    </motion.button>
                )}
                <motion.button
                    onClick={() => (confirmingDelete ? onDelete(doc.id) : onRequestDelete(doc.id))}
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

            {notice && <p className="text-xs" style={{ color: '#ef4444' }}>{notice}</p>}
        </motion.div>
    );
}

export function HistoryScreen({ onBack, onDemoClick, onResumeDraft }: HistoryScreenProps) {
    const { documents, isLoading, isAvailable, deleteDocument } = useDocumentStore();
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterKey>('all');

    const sorted = useMemo(() => {
        const filtered = filter === 'all' ? documents : documents.filter(d => d.documentType === filter);
        return [...filtered].sort((a, b) => {
            if ((a.status === 'draft') !== (b.status === 'draft')) return a.status === 'draft' ? -1 : 1;
            return b.updatedAt - a.updatedAt;
        });
    }, [documents, filter]);

    const handleDelete = (id: string) => {
        setConfirmDeleteId(null);
        deleteDocument(id);
    };

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            <div className="glass-header sticky top-0 z-10 h-14 border-b border-[var(--border-glass)] flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    whileTap={{ scale: 0.88 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Your documents</span>
                </div>
                <ThemeToggle />
            </div>

            <div className="flex-1 px-4 pt-5 pb-10 space-y-3 max-w-md mx-auto w-full">
                {!isAvailable && (
                    <p className="text-xs text-center text-[var(--text-muted)] rounded-xl px-3 py-2 bg-[var(--bg-elevated)]">
                        Can't save history in private browsing. Everything else works, it just won't stick around after you close this.
                    </p>
                )}

                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                            style={filter === f.key
                                ? { background: 'var(--accent)', color: '#ffffff' }
                                : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {isLoading ? (
                    <p className="text-center text-sm text-[var(--text-muted)] py-16">Loading…</p>
                ) : sorted.length === 0 ? (
                    <motion.div
                        className="flex flex-col items-center justify-center text-center py-20 space-y-4"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    >
                        <Inbox className="w-14 h-14 text-[var(--text-muted)]" />
                        <p className="text-sm text-[var(--text-secondary)] max-w-[260px]">
                            {filter === 'all'
                                ? 'Nothing here yet. Documents you build will show up here. Try the demo to see how it works.'
                                : 'Nothing of this kind yet.'}
                        </p>
                        {filter === 'all' && (
                            <motion.button
                                onClick={onDemoClick}
                                className="btn-primary min-h-[48px] px-6 rounded-2xl font-semibold text-sm"
                                whileTap={{ scale: 0.97 }}
                            >
                                Try the demo
                            </motion.button>
                        )}
                    </motion.div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {sorted.map(doc => (
                            <DocumentCard
                                key={doc.id}
                                doc={doc}
                                onDelete={handleDelete}
                                confirmingDelete={confirmDeleteId === doc.id}
                                onRequestDelete={setConfirmDeleteId}
                                onResume={onResumeDraft}
                            />
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
}
