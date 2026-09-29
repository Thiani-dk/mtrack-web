import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Check, Download, FileText, Share2 } from 'lucide-react';
import type { TrackedDocument } from '../../types';
import { getDocument, saveDocument } from '../../lib/documentStore';
import { buildReceiptData, needsReconciliationPrompt } from '../../lib/receipt/model';
import { buildReceiptExportLayout, renderReceiptPng } from '../../lib/receipt/renderPng';
import { renderReceiptPdf } from '../../lib/receipt/renderPdf';
import { generateReceiptHTML } from '../../lib/receipt/renderHtml';
import { ReceiptPrimitivesView } from './ReceiptPrimitivesView';
import type { LayoutResult } from '../../lib/documentPrimitives';
import { share } from '../../lib/shareUtils';
import { downloadHTML, downloadPDF, downloadPNG } from '../../lib/downloadUtils';
import { StackedPanel } from '../chat/OverlayStack';

// The sales receipt screen: a proper thermal-receipt-style document (Phase
// 4), built from the same positioned-primitives architecture as the day
// card. Reconciliation (a gap between the itemised lines and what was
// actually received) is resolved once, here, with a one-time prompt, then
// carried on the document forever — see model.ts's own note on why.

interface ReceiptScreenProps {
    documentId: string;
    onBack: () => void;
}

type Busy = 'share' | 'save' | 'pdf' | 'html' | null;

function EditableField({
    label, value, placeholder, onCommit,
}: { label: string; value: string; placeholder: string; onCommit: (next: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const commit = () => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed !== value) onCommit(trimmed);
    };
    return (
        <div className="flex items-center justify-between gap-2 text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
            {editing ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
                    className="text-right px-1.5 py-0.5 rounded outline-none min-w-0 flex-1"
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

export function ReceiptScreen({ documentId, onBack }: ReceiptScreenProps) {
    const [doc, setDoc] = useState<TrackedDocument | null>(null);
    const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
    const [renderError, setRenderError] = useState(false);
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState('');
    const [displayWidth, setDisplayWidth] = useState(320);
    const [reconcileChoice, setReconcileChoice] = useState<'tip' | 'discount' | null>(null);
    const [reconcileAmount, setReconcileAmount] = useState('');
    // Session-only — skipping the prompt does not write anything to the
    // document, so reopening the receipt later asks again rather than
    // silently forgetting there was ever a gap to explain.
    const [reconcileDismissed, setReconcileDismissed] = useState(false);

    useEffect(() => {
        getDocument(documentId).then(d => setDoc(d ?? null));
    }, [documentId]);

    useEffect(() => {
        const onResize = () => setDisplayWidth(Math.min(340, window.innerWidth - 48));
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const data = useMemo(() => (doc ? buildReceiptData(doc) : null), [doc]);
    const showReconcilePrompt = doc ? needsReconciliationPrompt(doc) && !reconcileDismissed : false;

    useEffect(() => {
        if (!data) return;
        let cancelled = false;
        buildReceiptExportLayout(data)
            .then(l => { if (!cancelled) setLayoutResult(l); })
            .catch(() => { if (!cancelled) setRenderError(true); });
        return () => { cancelled = true; };
    }, [data]);

    const flash = (text: string) => {
        setNotice(text);
        setTimeout(() => setNotice(''), 3000);
    };

    const patchDoc = async (patch: Partial<TrackedDocument>) => {
        if (!doc) return;
        const updated: TrackedDocument = { ...doc, ...patch, updatedAt: Date.now() };
        setDoc(updated);
        await saveDocument(updated);
    };

    const commitReconciliation = async () => {
        const amount = parseFloat(reconcileAmount);
        if (!Number.isFinite(amount) || amount <= 0 || !reconcileChoice) return;
        await patchDoc(reconcileChoice === 'tip' ? { tip: amount } : { discount: amount });
        setReconcileChoice(null);
        setReconcileAmount('');
    };

    const handleSharePng = async () => {
        if (!data) return;
        setBusy('share');
        try {
            const blob = await renderReceiptPng(data);
            const result = await share({
                file: { blob, filename: `mtrack-receipt-${data.receiptNumber}.png`, mimeType: 'image/png' },
                title: `Receipt ${data.receiptNumber}`,
                text: `${data.businessName ?? 'Receipt'} — ${data.totalLabel} — ${data.receiptNumber}`,
            });
            if (result === 'copied') flash('Copied — paste it wherever.');
            else if (result === 'failed') flash('Unable to share on this device');
        } catch {
            flash("Couldn't prepare the receipt to share — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleSaveImage = async () => {
        if (!data) return;
        setBusy('save');
        try {
            const blob = await renderReceiptPng(data);
            downloadPNG(blob, `mtrack-receipt-${data.receiptNumber}.png`);
        } catch {
            flash("Couldn't save the image — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleSavePdf = async () => {
        if (!data) return;
        setBusy('pdf');
        try {
            const pdf = await renderReceiptPdf(data);
            downloadPDF(pdf.output('blob'), `mtrack-receipt-${data.receiptNumber}.pdf`);
        } catch {
            flash("Couldn't generate the PDF — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleSaveHtml = async () => {
        if (!data) return;
        setBusy('html');
        try {
            const html = await generateReceiptHTML(data);
            downloadHTML(html, `mtrack-receipt-${data.receiptNumber}.html`);
        } catch {
            flash("Couldn't generate the web page — try again.");
        } finally {
            setBusy(null);
        }
    };

    if (!doc || !data) {
        return <div className="min-h-screen" style={{ background: 'var(--bg-base)' }} />;
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
            <header className="flex items-center px-4 py-3">
                <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-full" style={{ color: 'var(--text-primary)' }}>
                    <ArrowLeft className="w-5 h-5" />
                </button>
            </header>

            <div className="px-4 pb-3 space-y-1.5 glass-card mx-4 p-3" data-receipt-fields>
                <EditableField
                    label="Business" value={doc.merchantProfile?.businessName ?? ''} placeholder="Add business name"
                    onCommit={next => patchDoc({ merchantProfile: { businessName: next, contact: doc.merchantProfile?.contact ?? null } })}
                />
                <EditableField
                    label="Contact" value={doc.merchantProfile?.contact ?? ''} placeholder="Add contact (optional)"
                    onCommit={next => patchDoc({ merchantProfile: { businessName: doc.merchantProfile?.businessName ?? '', contact: next || null } })}
                />
                <EditableField
                    label="Served by" value={doc.servedBy ?? ''} placeholder="Add who served this sale (optional)"
                    onCommit={next => patchDoc({ servedBy: next || null })}
                />
            </div>

            {data.reconciliation.kind === 'unexplained' && reconcileDismissed && (
                <div className="px-4 pb-2 text-[12px]" style={{ color: 'var(--text-muted)' }} data-reconcile-note>
                    The items on this sale add up to a different amount than what came in
                    ({data.reconciliation.amountLabel}), left unexplained on the receipt.
                </div>
            )}

            <div className="flex-1 flex items-center justify-center px-4 py-2">
                {renderError ? (
                    <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>Couldn't load the receipt's fonts. Try again in a moment.</p>
                ) : layoutResult ? (
                    <ReceiptPrimitivesView layout={layoutResult} displayWidth={displayWidth} />
                ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Preparing the receipt…</p>
                )}
            </div>

            <div className="px-4 pb-6 space-y-2">
                <motion.button
                    onClick={handleSharePng}
                    disabled={busy !== null || !layoutResult}
                    className="btn-primary w-full min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                >
                    <Share2 className="w-3.5 h-3.5" />
                    {busy === 'share' ? 'Preparing…' : 'Share'}
                </motion.button>
                <div className="flex gap-2">
                    <motion.button
                        onClick={handleSavePdf}
                        disabled={busy !== null}
                        className="btn-secondary flex-1 min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                        whileTap={{ scale: 0.97 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {busy === 'pdf' ? 'Generating…' : 'Save as PDF'}
                    </motion.button>
                    <motion.button
                        onClick={handleSaveHtml}
                        disabled={busy !== null}
                        className="flex-1 min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-50"
                        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                        whileTap={{ scale: 0.97 }}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        {busy === 'html' ? 'Generating…' : 'Save as web page'}
                    </motion.button>
                </div>
                <button
                    onClick={handleSaveImage}
                    disabled={busy !== null}
                    className="w-full min-h-[36px] rounded-xl text-xs font-medium disabled:opacity-50"
                    style={{ color: 'var(--text-muted)' }}
                >
                    {busy === 'save' ? 'Saving…' : 'Save image'}
                </button>
                <AnimatePresence>
                    {notice && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="text-xs flex items-center justify-center gap-1"
                            style={{ color: 'var(--accent)' }}
                        >
                            <Check className="w-3 h-3" />
                            {notice}
                        </motion.p>
                    )}
                </AnimatePresence>
            </div>

            {showReconcilePrompt && (
                <StackedPanel id="receipt-reconcile" onClose={() => {}} className="fixed inset-0 flex items-center justify-center p-4">
                    <div className="glass-panel rounded-2xl p-4 space-y-3 w-full max-w-xs" data-reconcile-panel>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            The items add up to {data.subtotalLabel}, but {data.totalLabel} came in. What was the difference?
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setReconcileChoice('tip'); setReconcileAmount(Math.abs(data.total - data.subtotal).toFixed(2)); }}
                                className="flex-1 min-h-[40px] rounded-lg text-sm font-medium"
                                style={reconcileChoice === 'tip' ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                            >
                                A tip
                            </button>
                            <button
                                onClick={() => { setReconcileChoice('discount'); setReconcileAmount(Math.abs(data.total - data.subtotal).toFixed(2)); }}
                                className="flex-1 min-h-[40px] rounded-lg text-sm font-medium"
                                style={reconcileChoice === 'discount' ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                            >
                                A discount
                            </button>
                        </div>
                        {reconcileChoice && (
                            <input
                                autoFocus
                                inputMode="decimal"
                                value={reconcileAmount}
                                onChange={e => setReconcileAmount(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}
                            />
                        )}
                        <button
                            onClick={commitReconciliation}
                            disabled={!reconcileChoice || !reconcileAmount}
                            className="btn-primary w-full min-h-[40px] rounded-lg text-sm font-medium disabled:opacity-50"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => setReconcileDismissed(true)}
                            className="w-full min-h-[32px] rounded-lg text-xs"
                            style={{ color: 'var(--text-muted)' }}
                        >
                            Not now — leave it unexplained
                        </button>
                    </div>
                </StackedPanel>
            )}
        </div>
    );
}
