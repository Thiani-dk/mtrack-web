import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, Lightbulb, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ActiveModeState, ParsedTransaction, TrackedDocument } from '../../types';
import {
    addBucket, bucketSaleCount, bucketTallies, capture, dayTotal, deleteBucket,
    emptyActiveModeState, fileInto, findDuplicate, isUnsorted, readActiveModeState,
    renameBucket, UNSORTED,
    type BucketError, type DuplicateWarning,
} from '../../lib/activeMode/session';
import { getDrafts, saveDocument as saveApproved } from '../../lib/documentStore';
import { StackedPanel } from '../chat/OverlayStack';
import { buildDraft } from '../../lib/draftDocument';
import { useDocumentStore } from '../../lib/useDocumentStore';
import { fmtCurrency } from '../../lib/receiptGenerator';
import { hasSeenWalkthrough, markWalkthroughSeen } from '../../lib/activeMode/walkthrough';
import { useWakeLock } from '../../lib/useWakeLock';
import { PasteButton } from '../PasteButton';
import { ActiveModeWalkthrough } from './ActiveModeWalkthrough';

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

// Long enough not to fire on an ordinary tap-to-file, short enough to feel
// deliberate rather than broken.
const LONG_PRESS_MS = 500;

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
    // The bucket whose long-press menu is open, and which step it is on.
    // Unsorted never gets one — it is the catch-all that rename and delete
    // both rely on existing.
    const [menuBucket, setMenuBucket] = useState<string | null>(null);
    const [menuMode, setMenuMode] = useState<'actions' | 'rename' | 'confirm-delete'>('actions');
    const [renameValue, setRenameValue] = useState('');
    const [menuError, setMenuError] = useState('');
    const [hydrated, setHydrated] = useState(false);
    // A one-line explanation of the screen-awake indicator, shown on tap
    // rather than sitting on screen permanently.
    const [wakeNoteOpen, setWakeNoteOpen] = useState(false);

    // The screen stays on for as long as this screen is open, and is handed
    // back the moment it unmounts. Nothing to show where the API does not
    // exist — see useWakeLock.
    const wakeLock = useWakeLock(true);
    // Shown automatically the first time only, and on demand from the help
    // icon forever after — never a one-time wall a returning user is locked
    // out of.
    const [walkthroughOpen, setWalkthroughOpen] = useState(() => !hasSeenWalkthrough());

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
                const restored = readActiveModeState(existing.activeMode);
                setState(restored);
                // A reload that landed between a paste and a bucket tap: put
                // the sale back exactly as it was, ready for the tap, rather
                // than discarding the one thing that was actually in progress.
                setPending(restored.pending);
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
            // The unfiled capture rides along in the same debounced write.
            // Everything already filed is safe as a transaction; this is the
            // one thing that would otherwise only exist in memory.
            activeMode: { ...state, pending },
        });
        docRef.current = doc;
        saveDocument(doc);
    }, [transactions, state, pending, hydrated, sessionId, saveDocument]);

    // preventScroll matters here: this fires after every capture, and on a
    // short split-screen viewport a focus that scrolls would yank the layout
    // out from under whatever the vendor was about to tap.
    //
    // Note what is deliberately absent: there is no visibilitychange or window
    // focus handler re-focusing this field. A vendor switching back from their
    // SMS app gets the field as they left it — usually still focused — without
    // the keyboard being thrown open at them or the view jumping.
    const focusInput = useCallback(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        if (hydrated && !walkthroughOpen) focusInput();
    }, [hydrated, walkthroughOpen, focusInput]);

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
            // Nothing is left pending on a finished document.
            activeMode: { ...state, pending: null },
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

    // ── Long-press on a bucket chip ──
    // A press held for LONG_PRESS_MS opens the menu; a normal tap still files
    // the pending capture, so the two gestures do not compete. The timer is
    // cancelled on move as well as on release, or scrolling the chip row
    // sideways would keep opening menus.
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFired = useRef(false);

    const cancelLongPress = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const openBucketMenu = useCallback((name: string) => {
        if (isUnsorted(name)) return;
        setMenuBucket(name);
        setMenuMode('actions');
        setRenameValue(name);
        setMenuError('');
    }, []);

    const startLongPress = useCallback((name: string) => {
        if (isUnsorted(name)) return;
        longPressFired.current = false;
        cancelLongPress();
        longPressTimer.current = setTimeout(() => {
            longPressFired.current = true;
            openBucketMenu(name);
        }, LONG_PRESS_MS);
    }, [cancelLongPress, openBucketMenu]);

    const closeBucketMenu = useCallback(() => {
        setMenuBucket(null);
        setMenuError('');
        focusInput();
    }, [focusInput]);

    const handleRenameBucket = () => {
        if (!menuBucket) return;
        const result = renameBucket(state, transactions, menuBucket, renameValue);
        if (result.error) {
            setMenuError(BUCKET_ERROR[result.error]);
            return;
        }
        setState(result.state);
        setTransactions(result.transactions);
        closeBucketMenu();
    };

    const handleDeleteBucket = () => {
        if (!menuBucket) return;
        const result = deleteBucket(state, transactions, menuBucket);
        setState(result.state);
        setTransactions(result.transactions);
        closeBucketMenu();
    };

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

    const closeWalkthrough = useCallback(() => {
        markWalkthroughSeen();
        setWalkthroughOpen(false);
        focusInput();
    }, [focusInput]);

    // Bucket names chosen during the walkthrough are setup, not captured data,
    // so they carry over. The practice sale does not exist outside the
    // walkthrough's own state and cannot.
    const seedBuckets = useCallback((names: string[]) => {
        setState(prev => names.reduce((acc, name) => addBucket(acc, name).state, prev));
    }, []);

    return (
        <div
            className="active-mode flex flex-col bg-[var(--bg-base)] overflow-hidden"
            // dvh, not vh: vh is the viewport WITHOUT accounting for browser
            // chrome or the on-screen keyboard, so on a phone it reports more
            // height than exists and pushes the bottom controls — here, the
            // paste field and Finish — off screen. That is the specific failure
            // this screen cannot have, since the paste field is the feature.
            style={{ height: '100dvh', maxHeight: '100dvh' }}
        >
            {walkthroughOpen && (
                <ActiveModeWalkthrough onClose={closeWalkthrough} onSeedBuckets={seedBuckets} />
            )}

            {/* ── Long-press menu. The app's established overlay: a
                StackedPanel on the shared OverlayStack (tap-outside closes the
                top of the stack) wrapping a .glass-panel surface. ── */}
            {menuBucket && (
                <StackedPanel
                    id="active-mode-bucket-menu"
                    onClose={closeBucketMenu}
                    className="fixed inset-0 flex items-center justify-center p-4"
                >
                    <div data-bucket-menu className="glass-panel rounded-2xl p-4 space-y-2.5 w-full max-w-xs">
                        <p className="text-[11px] text-[var(--text-muted)] truncate">{menuBucket}</p>

                        {menuMode === 'actions' && (
                            <div className="space-y-1.5">
                                <button
                                    onClick={() => { setMenuMode('rename'); setMenuError(''); }}
                                    className="w-full flex items-center gap-2 text-xs px-2 py-2 rounded-lg text-left text-[var(--text-primary)]"
                                    style={{ background: 'var(--bg-elevated)' }}
                                >
                                    <Pencil className="w-3.5 h-3.5" /> Rename
                                </button>
                                <button
                                    onClick={() => {
                                        // An empty bucket has nothing to lose,
                                        // so it just goes. One with sales in it
                                        // gets a sentence first.
                                        if (bucketSaleCount(transactions, menuBucket) === 0) handleDeleteBucket();
                                        else setMenuMode('confirm-delete');
                                    }}
                                    className="w-full flex items-center gap-2 text-xs px-2 py-2 rounded-lg text-left text-[var(--text-primary)]"
                                    style={{ background: 'var(--bg-elevated)' }}
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                </button>
                            </div>
                        )}

                        {menuMode === 'rename' && (
                            <div className="space-y-2">
                                {/* Same tap-type-confirm interaction as
                                    creating a bucket, down to the Enter and
                                    Escape keys. */}
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={e => { setRenameValue(e.target.value); setMenuError(''); }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleRenameBucket();
                                        if (e.key === 'Escape') closeBucketMenu();
                                    }}
                                    aria-label="Bucket name"
                                    className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                                />
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={handleRenameBucket}
                                        className="btn-primary flex-1 text-xs px-2 py-1.5 rounded-lg"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={closeBucketMenu}
                                        className="text-xs px-2 py-1.5 rounded-lg text-[var(--text-muted)]"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {menuMode === 'confirm-delete' && (
                            <div className="space-y-2">
                                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                    {(() => {
                                        const n = bucketSaleCount(transactions, menuBucket);
                                        return `Move ${n} ${n === 1 ? 'sale' : 'sales'} to ${UNSORTED} and delete this bucket?`;
                                    })()}
                                </p>
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={handleDeleteBucket}
                                        className="btn-primary flex-1 text-xs px-2 py-1.5 rounded-lg"
                                    >
                                        Move and delete
                                    </button>
                                    <button
                                        onClick={closeBucketMenu}
                                        className="text-xs px-2 py-1.5 rounded-lg text-[var(--text-muted)]"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {menuError && <p className="text-[10px] text-[var(--text-muted)]">{menuError}</p>}
                    </div>
                </StackedPanel>
            )}
            {/* ── Header: the running day, and the way out. ── */}
            <header className="am-header flex-shrink-0 border-b border-[var(--border-glass)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                            Active Mode
                        </p>
                        <p className="am-total text-2xl font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
                            {fmtCurrency(total, currency)}
                        </p>
                        <p className="am-count text-xs text-[var(--text-muted)]">
                            {transactions.length} {transactions.length === 1 ? 'sale' : 'sales'} today
                        </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {wakeLock.supported && (
                            <button
                                onClick={() => setWakeNoteOpen(o => !o)}
                                aria-label="Screen stays on"
                                title="Screen stays on"
                                aria-pressed={wakeNoteOpen}
                                data-wake-lock={wakeLock.state}
                                className="p-2 rounded-lg"
                                style={{ color: wakeLock.state === 'held' ? 'var(--accent)' : 'var(--text-muted)' }}
                            >
                                <Lightbulb className="w-5 h-5" />
                            </button>
                        )}
                        <button
                            onClick={() => { setWalkthroughOpen(true); onShowWalkthrough?.(); }}
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
                {wakeNoteOpen && wakeLock.supported && (
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)] leading-snug">
                        Your screen will stay on while this is open, so you don't have to keep
                        tapping it awake.
                    </p>
                )}
            </header>

            {/* ── The capture area. Scrolls; the input and chips below do not. ── */}
            <div className="am-capture flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
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
                    <p className="am-hint text-sm text-[var(--text-muted)]">
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
                <div className="am-chips gap-2 pb-1" style={{ scrollbarWidth: 'thin' }}>
                    {tallies.map(b => (
                        <button
                            key={b.name}
                            data-bucket={b.name}
                            onClick={() => {
                                // Swallow the click the browser fires after a
                                // long press, so holding a chip cannot also
                                // file the pending sale into it.
                                if (longPressFired.current) { longPressFired.current = false; return; }
                                commitPending(b.name);
                                focusInput();
                            }}
                            onPointerDown={() => startLongPress(b.name)}
                            onPointerUp={cancelLongPress}
                            onPointerLeave={cancelLongPress}
                            onPointerCancel={cancelLongPress}
                            onPointerMove={cancelLongPress}
                            // Keyboard and screen-reader equivalent for the
                            // same menu — a gesture must never be the only way
                            // to reach an action.
                            onContextMenu={e => { e.preventDefault(); openBucketMenu(b.name); }}
                            // A tap files; press and hold is a separate action,
                            // so the chip must not be draggable or selectable.
                            style={{
                                borderColor: pending ? 'var(--border-glass-accent)' : 'var(--border-glass)',
                                background: pending ? 'var(--accent-subtle)' : 'transparent',
                                touchAction: 'pan-x',
                                WebkitUserSelect: 'none',
                                userSelect: 'none',
                                // Dimmed when there is nothing to file, but
                                // still pressable: a disabled button fires no
                                // pointer events, which would put rename and
                                // delete out of reach except mid-capture.
                                opacity: pending ? 1 : 0.5,
                            }}
                            // Unsorted stays tappable to file into, but has no
                            // edit affordance at all.
                            aria-description={isUnsorted(b.name) ? undefined : 'Press and hold to rename or delete'}
                            className="flex-shrink-0 rounded-full border px-3 py-1.5 text-left"
                            // Only filing needs a pending capture; the menu
                            // does not, so the chip stays pressable either way.
                            aria-disabled={!pending}
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
                <div className="flex items-end gap-2">
                <textarea
                    ref={inputRef}
                    value={draftText}
                    onChange={e => setDraftText(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    placeholder="Paste the payment message here"
                    aria-label="Paste a payment message"
                    className="am-input w-full resize-none rounded-xl border px-3 py-2 text-sm bg-transparent text-[var(--text-primary)] outline-none"
                    style={{ borderColor: 'var(--border-glass)' }}
                />
                {/* One tap instead of long-press-then-Paste. It feeds
                    runCapture — the same function a manual paste and a typed
                    line both go through. */}
                <PasteButton
                    onText={runCapture}
                    notePlacement="above"
                    className="flex-shrink-0 items-end pb-1"
                />
                </div>
            </div>
        </div>
    );
}
