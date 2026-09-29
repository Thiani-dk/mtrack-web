import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, HelpCircle, Lightbulb, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ActiveModeState, ParsedTransaction, TrackedDocument } from '../../types';
import {
    addBucket, bucketOf, bucketSaleCount, bucketTallies, buildCashSale, buildLumpSumBatch,
    capture, dayTotal, deleteBucket, emptyActiveModeState, fileInto, findDuplicate, isCashSale,
    isUnsorted, lastCashSale, presetAmounts, readActiveModeState, recentEntries, removeByCode,
    renameBucket, repeatCashSale, UNSORTED,
    type BucketError, type DuplicateWarning,
} from '../../lib/activeMode/session';
import { buildDailySalesCsv } from '../../lib/activeMode/csv';
import { downloadCSV } from '../../lib/downloadUtils';
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
    // Tapping Finish with nothing recorded used to do nothing at all — the
    // button was simply disabled. Enabled now, so a tap gets a plain answer
    // ("nothing recorded yet") instead of silence, and an obvious way to keep
    // going rather than a dead end.
    const [finishNotice, setFinishNotice] = useState('');

    // ── Cash (Phase 2) ──
    // The Cash flow is three taps: open it, pick a bucket, pick an amount.
    // Modelled as an overlay (like the bucket long-press menu) rather than
    // inline in the capture area, specifically so it can never affect the
    // base layout's height — the one thing every constrained-viewport test in
    // this screen exists to guard.
    const [cashOpen, setCashOpen] = useState(false);
    const [cashStep, setCashStep] = useState<'bucket' | 'amount' | 'keypad'>('bucket');
    const [cashBucket, setCashBucket] = useState<string | null>(null);
    const [keypadValue, setKeypadValue] = useState('');
    // A brief, dismissible confirmation with an Undo — shown after ANY entry,
    // cash or M-Pesa, filed or repeated. Cleared automatically after about
    // ten seconds, or immediately once tapped.
    const [lastAdded, setLastAdded] = useState<{ code: string; label: string } | null>(null);
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The compact list of today's entries (both cash and M-Pesa), each
    // removable — the ten-second Undo above is the fast path; this is the
    // "I want to check, or fix something from a few sales ago" path.
    const [entriesOpen, setEntriesOpen] = useState(false);
    // "Add cash for the day": one total (and an optional count) per bucket,
    // for a vendor who will not log cash live. Reachable from the entries
    // list at any time. `rows` is keyed by bucket name, with '' standing in
    // for "Overall" — a total not attributed to any one bucket.
    const [lumpSumOpen, setLumpSumOpen] = useState(false);
    const [lumpSumRows, setLumpSumRows] = useState<Record<string, { amount: string; count: string }>>({});

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
                    .filter(d => d.documentType === 'daily_sales')
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
            documentType: 'daily_sales',
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
    const lastCash = lastCashSale(transactions);

    // A capture arriving while one is still unfiled files the old one into
    // Unsorted. Never dropped, never blocking the new paste — a vendor too
    // slammed to categorise every sale still ends the day with every sale.
    // A brief "Added — Undo" confirmation, for any entry however it arrived.
    // Replaces whatever the previous one was, so filing three sales in a row
    // only ever offers to undo the most recent — undoing an OLDER one is what
    // the entries list further down is for.
    const showUndo = useCallback((code: string, label: string) => {
        if (undoTimer.current) clearTimeout(undoTimer.current);
        setLastAdded({ code, label });
        undoTimer.current = setTimeout(() => setLastAdded(null), 10000);
    }, []);

    const handleUndo = useCallback(() => {
        if (!lastAdded) return;
        if (undoTimer.current) clearTimeout(undoTimer.current);
        setTransactions(prev => removeByCode(prev, lastAdded.code));
        setLastAdded(null);
    }, [lastAdded]);

    useEffect(() => () => {
        if (undoTimer.current) clearTimeout(undoTimer.current);
    }, []);

    const commitPending = useCallback((into: string) => {
        if (pending) showUndo(pending.transactionCode, `${fmtCurrency(pending.amount, pending.currency)} to ${isUnsorted(into) ? UNSORTED : into}`);
        setTransactions(prev => (pending ? [...prev, fileInto(pending, into)] : prev));
        setPending(null);
        setWarning(null);
    }, [pending, showUndo]);

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

    // ── Cash (Phase 2) ──────────────────────────────────────────────────────
    const closeCash = useCallback(() => {
        setCashOpen(false);
        setCashStep('bucket');
        setCashBucket(null);
        setKeypadValue('');
        focusInput();
    }, [focusInput]);

    const openCash = useCallback(() => {
        setCashStep('bucket');
        setCashBucket(null);
        setKeypadValue('');
        setCashOpen(true);
    }, []);

    const chooseCashBucket = useCallback((bucket: string) => {
        setCashBucket(bucket);
        setCashStep('amount');
    }, []);

    // Files the sale and closes the whole overlay — the third and last of the
    // three taps ("Cash", bucket, amount).
    const fileCashAmount = useCallback((amount: number) => {
        if (!cashBucket || !(amount > 0)) return;
        const sale = buildCashSale({ bucket: cashBucket, amount });
        setTransactions(prev => [...prev, sale]);
        showUndo(sale.transactionCode, `${fmtCurrency(amount, 'KES')} to ${bucketOf(sale)}`);
        closeCash();
    }, [cashBucket, showUndo, closeCash]);

    const submitKeypad = useCallback(() => {
        const amount = parseFloat(keypadValue);
        if (Number.isFinite(amount) && amount > 0) fileCashAmount(amount);
    }, [keypadValue, fileCashAmount]);

    // One tap: repeats the last cash sale's bucket and amount exactly, logged
    // now. Needs no overlay at all — the whole point is that a run of
    // identical sales costs one tap each after the first.
    const handleSameAgain = useCallback(() => {
        const last = lastCashSale(transactions);
        if (!last) return;
        const repeat = repeatCashSale(last);
        setTransactions(prev => [...prev, repeat]);
        showUndo(repeat.transactionCode, `${fmtCurrency(repeat.amount, repeat.currency)} to ${bucketOf(repeat)}`);
    }, [transactions, showUndo]);

    // ── Today's entries: the compact list, and CSV export ──────────────────
    const handleRemoveEntry = useCallback((code: string) => {
        setTransactions(prev => removeByCode(prev, code));
        if (lastAdded?.code === code) setLastAdded(null);
    }, [lastAdded]);

    const handleExportCsv = useCallback(() => {
        const csv = buildDailySalesCsv(transactions);
        downloadCSV(csv, `mtrack-sales-${new Date().toISOString().slice(0, 10)}.csv`);
    }, [transactions]);

    // ── "Add cash for the day": one total per bucket, an optional count ────
    const openLumpSum = useCallback(() => {
        const initial: Record<string, { amount: string; count: string }> = {};
        for (const b of state.buckets) initial[b] = { amount: '', count: '' };
        setLumpSumRows(initial);
        setLumpSumOpen(true);
    }, [state.buckets]);

    const closeLumpSum = useCallback(() => {
        setLumpSumOpen(false);
        focusInput();
    }, [focusInput]);

    const submitLumpSum = useCallback(() => {
        const rows = Object.entries(lumpSumRows)
            .map(([bucket, v]) => ({
                bucket,
                amount: parseFloat(v.amount),
                count: v.count.trim() ? parseInt(v.count, 10) : null,
            }))
            .filter(r => Number.isFinite(r.amount) && r.amount > 0);
        if (rows.length > 0) {
            const batch = buildLumpSumBatch(rows);
            setTransactions(prev => [...prev, ...batch]);
        }
        closeLumpSum();
    }, [lumpSumRows, closeLumpSum]);

    // Finish moves the session from draft to approved, the same finalisation
    // step every other document type uses — nothing Active-Mode-specific
    // happens to the document itself. Anything still pending is filed to
    // Unsorted first, so the last sale of the day cannot be the one that gets
    // left behind.
    const handleFinish = useCallback(async () => {
        if (!sessionId) return;
        const finalTransactions = pending ? [...transactions, fileInto(pending, UNSORTED)] : transactions;
        if (finalTransactions.length === 0) {
            setFinishNotice("Nothing recorded yet. Paste a sale, or log a cash one, and Finish will be ready.");
            setTimeout(() => setFinishNotice(''), 4000);
            return;
        }

        const doc = buildDraft({
            sessionId,
            documentType: 'daily_sales',
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

            {/* ── Cash: an overlay, not a change to the base layout, so it can
                never push the paste field or the chips off a short viewport.
                Three steps, one screen at a time, same tap-type-confirm shape
                as the bucket menu above. ── */}
            {cashOpen && (
                <StackedPanel
                    id="active-mode-cash"
                    onClose={closeCash}
                    className="fixed inset-0 flex items-center justify-center p-4"
                >
                    <div data-cash-panel className="glass-panel rounded-2xl p-4 space-y-3 w-full max-w-xs">
                        {cashStep === 'bucket' && (
                            <>
                                <p className="text-xs font-semibold text-[var(--text-primary)]">Cash — which bucket?</p>
                                <div className="flex flex-wrap gap-2">
                                    {state.buckets.map(name => (
                                        <button
                                            key={name}
                                            data-cash-bucket={name}
                                            onClick={() => chooseCashBucket(name)}
                                            className="rounded-full border px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
                                            style={{ borderColor: 'var(--border-glass)', minHeight: 44 }}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {cashStep === 'amount' && cashBucket && (
                            <>
                                <p className="text-xs font-semibold text-[var(--text-primary)]">
                                    Cash into {cashBucket} — how much?
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {presetAmounts(transactions, cashBucket).map(amount => (
                                        <button
                                            key={amount}
                                            data-cash-amount={amount}
                                            onClick={() => fileCashAmount(amount)}
                                            className="rounded-full border px-3 py-2 text-xs font-medium tabular-nums text-[var(--text-primary)]"
                                            style={{ borderColor: 'var(--border-glass)', minHeight: 44 }}
                                        >
                                            {fmtCurrency(amount, currency)}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setCashStep('keypad')}
                                        className="rounded-full border border-dashed px-3 py-2 text-xs text-[var(--text-secondary)]"
                                        style={{ borderColor: 'var(--border-glass)', minHeight: 44 }}
                                    >
                                        Other
                                    </button>
                                </div>
                            </>
                        )}

                        {cashStep === 'keypad' && (
                            <>
                                <p className="text-xs font-semibold text-[var(--text-primary)]">Amount, in Ksh</p>
                                <p
                                    data-cash-keypad-value
                                    className="text-2xl font-semibold tabular-nums text-[var(--text-primary)] py-1"
                                >
                                    {keypadValue || '0'}
                                </p>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                                        <button
                                            key={d}
                                            onClick={() => setKeypadValue(v => (v.length < 7 ? v + d : v))}
                                            className="rounded-xl text-lg font-medium text-[var(--text-primary)]"
                                            style={{ background: 'var(--bg-elevated)', minHeight: 48 }}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setKeypadValue(v => v.slice(0, -1))}
                                        aria-label="Backspace"
                                        className="rounded-xl text-sm font-medium text-[var(--text-secondary)]"
                                        style={{ background: 'var(--bg-elevated)', minHeight: 48 }}
                                    >
                                        ⌫
                                    </button>
                                    <button
                                        onClick={() => setKeypadValue(v => (v.length < 7 ? v + '0' : v))}
                                        className="rounded-xl text-lg font-medium text-[var(--text-primary)]"
                                        style={{ background: 'var(--bg-elevated)', minHeight: 48 }}
                                    >
                                        0
                                    </button>
                                    <button
                                        onClick={submitKeypad}
                                        disabled={!keypadValue}
                                        className="btn-primary rounded-xl text-sm font-medium disabled:opacity-40"
                                        style={{ minHeight: 48 }}
                                    >
                                        Done
                                    </button>
                                </div>
                            </>
                        )}

                        <button
                            onClick={closeCash}
                            className="w-full text-xs py-1.5 rounded-lg text-[var(--text-muted)]"
                            style={{ minHeight: 32 }}
                        >
                            Cancel
                        </button>
                    </div>
                </StackedPanel>
            )}

            {/* ── Today's entries: the compact list, each removable, plus CSV
                export and the way into "Add cash for the day". ── */}
            {entriesOpen && (
                <StackedPanel
                    id="active-mode-entries"
                    onClose={() => setEntriesOpen(false)}
                    className="fixed inset-0 flex items-center justify-center p-4"
                >
                    <div className="glass-panel rounded-2xl p-4 space-y-2.5 w-full max-w-sm max-h-[80vh] flex flex-col">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">Today's entries</p>
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                            {transactions.length === 0 && (
                                <p className="text-xs text-[var(--text-muted)] py-4 text-center">Nothing filed yet.</p>
                            )}
                            {recentEntries(transactions).map(t => (
                                <div
                                    key={t.transactionCode}
                                    data-entry={t.transactionCode}
                                    className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                                    style={{ background: 'var(--bg-elevated)' }}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                                            {bucketOf(t)}
                                            {t.isLumpSum && ' · lump sum'}
                                        </p>
                                        <p className="text-[10px] text-[var(--text-muted)]">
                                            {isCashSale(t) ? 'Cash' : 'M-Pesa'}{t.time ? ` · ${t.time}` : ''}
                                        </p>
                                    </div>
                                    <p className="text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                                        {fmtCurrency(t.amount, t.currency)}
                                    </p>
                                    <button
                                        onClick={() => handleRemoveEntry(t.transactionCode)}
                                        aria-label="Remove entry"
                                        className="flex-shrink-0 p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                        style={{ minHeight: 40, minWidth: 40 }}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-1.5 pt-1">
                            <button
                                onClick={openLumpSum}
                                className="flex-1 text-xs px-2 py-2 rounded-lg text-[var(--text-secondary)]"
                                style={{ background: 'var(--bg-elevated)', minHeight: 44 }}
                            >
                                Add cash for the day
                            </button>
                            <button
                                onClick={handleExportCsv}
                                disabled={transactions.length === 0}
                                className="flex-1 text-xs px-2 py-2 rounded-lg text-[var(--text-secondary)] disabled:opacity-40"
                                style={{ background: 'var(--bg-elevated)', minHeight: 44 }}
                            >
                                Export CSV
                            </button>
                        </div>
                        <button
                            onClick={() => setEntriesOpen(false)}
                            className="w-full text-xs py-1.5 rounded-lg text-[var(--text-muted)]"
                        >
                            Close
                        </button>
                    </div>
                </StackedPanel>
            )}

            {/* ── "Add cash for the day": one total (and an optional count) per
                bucket, for a vendor who will not log cash live. ── */}
            {lumpSumOpen && (
                <StackedPanel
                    id="active-mode-lump-sum"
                    onClose={closeLumpSum}
                    className="fixed inset-0 flex items-center justify-center p-4"
                >
                    <div className="glass-panel rounded-2xl p-4 space-y-3 w-full max-w-sm max-h-[80vh] flex flex-col">
                        <div>
                            <p className="text-xs font-semibold text-[var(--text-primary)]">Add cash for the day</p>
                            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                                One total per bucket. The count is optional — leave it blank if you are not sure.
                            </p>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                            {state.buckets.map(name => (
                                <div key={name} className="space-y-1">
                                    <p className="text-[11px] font-medium text-[var(--text-secondary)]">{name}</p>
                                    <div className="flex gap-1.5">
                                        <input
                                            data-lump-amount={name}
                                            inputMode="decimal"
                                            placeholder="Total, Ksh"
                                            value={lumpSumRows[name]?.amount ?? ''}
                                            onChange={e => setLumpSumRows(prev => ({
                                                ...prev, [name]: { amount: e.target.value, count: prev[name]?.count ?? '' },
                                            }))}
                                            className="flex-1 min-w-0 rounded-lg border px-2.5 text-xs bg-transparent text-[var(--text-primary)] outline-none"
                                            style={{ borderColor: 'var(--border-glass)', minHeight: 44 }}
                                        />
                                        <input
                                            data-lump-count={name}
                                            inputMode="numeric"
                                            placeholder="Count (optional)"
                                            value={lumpSumRows[name]?.count ?? ''}
                                            onChange={e => setLumpSumRows(prev => ({
                                                ...prev, [name]: { amount: prev[name]?.amount ?? '', count: e.target.value },
                                            }))}
                                            className="w-28 flex-shrink-0 rounded-lg border px-2.5 text-xs bg-transparent text-[var(--text-primary)] outline-none"
                                            style={{ borderColor: 'var(--border-glass)', minHeight: 44 }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-1.5">
                            <button onClick={submitLumpSum} className="btn-primary flex-1 text-xs px-2 py-2 rounded-lg" style={{ minHeight: 44 }}>
                                Add
                            </button>
                            <button
                                onClick={closeLumpSum}
                                className="text-xs px-3 py-2 rounded-lg text-[var(--text-muted)]"
                                style={{ minHeight: 44 }}
                            >
                                Cancel
                            </button>
                        </div>
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
                            onClick={() => setEntriesOpen(true)}
                            aria-label="Today's entries"
                            title="Today's entries"
                            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            <ListChecks className="w-5 h-5" />
                        </button>
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
                            className="rounded-full px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap"
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
                {finishNotice && (
                    <p className="mt-1.5 text-[11px] text-[var(--accent)] leading-snug">
                        {finishNotice}
                    </p>
                )}
            </header>

            {/* ── The capture area. Scrolls; the input and chips below do not. ── */}
            <div className="am-capture flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                {pending ? (
                    <div
                        className="rounded-xl border p-3"
                        style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}
                        // The pending capture as a value, not as words. The
                        // empty-state hint below also contains the phrase "tap
                        // a bucket", so any test matching on that text cannot
                        // tell a waiting sale from no sale at all.
                        data-pending-capture
                        data-pending-amount={pending.amount}
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

                {/* A brief "Added — Undo" line, for any entry however it
                    arrived. Inline in the scrolling capture area rather than
                    a toast or a new fixed row, so it never costs the layout
                    height a short viewport cannot spare. */}
                {lastAdded && (
                    <div
                        className="rounded-xl border px-3 py-2 text-xs flex items-center justify-between gap-2"
                        style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}
                    >
                        <span className="text-[var(--text-secondary)] truncate">Added {lastAdded.label}.</span>
                        <button
                            onClick={handleUndo}
                            className="flex-shrink-0 font-medium underline underline-offset-2 text-[var(--accent)]"
                            style={{ minHeight: 32 }}
                        >
                            Undo
                        </button>
                    </div>
                )}
            </div>

            {/* ── Buckets, Cash and Same-again all live in this one
                horizontally-scrollable row. Cash and Same-again (when there is
                a sale to repeat) are its first two chips, styled distinctly
                from a bucket — this is deliberate: the row already scrolls
                sideways rather than wrapping at every viewport this screen
                supports (see viewport.e2e.mjs), so adding to it costs no new
                vertical space at all, where a separate fixed bar would have
                threatened the shortest supported height. ── */}
            <div className="flex-shrink-0 border-t border-[var(--border-glass)] px-4 py-2">
                <div className="am-chips gap-2 pb-1" style={{ scrollbarWidth: 'thin' }}>
                    {/* Cash: the first of its three taps. A filled chip, not
                        an outline one like a bucket, since it starts an
                        action rather than naming a category. */}
                    <button
                        onClick={openCash}
                        className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap"
                        style={{ background: 'var(--accent)', minHeight: 44 }}
                    >
                        <Banknote className="w-3.5 h-3.5" /> Cash
                    </button>
                    {/* Same again: one tap, once there is a cash sale to
                        repeat. Absent until then, rather than disabled — a
                        vendor's first sale of the day has nothing to repeat. */}
                    {lastCash && (
                        <button
                            onClick={handleSameAgain}
                            className="flex-shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap"
                            style={{ borderColor: 'var(--border-glass-accent)', minHeight: 44 }}
                        >
                            Same again · {fmtCurrency(lastCash.amount, lastCash.currency)}
                        </button>
                    )}
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
