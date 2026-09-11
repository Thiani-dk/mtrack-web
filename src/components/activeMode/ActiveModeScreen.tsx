import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, Plus, X } from 'lucide-react';
import type { ActiveModeState, ParsedTransaction, TrackedDocument } from '../../types';
import {
    addBucket, bucketTallies, capture, dayTotal, emptyActiveModeState, fileInto,
    findDuplicate, readActiveModeState, UNSORTED,
    type BucketError, type DuplicateWarning,
} from '../../lib/activeMode/session';
import { getDrafts, saveDocument as saveApproved } from '../../lib/documentStore';
import { buildDraft } from '../../lib/draftDocument';
import { useDocumentStore } from '../../lib/useDocumentStore';
import { fmtCurrency } from '../../lib/receiptGenerator';

// Active Mode — a dense, non-conversational capture screen.
//
// The interaction budget is two actions per sale: paste, then tap a bucket.
// Everything on this screen is subordinate to that. There is no chat, no
// follow-up question, and no step that can block on an answer. The paste field
// is focused on mount and re-focused the instant a sale is filed, because a
// vendor who has to tap the field again before every paste has been given a
// three-action flow, which is a different and much worse feature.

interface ActiveModeScreenProps {
    onBack: () => void;
    onShowWalkthrough?: () => void;
    // Called once the shift's document has been approved and saved, so the
    // app can take the vendor to it. The document itself is viewed and
    // exported through the existing history surface — Active Mode does not
    // build a second viewer.
    onFinished?: (documentId: string) => void;
}

const CAPTURE_ERROR: Record<string, string> = {
    empty: '',
    unreadable: "I couldn't read a sale out of that. Paste the whole message, or type something like \"combo 350\".",
    'no-amount': 'I need an amount — try "combo 350".',
};

function newSessionId(): string {
    return `active-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const BUCKET_ERROR: Record<BucketError, string> = {
    empty: 'Give it a name first.',
    duplicate: 'You already have a bucket with that name.',
    reserved: `"${UNSORTED}" is always there — pick another name.`,
};

export function ActiveModeScreen({ onBack, onShowWalkthrough, onFinished }: ActiveModeScreenProps) {
    const { saveDocument } = useDocumentStore();

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
    const [state, setState] = useState<ActiveModeState>(emptyActiveModeState());
    // The capture waiting for a bucket. Exactly one at a time — a second paste
    // files this one rather than queueing or blocking.
    const [pending, setPending] = useState<ParsedTransaction | null>(null);
    const [warning, setWarning] = useState<DuplicateWarning | null>(null);
    const [captureError, setCaptureError] = useState<string>('');
    const [draftText, setDraftText] = useState('');
    const [newBucketOpen, setNewBucketOpen] = useState(false);
    const [newBucketName, setNewBucketName] = useState('');
    const [bucketError, setBucketError] = useState<string>('');
    const [hydrated, setHydrated] = useState(false);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const newBucketRef = useRef<HTMLInputElement>(null);
    const docRef = useRef<TrackedDocument | null>(null);

    // ── Resume ──
    // An Active Mode session IS a draft TrackedDocument, using the same
    // autosave every other document type uses. Reopening picks the existing
    // draft back up rather than starting a second one, so closing a laptop
    // mid-shift costs nothing.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            let existing = null;
            try {
                const drafts = await getDrafts();
                existing = drafts
                    .filter(d => d.capturedViaActiveMode)
                    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
            } catch {
                // IndexedDB unavailable — start a fresh in-memory session
                // rather than refusing to open the screen.
            }
            if (cancelled) return;
            if (existing) {
                docRef.current = existing;
                setSessionId(existing.id);
                setTransactions(existing.transactions.map(t => ({ ...t, date: new Date(t.date) })));
                setState(readActiveModeState(existing.activeMode));
            } else {
                setSessionId(newSessionId());
            }
            setHydrated(true);
        })();
        return () => { cancelled = true; };
    }, []);

    // ── Autosave ──
    useEffect(() => {
        if (!hydrated || !sessionId) return;
        const doc = buildDraft({
            sessionId,
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions,
            existing: docRef.current,
            capturedViaActiveMode: true,
            activeMode: state,
        });
        docRef.current = doc;
        saveDocument(doc);
    }, [transactions, state, hydrated, sessionId, saveDocument]);

    const focusInput = useCallback(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (hydrated) focusInput();
    }, [hydrated, focusInput]);

    const tallies = bucketTallies(state, transactions);
    const total = dayTotal(transactions);
    const currency = transactions[0]?.currency ?? 'KES';

    // A capture arriving while one is still unfiled files the old one into
    // Unsorted. Never dropped, never blocking the new paste — a vendor too
    // slammed to categorise every sale still ends the day with every sale.
    const commitPending = useCallback((into: string) => {
        setTransactions(prev => (pending ? [...prev, fileInto(pending, into)] : prev));
        setPending(null);
        setWarning(null);
    }, [pending]);

    const runCapture = useCallback((text: string) => {
        const result = capture(text);
        if (!result.transaction) {
            setCaptureError(CAPTURE_ERROR[result.error ?? 'unreadable'] ?? '');
            return;
        }
        setCaptureError('');
        setDraftText('');

        // Auto-file whatever was still pending, then show the new one.
        const filed = pending ? [...transactions, fileInto(pending, UNSORTED)] : transactions;
        if (pending) setTransactions(filed);

        setWarning(findDuplicate(result.transaction, filed));
        setPending(result.transaction);
        focusInput();
    }, [pending, transactions, focusInput]);

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const text = e.clipboardData.getData('text');
        if (!text.trim()) return;
        // Capture on the paste itself: that is action one of two.
        e.preventDefault();
        runCapture(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (draftText.trim()) runCapture(draftText);
        }
    };

    // Finish moves the session from draft to approved, the same finalisation
    // step every other document type uses — nothing Active-Mode-specific
    // happens to the document itself. Anything still pending is filed to
    // Unsorted first, so the last sale of the day cannot be the one that gets
    // left behind.
    const handleFinish = useCallback(async () => {
        if (!sessionId) return;
        const finalTransactions = pending ? [...transactions, fileInto(pending, UNSORTED)] : transactions;
        if (finalTransactions.length === 0) return;

        const doc = buildDraft({
            sessionId,
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions: finalTransactions,
            existing: docRef.current,
            capturedViaActiveMode: true,
            activeMode: state,
        });
        const approved: TrackedDocument = { ...doc, status: 'approved', updatedAt: Date.now() };

        setPending(null);
        setTransactions(finalTransactions);
        docRef.current = approved;
        saveDocument(approved);
        // Flush past the store's write debounce before navigating away.
        await saveApproved(approved);

        if (onFinished) onFinished(approved.id);
        else onBack();
    }, [sessionId, pending, transactions, state, saveDocument, onFinished, onBack]);

    const handleCreateBucket = () => {
        const { state: next, error } = addBucket(state, newBucketName);
        if (error) {
            setBucketError(BUCKET_ERROR[error]);
            return;
        }
        setState(next);
        setBucketError('');
        setNewBucketName('');
        setNewBucketOpen(false);
        // Creating a bucket mid-rush is a detour; put the vendor straight back.
        focusInput();
    };

    return (
        <div className="flex flex-col bg-[var(--bg-base)]" style={{ height: '100dvh' }}>
            {/* ── Header: the running day, and the way out. ── */}
            <header className="flex-shrink-0 border-b border-[var(--border-glass)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                            Active Mode
                        </p>
                        <p className="text-2xl font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
                            {fmtCurrency(total, currency)}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                            {transactions.length} {transactions.length === 1 ? 'sale' : 'sales'} today
                        </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={onShowWalkthrough}
                            aria-label="How Active Mode works"
                            title="How Active Mode works"
                            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            <HelpCircle className="w-5 h-5" />
                        </button>
                        <button
                            onClick={handleFinish}
                            disabled={transactions.length === 0 && !pending}
                            className="rounded-full px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 whitespace-nowrap"
                            style={{ background: 'var(--accent)' }}
                        >
                            Finish
                        </button>
                        <button
                            onClick={onBack}
                            aria-label="Close Active Mode"
                            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </header>

            {/* ── The capture area. Scrolls; the input and chips below do not. ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                {pending ? (
                    <div
                        className="rounded-xl border p-3"
                        style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}
                    >
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                            Tap a bucket to file it
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-nums">
                            {fmtCurrency(pending.amount, pending.currency)}
                        </p>
                        <p className="text-sm text-[var(--text-secondary)] truncate">{pending.recipient}</p>
                        {pending.directionAssumed && (
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                                Recorded as money in — worth a glance later.
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-[var(--text-muted)]">
                        Paste a payment message. It files on paste — then tap a bucket.
                    </p>
                )}

                {/* Non-blocking duplicate warning. It never refuses the capture. */}
                {warning && (
                    <div
                        className="rounded-xl border px-3 py-2 text-xs"
                        style={{ background: 'var(--warn-bg, var(--accent-subtle))', borderColor: 'var(--border-glass)' }}
                    >
                        <span className="text-[var(--text-secondary)]">
                            {warning.kind === 'exact'
                                ? `This looks like the same message as sale #${warning.saleNumber}.`
                                : `Looks like this might be the same as sale #${warning.saleNumber}, ${warning.minutesApart} min apart.`}
                            {' '}Tap a bucket to add it anyway.
                        </span>
                        <button
                            onClick={() => { setPending(null); setWarning(null); focusInput(); }}
                            className="ml-2 underline underline-offset-2 text-[var(--text-muted)]"
                        >
                            Discard
                        </button>
                    </div>
                )}

                {captureError && <p className="text-xs text-[var(--text-muted)]">{captureError}</p>}
            </div>

            {/* ── Buckets. Horizontally scrollable, never wrapping. ── */}
            <div className="flex-shrink-0 border-t border-[var(--border-glass)] px-4 py-2">
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
                    {tallies.map(b => (
                        <button
                            key={b.name}
                            onClick={() => { commitPending(b.name); focusInput(); }}
                            disabled={!pending}
                            className="flex-shrink-0 rounded-full border px-3 py-1.5 text-left disabled:opacity-50"
                            style={{
                                borderColor: pending ? 'var(--border-glass-accent)' : 'var(--border-glass)',
                                background: pending ? 'var(--accent-subtle)' : 'transparent',
                            }}
                        >
                            <span className="block text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">
                                {b.name}
                            </span>
                            <span className="block text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                                {fmtCurrency(b.total, b.currency)} · {b.count}
                            </span>
                        </button>
                    ))}

                    {newBucketOpen ? (
                        <div className="flex-shrink-0 flex items-center gap-1">
                            <input
                                ref={newBucketRef}
                                autoFocus
                                value={newBucketName}
                                onChange={e => { setNewBucketName(e.target.value); setBucketError(''); }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleCreateBucket();
                                    if (e.key === 'Escape') { setNewBucketOpen(false); setBucketError(''); focusInput(); }
                                }}
                                placeholder="Bucket name"
                                className="w-32 rounded-full border px-3 py-1.5 text-xs bg-transparent text-[var(--text-primary)] outline-none"
                                style={{ borderColor: 'var(--border-glass-accent)' }}
                            />
                            <button
                                onClick={handleCreateBucket}
                                className="text-xs px-2 py-1 rounded-full text-[var(--accent)]"
                            >
                                Add
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => { setNewBucketOpen(true); setBucketError(''); }}
                            className="flex-shrink-0 flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs text-[var(--text-secondary)] whitespace-nowrap"
                            style={{ borderColor: 'var(--border-glass)' }}
                        >
                            <Plus className="w-3 h-3" /> New bucket
                        </button>
                    )}
                </div>
                {bucketError && <p className="text-[10px] text-[var(--text-muted)] mt-1">{bucketError}</p>}
            </div>

            {/* ── Paste field. Always on screen, always ready. ── */}
            <div className="flex-shrink-0 border-t border-[var(--border-glass)] px-4 py-2 pb-3">
                <textarea
                    ref={inputRef}
                    value={draftText}
                    onChange={e => setDraftText(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    placeholder="Paste the payment message here"
                    aria-label="Paste a payment message"
                    className="w-full resize-none rounded-xl border px-3 py-2 text-sm bg-transparent text-[var(--text-primary)] outline-none"
                    style={{ borderColor: 'var(--border-glass)' }}
                />
            </div>
        </div>
    );
}
