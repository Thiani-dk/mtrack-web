import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Share2, Check } from 'lucide-react';
import type { DocumentType, MerchantProfile, OnBehalfOfContext, ParsedTransaction } from '../../types';
import { computeReceiptData, generateReceiptHTML, generateReceiptPDF, summariseReceiptForShare, type DocRenderMeta } from '../../lib/receiptGenerator';
import { computeCoveringDates, computeDataSource } from '../../lib/documentModel';
import { downloadHTML, downloadPDF, getReceiptFilenames } from '../../lib/downloadUtils';
import { share } from '../../lib/shareUtils';
import { useEntranceOnce } from '../../lib/useEntranceOnce';
import { useReceiptStore } from '../../lib/useReceiptStore';
import { ChatReceiptVisual } from './ChatReceiptVisual';

export interface DocumentContext {
    documentType: DocumentType;
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
}

interface ChatReceiptProps {
    messageId: string;
    transactions: ParsedTransaction[];
    dateRange: string;
    isDemo?: boolean;
    onLabelChange?: (transactionCode: string, label: string | null) => void;
    documentContext?: DocumentContext | null;
    approved?: boolean;
    onApprove?: () => void;
    onEditTransaction?: (transactionCode: string, patch: Partial<ParsedTransaction>) => void;
    onEditContext?: (patch: Partial<DocumentContext>) => void;
}

type Busy = 'pdf' | 'html' | 'share' | null;

// A single tap-to-edit line: shows text, becomes an input on tap, commits on
// blur or Enter. Used for the document's context header fields.
function EditableLine({
    label, value, placeholder, onCommit,
}: {
    label: string; value: string; placeholder: string; onCommit: (next: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const commit = () => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed !== value) onCommit(trimmed);
    };
    return (
        <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-[var(--text-muted)]">{label}</span>
            {editing ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
                    className="text-right text-[11px] px-1.5 py-0.5 rounded outline-none min-w-0 flex-1"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                />
            ) : (
                <button
                    type="button"
                    onClick={() => { setDraft(value); setEditing(true); }}
                    className="text-right font-medium"
                    style={{ color: value ? 'var(--text-primary)' : 'var(--accent)' }}
                >
                    {value || placeholder}
                </button>
            )}
        </div>
    );
}

export function ChatReceipt({
    messageId, transactions, dateRange, isDemo = false, onLabelChange,
    documentContext, approved = false, onApprove, onEditTransaction, onEditContext,
}: ChatReceiptProps) {
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const { saveIfNew } = useReceiptStore();

    // Same computed source Part A's PDF/HTML generation reads from — the
    // interactive view never forks its own tally/category math.
    const data = useMemo(() => computeReceiptData(transactions), [transactions]);
    const playEntrance = useEntranceOnce(messageId);

    // The render meta every surface (chat preview, HTML, PDF) reads from —
    // covering dates and dataSource are always recomputed from the current
    // transactions, never a stored or relative range.
    const meta = useMemo<DocRenderMeta>(() => {
        const { coveringFrom, coveringTo } = computeCoveringDates(transactions);
        return {
            documentType: documentContext?.documentType ?? 'expense_summary',
            coveringFrom, coveringTo,
            dataSource: computeDataSource(transactions),
            merchantProfile: documentContext?.merchantProfile ?? null,
            onBehalfOf: documentContext?.onBehalfOf ?? null,
        };
    }, [transactions, documentContext]);

    // Re-synced at the moment of each save/share (not eagerly on every label
    // edit) — if this session was already saved to history before a label
    // change, this refreshes that entry in place rather than leaving it
    // stale. No-op (besides the refresh) for a demo session's fake receipts.
    const syncHistory = async () => {
        if (isDemo) return;
        await saveIfNew(transactions, dateRange);
    };

    const flash = (text: string) => {
        setNotice(text);
        setTimeout(() => setNotice(null), 3000);
    };

    const handleDownloadPDF = async () => {
        setBusy('pdf');
        try {
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(transactions, meta, isDemo),
                getReceiptFilenames(transactions),
                syncHistory(),
            ]);
            downloadPDF(blob, filenames.pdf);
        } catch (err) {
            console.error('PDF download failed:', err);
            flash("Couldn't generate the PDF — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleDownloadHTML = async () => {
        setBusy('html');
        try {
            const [html, filenames] = await Promise.all([
                generateReceiptHTML(transactions, meta, isDemo),
                getReceiptFilenames(transactions),
                syncHistory(),
            ]);
            downloadHTML(html, filenames.html);
        } catch (err) {
            console.error('HTML download failed:', err);
            flash("Couldn't generate the web page — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleShare = async () => {
        setBusy('share');
        try {
            const text = summariseReceiptForShare(transactions, meta);
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(transactions, meta, isDemo),
                getReceiptFilenames(transactions),
                syncHistory(),
            ]);
            const result = await share({
                file: { blob, filename: filenames.pdf, mimeType: 'application/pdf' },
                title: 'Expense Summary',
                text,
            });
            if (result === 'copied') flash('Copied — paste it wherever.');
            else if (result === 'failed') flash('Unable to share on this device');
        } catch (err) {
            console.error('Share failed:', err);
            flash("Couldn't prepare that to share — try again.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[85%] w-full px-4 py-4">
                {documentContext && documentContext.documentType === 'point_of_sale' && (
                    <div className="mb-3 pb-2 border-b border-[var(--border-glass)] space-y-1">
                        <EditableLine
                            label="Business" value={documentContext.merchantProfile?.businessName ?? ''} placeholder="Add business name"
                            onCommit={next => onEditContext?.({ merchantProfile: { businessName: next, contact: documentContext.merchantProfile?.contact ?? null } })}
                        />
                        <EditableLine
                            label="Contact" value={documentContext.merchantProfile?.contact ?? ''} placeholder="Add contact (optional)"
                            onCommit={next => onEditContext?.({ merchantProfile: { businessName: documentContext.merchantProfile?.businessName ?? '', contact: next || null } })}
                        />
                    </div>
                )}
                {documentContext && documentContext.documentType === 'on_behalf_of' && (
                    <div className="mb-3 pb-2 border-b border-[var(--border-glass)] space-y-1">
                        <EditableLine
                            label="Prepared for" value={documentContext.onBehalfOf?.partyName ?? ''} placeholder="Add name"
                            onCommit={next => onEditContext?.({ onBehalfOf: { partyName: next, preparedBy: documentContext.onBehalfOf?.preparedBy ?? null, purpose: documentContext.onBehalfOf?.purpose ?? null } })}
                        />
                        <EditableLine
                            label="Prepared by" value={documentContext.onBehalfOf?.preparedBy ?? ''} placeholder="Add your name (optional)"
                            onCommit={next => onEditContext?.({ onBehalfOf: { partyName: documentContext.onBehalfOf?.partyName ?? '', preparedBy: next || null, purpose: documentContext.onBehalfOf?.purpose ?? null } })}
                        />
                        <EditableLine
                            label="Purpose" value={documentContext.onBehalfOf?.purpose ?? ''} placeholder="Add purpose (optional)"
                            onCommit={next => onEditContext?.({ onBehalfOf: { partyName: documentContext.onBehalfOf?.partyName ?? '', preparedBy: documentContext.onBehalfOf?.preparedBy ?? null, purpose: next || null } })}
                        />
                    </div>
                )}

                {isDemo && (
                    <div
                        className="mb-3 rounded-lg px-3 py-2 text-[11px] font-medium text-center"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-glass)', color: 'var(--text-muted)' }}
                    >
                        Sample data, nothing here is saved
                    </div>
                )}

                <div className="mb-3">
                    <ChatReceiptVisual
                        data={data} meta={meta} playEntrance={playEntrance}
                        onLabelChange={onLabelChange}
                        onEditTransaction={onEditTransaction}
                    />
                </div>

                {onApprove && !isDemo && (
                    <button
                        type="button"
                        onClick={onApprove}
                        disabled={approved}
                        className="mb-2 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
                        style={approved
                            ? { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-glass)' }
                            : { background: 'var(--accent)', color: '#ffffff' }}
                    >
                        {approved ? <><Check className="w-3.5 h-3.5" /> Approved</> : 'Approve'}
                    </button>
                )}

                <div className="flex flex-col gap-2">
                    <motion.button
                        onClick={handleDownloadPDF}
                        disabled={busy !== null}
                        className="btn-primary min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                        whileTap={{ scale: 0.97 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {busy === 'pdf' ? 'Generating…' : 'Save as PDF'}
                    </motion.button>
                    <div className="flex gap-2">
                        <motion.button
                            onClick={handleDownloadHTML}
                            disabled={busy !== null}
                            className="btn-secondary flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                            whileTap={{ scale: 0.97 }}
                        >
                            <Download className="w-3.5 h-3.5" />
                            {busy === 'html' ? 'Generating…' : 'Save as web page'}
                        </motion.button>
                        <motion.button
                            onClick={handleShare}
                            disabled={busy !== null}
                            className="flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-50"
                            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                            whileTap={{ scale: 0.97 }}
                        >
                            <Share2 className="w-3.5 h-3.5" />
                            {busy === 'share' ? 'Preparing…' : 'Share'}
                        </motion.button>
                    </div>
                </div>

                <AnimatePresence>
                    {notice && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="text-xs mt-2 flex items-center gap-1"
                            style={{ color: 'var(--accent)' }}
                        >
                            <Check className="w-3 h-3" />
                            {notice}
                        </motion.p>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
