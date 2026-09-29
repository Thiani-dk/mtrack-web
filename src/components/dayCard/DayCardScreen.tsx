import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Check, Download, FileText, Moon, Share2, Sun } from 'lucide-react';
import type { TrackedDocument } from '../../types';
import type { DocRenderMeta } from '../../lib/documentRender';
import { getDocument, saveDocument } from '../../lib/documentStore';
import { buildDayCardData } from '../../lib/dayCard/model';
import { buildDayCardExportLayout, renderDayCardPng } from '../../lib/dayCard/renderPng';
import { salesLogTransactions } from '../../lib/dayCard/salesLog';
import { DayCardPrimitivesView } from './DayCardPrimitivesView';
import type { DayCardTheme } from '../../lib/dayCard/theme';
import type { LayoutResult } from '../../lib/documentPrimitives';
import { share } from '../../lib/shareUtils';
import { downloadCSV, downloadPDF, downloadPNG } from '../../lib/downloadUtils';
import { buildDailySalesCsv } from '../../lib/activeMode/csv';
import { generateReceiptPDF } from '../../lib/receiptGenerator';
import { StackedPanel } from '../chat/OverlayStack';

// The day card screen: the shareable "how did today go" preview a finished
// Active Mode shift lands on. Renders the same positioned primitives the PNG
// export uses (DayCardPrimitivesView), so what is on screen and what gets
// shared are never out of sync. Private notes (Unsorted, timing, balance)
// live above the card, never inside it — see model.ts's own comment on why.

interface DayCardScreenProps {
    documentId: string;
    onBack: () => void;
}

type Busy = 'share' | 'save' | 'log' | null;

export function DayCardScreen({ documentId, onBack }: DayCardScreenProps) {
    const [doc, setDoc] = useState<TrackedDocument | null>(null);
    const [theme, setTheme] = useState<DayCardTheme>('dark');
    // Tagged with the theme it was built for, so a still-loading response for
    // a theme the user has since switched away from is never shown as if it
    // were current — read through the `layout`/`renderError` derivations
    // below rather than this directly.
    const [layoutResult, setLayoutResult] = useState<
        { theme: DayCardTheme; layout: LayoutResult } | { theme: DayCardTheme; error: true } | null
    >(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [displayWidth, setDisplayWidth] = useState(340);

    useEffect(() => {
        getDocument(documentId).then(d => setDoc(d ?? null));
    }, [documentId]);

    useEffect(() => {
        const onResize = () => setDisplayWidth(Math.min(360, window.innerWidth - 48));
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const data = useMemo(() => {
        if (!doc) return null;
        return buildDayCardData(doc.transactions, {
            stallName: doc.merchantProfile?.businessName || null,
            now: new Date(),
        });
    }, [doc]);

    useEffect(() => {
        if (!data) return;
        let cancelled = false;
        buildDayCardExportLayout(data, theme)
            .then(l => { if (!cancelled) setLayoutResult({ theme, layout: l }); })
            .catch(() => { if (!cancelled) setLayoutResult({ theme, error: true }); });
        return () => { cancelled = true; };
    }, [data, theme]);

    const layout = layoutResult && layoutResult.theme === theme && 'layout' in layoutResult ? layoutResult.layout : null;
    const renderError = !!(layoutResult && layoutResult.theme === theme && 'error' in layoutResult);

    const flash = (text: string) => {
        setNotice(text);
        setTimeout(() => setNotice(''), 3000);
    };

    const commitStallName = async (name: string) => {
        setEditingName(false);
        if (!doc) return;
        const trimmed = name.trim();
        const updated: TrackedDocument = {
            ...doc,
            merchantProfile: trimmed ? { businessName: trimmed, contact: doc.merchantProfile?.contact ?? null } : null,
            updatedAt: Date.now(),
        };
        setDoc(updated);
        await saveDocument(updated);
    };

    const handleSharePng = async () => {
        if (!data) return;
        setBusy('share');
        try {
            const blob = await renderDayCardPng(data, theme);
            const result = await share({
                file: { blob, filename: 'mtrack-day.png', mimeType: 'image/png' },
                title: data.dateLabel,
                text: `${data.heroLabel}: ${data.heroAmount} — ${data.dateLabel}`,
            });
            if (result === 'copied') flash('Copied — paste it wherever.');
            else if (result === 'failed') flash('Unable to share on this device');
        } catch {
            flash("Couldn't prepare the card to share — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleSaveImage = async () => {
        if (!data) return;
        setBusy('save');
        try {
            const blob = await renderDayCardPng(data, theme);
            downloadPNG(blob, `mtrack-day-${Date.now()}.png`);
        } catch {
            flash("Couldn't save the image — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleExportLog = async () => {
        if (!doc) return;
        setBusy('log');
        try {
            const reshaped = salesLogTransactions(doc.transactions);
            const meta: DocRenderMeta = {
                documentType: 'daily_sales',
                coveringFrom: doc.coveringFrom,
                coveringTo: doc.coveringTo,
                dataSource: doc.dataSource,
                merchantProfile: null,
                onBehalfOf: null,
            };
            const blob = await generateReceiptPDF(reshaped, meta, false);
            downloadPDF(blob, `mtrack-sales-log-${Date.now()}.pdf`);
        } catch {
            flash("Couldn't generate the sales log — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleExportCsv = () => {
        if (!doc) return;
        downloadCSV(buildDailySalesCsv(doc.transactions), `mtrack-sales-${Date.now()}.csv`);
    };

    if (!doc || !data) {
        return <div className="min-h-screen" style={{ background: 'var(--bg-base)' }} />;
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
            <header className="flex items-center justify-between px-4 py-3">
                <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-full" style={{ color: 'var(--text-primary)' }}>
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                    onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
                    aria-label="Switch theme"
                    className="p-2 rounded-full"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                </button>
            </header>

            {(data.unsortedNote || data.missingTimesNote || data.duplicatesNote || data.balanceNote) && (
                <div className="px-4 pb-2 space-y-1 text-[12px]" style={{ color: 'var(--text-muted)' }} data-day-card-private-notes>
                    {data.unsortedNote && (
                        <p>{data.unsortedNote.count} sale{data.unsortedNote.count === 1 ? '' : 's'} ({data.unsortedNote.amountLabel}) still in Unsorted.</p>
                    )}
                    {data.missingTimesNote && (
                        <p>{data.missingTimesNote.count} sale{data.missingTimesNote.count === 1 ? '' : 's'} with no time recorded.</p>
                    )}
                    {data.duplicatesNote && (
                        <p>{data.duplicatesNote.count} likely duplicate{data.duplicatesNote.count === 1 ? '' : 's'} removed before this card was built.</p>
                    )}
                    {data.balanceNote?.kind === 'surplus' && (
                        <p>M-Pesa's own balance is {data.balanceNote.amountLabel} more than the sales logged here.</p>
                    )}
                    {data.balanceNote?.kind === 'shortfall' && (
                        <p>M-Pesa's own balance is {data.balanceNote.amountLabel} less than the sales logged here.</p>
                    )}
                </div>
            )}

            <div className="flex-1 flex items-center justify-center px-4 py-2">
                {renderError ? (
                    <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                        Couldn't load the card's fonts. Try again in a moment.
                    </p>
                ) : layout ? (
                    <button
                        type="button"
                        onClick={() => { setNameDraft(doc.merchantProfile?.businessName ?? ''); setEditingName(true); }}
                        aria-label="Edit stall name"
                        data-day-card-tap
                    >
                        <DayCardPrimitivesView layout={layout} displayWidth={displayWidth} />
                    </button>
                ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Preparing the card…</p>
                )}
            </div>

            <div className="px-4 pb-6 space-y-2">
                <motion.button
                    onClick={handleSharePng}
                    disabled={busy !== null || !layout}
                    className="btn-primary w-full min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                >
                    <Share2 className="w-3.5 h-3.5" />
                    {busy === 'share' ? 'Preparing…' : 'Share'}
                </motion.button>
                <div className="flex gap-2">
                    <motion.button
                        onClick={handleSaveImage}
                        disabled={busy !== null || !layout}
                        className="btn-secondary flex-1 min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                        whileTap={{ scale: 0.97 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {busy === 'save' ? 'Saving…' : 'Save image'}
                    </motion.button>
                    <motion.button
                        onClick={handleExportLog}
                        disabled={busy !== null}
                        className="flex-1 min-h-[44px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-50"
                        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                        whileTap={{ scale: 0.97 }}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        {busy === 'log' ? 'Generating…' : 'Sales log PDF'}
                    </motion.button>
                </div>
                <button
                    onClick={handleExportCsv}
                    className="w-full min-h-[36px] rounded-xl text-xs font-medium"
                    style={{ color: 'var(--text-muted)' }}
                >
                    Export CSV
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

            {editingName && (
                <StackedPanel id="day-card-name" onClose={() => setEditingName(false)} className="fixed inset-0 flex items-center justify-center p-4">
                    <div className="glass-panel rounded-2xl p-4 space-y-3 w-full max-w-xs">
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Stall name</p>
                        <input
                            autoFocus
                            value={nameDraft}
                            onChange={e => setNameDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitStallName(nameDraft); if (e.key === 'Escape') setEditingName(false); }}
                            placeholder="Mama Chapo"
                            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEditingName(false)}
                                className="flex-1 min-h-[40px] rounded-lg text-sm"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => commitStallName(nameDraft)}
                                className="btn-primary flex-1 min-h-[40px] rounded-lg text-sm font-medium"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </StackedPanel>
            )}
        </div>
    );
}
