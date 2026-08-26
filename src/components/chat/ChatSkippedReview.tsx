import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ParsedTransaction, SkippedMessage } from '../../types';
import { extractRawBlock, finalizeTransaction, deriveSubType } from '../../lib/parsers';
import { extractCode } from '../../lib/parsers/extractors/code';
import { getExclusionReason } from '../../lib/transactionDisplay';
import { TransactionSkeleton } from './TransactionSkeleton';
import { StackedPanel } from './OverlayStack';

interface ChatSkippedReviewProps {
    messageId: string;
    skippedMessages: SkippedMessage[];
    // The paired receipt message's current transactions — needed to look up
    // the real transaction behind an 'excluded' entry (for its
    // getExclusionReason() label, and so "Include" can flip it back on).
    transactions: ParsedTransaction[];
    // A one-shot "please expand" signal from the partial-notice's "View
    // skipped" tap — bumping epoch re-opens this card even though its own
    // expanded state is otherwise fully local (see ChatScreen).
    expandSignal: { id: string; epoch: number };
    onInclude: (messageId: string, entry: SkippedMessage, transaction: ParsedTransaction) => void;
    onUnexclude: (messageId: string, transactionCode: string) => void;
}

// A human has now explicitly vouched for this one block being a real
// transaction, so the single-block retry accepts a lower score than the
// main pipeline's normal 40 — never applied outside this one retry call.
const RETRY_MIN_SCORE = 25;

const REASON_LABELS: Record<Exclude<SkippedMessage['reason'], 'excluded'>, string> = {
    'not-a-transaction': 'not a transaction',
    'duplicate': 'duplicate',
    'unreadable': "couldn't read this one",
};

function truncateRaw(text: string, maxLen = 60): string {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen - 1)}…`;
}

function todayInputValue(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// input[type=date] gives "YYYY-MM-DD" — parsed as local-time components
// directly, not via `new Date(string)`, which reads it as UTC midnight and
// can land on the wrong day once formatted back in a negative-UTC timezone.
function parseDateInputValue(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function ManualEntryForm({
    onSubmit, onCancel,
}: {
    onSubmit: (amount: number, recipient: string, date: Date) => void;
    onCancel: () => void;
}) {
    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');
    const [date, setDate] = useState(todayInputValue());

    const valid = Number.isFinite(parseFloat(amount)) && parseFloat(amount) > 0 && recipient.trim().length > 0;

    const handleSubmit = () => {
        if (!valid) return;
        onSubmit(parseFloat(amount), recipient.trim(), parseDateInputValue(date));
    };

    // Floats above the skipped-review panel now (a StackedPanel, not an
    // inline reveal), so it needs its own opaque surface — the established
    // .glass-panel rule, same as every other floating panel in the app.
    return (
        <div className="glass-panel rounded-2xl p-4 space-y-2.5 w-full max-w-sm mx-auto">
            <p className="text-[11px] text-[var(--text-muted)]">
                Couldn't read this one automatically. Fill in what you know.
            </p>
            <input
                type="number"
                inputMode="decimal"
                placeholder="Amount"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            />
            <input
                type="text"
                placeholder="Recipient"
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            />
            <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            />
            <div className="flex gap-1.5 pt-0.5">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!valid}
                    className="flex-1 text-xs font-medium py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#ffffff' }}
                >
                    Add transaction
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-xs px-2.5 py-1.5 rounded-lg text-[var(--text-muted)]"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

// Purely for visual consistency with the main entrance sequence — the merge
// itself is local state, effectively instant, but a jarring pop would read
// as a different (lesser) treatment than everywhere else transaction data
// appears. Named so it's the one place that duration lives, not a scattered
// magic number.
const INCLUDE_SKELETON_MS = 300;

function SkippedRow({
    entry, transactions, onInclude, onUnexclude,
}: {
    entry: SkippedMessage;
    transactions: ParsedTransaction[];
    onInclude: (transaction: ParsedTransaction) => void;
    onUnexclude: (transactionCode: string) => void;
}) {
    const [showManualEntry, setShowManualEntry] = useState(false);
    const reducedMotion = useReducedMotion();
    // Set the instant Include is tapped (any path) — swaps this row's
    // content for a skeleton for one short beat before the actual merge
    // callback fires, so recovering a transaction gets the same
    // skeleton-to-real treatment as everywhere else transaction data lands,
    // never a straight pop.
    const [including, setIncluding] = useState(false);

    const excludedTx = entry.reason === 'excluded'
        ? transactions.find(t => t.transactionCode === entry.transactionCode)
        : undefined;
    const reasonLabel = entry.reason === 'excluded'
        ? (excludedTx ? getExclusionReason(excludedTx) ?? 'excluded' : 'excluded')
        : REASON_LABELS[entry.reason];

    const commitUnexclude = (transactionCode: string) => {
        setIncluding(true);
        setTimeout(() => onUnexclude(transactionCode), INCLUDE_SKELETON_MS);
    };

    const commitInclude = (transaction: ParsedTransaction) => {
        setIncluding(true);
        setTimeout(() => onInclude(transaction), INCLUDE_SKELETON_MS);
    };

    const handleIncludeTap = () => {
        if (entry.reason === 'excluded') {
            if (entry.transactionCode) commitUnexclude(entry.transactionCode);
            return;
        }
        // First attempt: re-run just this block through the normal per-block
        // pipeline (no cross-block linking — there's nothing to link a lone
        // retried block against), with the confidence bar lowered for this
        // one explicit, human-vouched-for retry only.
        const raw = extractRawBlock(entry.rawText, 0);
        const retried = finalizeTransaction(raw, RETRY_MIN_SCORE);
        if (retried) {
            commitInclude(retried);
        } else {
            setShowManualEntry(true);
        }
    };

    const handleManualSubmit = (amount: number, recipient: string, date: Date) => {
        // Same default pattern the generic extractor pipeline already uses
        // for an unmatched block (extractChannel's own fallback is
        // provider: 'Unknown', method: 'transfer' — provider is overridden
        // to 'Manual entry' per spec, method keeps the pipeline's default).
        const method = 'transfer';
        const type: 'sent' | 'received' = 'sent';
        const codeResult = extractCode(entry.rawText, { merchant: null, amount, isoDate: date.toISOString() });
        const transaction: ParsedTransaction = {
            date,
            time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
            type,
            subType: deriveSubType(method, type, false, recipient),
            amount,
            recipient,
            transactionCode: codeResult.code,
            balance: null,
            transactionCost: null,
            rawLine: entry.rawText,
            label: null,
            customLabel: null,
            receiptLabel: null,
            excludedFromReceipt: false,

            currency: 'KES',
            sender: null,
            account: null,
            provider: 'Manual entry',
            method,
            merchant: null,
            merchantCategory: null,
            location: null,
            isBusiness: false,

            // A human provided this directly — not low-confidence.
            confidence: 100,
            confidenceLevel: 'high',
            missingFields: [],
            codeIsSynthetic: codeResult.synthetic,
            dateAmbiguous: false,
            failed: false,
            isHold: false,
            isVerificationCharge: false,
            cardLast4: null,
        };
        setShowManualEntry(false);
        commitInclude(transaction);
    };

    // A genuine crossfade (both transitions running together, not
    // sequential) between the row's normal content and the skeleton — the
    // same "resolves into place" language as the main reveal, not a swap.
    return (
        <>
            <AnimatePresence initial={false}>
                {including ? (
                    <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                        <TransactionSkeleton />
                    </motion.div>
                ) : (
                    <motion.div
                        key="content"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="py-2 border-b border-[var(--border-glass)] last:border-0"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] text-[var(--text-secondary)] truncate">{truncateRaw(entry.rawText)}</p>
                                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{reasonLabel}</span>
                            </div>
                            <button
                                type="button"
                                onClick={handleIncludeTap}
                                className="flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full"
                                style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                            >
                                Include
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Portaled: this row can sit arbitrarily deep inside the already-open
                skipped-review panel, and that ancestor panel itself recedes
                (gains a transform) the moment this opens — a plain nested fixed
                div would then be scoped to that transformed ancestor instead of
                the viewport. Rendering at document.body sidesteps that, while
                AnimatePresence around the conditional (rather than around the
                portal call) still lets the exit animation play before unmount. */}
            {createPortal(
                <AnimatePresence>
                    {showManualEntry && (
                        <StackedPanel
                            id={`skipped-manual-entry-${entry.transactionCode ?? entry.rawText}`}
                            onClose={() => setShowManualEntry(false)}
                            className="fixed inset-0 z-modal flex items-end justify-center p-4"
                        >
                            <motion.div
                                initial={reducedMotion ? false : { opacity: 0, y: 24 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={reducedMotion ? undefined : { opacity: 0, y: 24 }}
                                transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
                                className="w-full max-w-sm"
                            >
                                <ManualEntryForm onSubmit={handleManualSubmit} onCancel={() => setShowManualEntry(false)} />
                            </motion.div>
                        </StackedPanel>
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </>
    );
}

export function ChatSkippedReview({
    messageId, skippedMessages, transactions, expandSignal, onInclude, onUnexclude,
}: ChatSkippedReviewProps) {
    // Local, not persisted — reopening a saved session defaults back to
    // collapsed, which is fine (per spec). The external "View skipped" tap
    // (expandSignal) still needs to force this open on demand, and the
    // user's own header tap needs to freely toggle it afterward — so this
    // adjusts state during render (React's own documented pattern for
    // "adjusting state when a prop changes", not an effect: an effect would
    // mean an extra committed frame in the collapsed state before flipping
    // open) rather than reacting to expandSignal in a useEffect.
    const [expanded, setExpanded] = useState(false);
    const [appliedEpoch, setAppliedEpoch] = useState(0);
    if (expandSignal.id === messageId && expandSignal.epoch > appliedEpoch) {
        setAppliedEpoch(expandSignal.epoch);
        setExpanded(true);
    }

    if (skippedMessages.length === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[85%] w-full px-4 py-3">
                <button
                    type="button"
                    onClick={() => setExpanded(e => !e)}
                    className="w-full flex items-center justify-between gap-2 text-left"
                >
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                        {skippedMessages.length} message{skippedMessages.length === 1 ? '' : 's'} skipped. Tap to review.
                    </p>
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence initial={false}>
                    {expanded && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                        >
                            {/* No scrim of its own — this panel is inline within the
                                chat, not a floating modal. It still joins the shared
                                stack so it visibly recedes once a row's manual-entry
                                form opens above it, and closing that form restores it. */}
                            <StackedPanel id={`skipped-review-${messageId}`} onClose={() => setExpanded(false)} scrim={false}>
                                <div className="glass-panel rounded-lg mt-2 px-2.5">
                                    {skippedMessages.map((entry, i) => (
                                        <SkippedRow
                                            key={`${entry.reason}-${entry.transactionCode ?? entry.rawText}-${i}`}
                                            entry={entry}
                                            transactions={transactions}
                                            onInclude={tx => onInclude(messageId, entry, tx)}
                                            onUnexclude={code => onUnexclude(messageId, code)}
                                        />
                                    ))}
                                </div>
                            </StackedPanel>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
