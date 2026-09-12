import type { ActiveModeState, ParsedTransaction } from '../../types';
import { parseAllMessages } from '../parsers';
import { detectNearDuplicates, type NearDuplicatePair } from '../parsers/nearDuplicates';
import { extractDescription, buildSelfReportedTransaction } from '../conversationalCapture';
import { parseAmountAnswer } from '../parsers/extractors/numeric';
import { applyActiveModeDirectionAll } from './direction';

// The logic behind Active Mode, with no React in it.
//
// Active Mode is a different interaction model from the rest of the app: no
// conversation, no follow-up questions, two actions per sale (paste, tap a
// bucket). Everything here exists to make those two actions cheap and to make
// sure nothing a vendor pasted can go missing between them.
//
// Parsing is NOT forked: a pasted message goes through parseAllMessages, the
// same SMS pipeline everything else uses, and typed text goes through
// extractDescription. The only Active-Mode-specific step is the direction
// default (see direction.ts), applied after the pipeline has had its say.

// The bucket that always exists, cannot be renamed or deleted, and catches
// anything not actively filed. A vendor too slammed to categorise a sale must
// still end the day with that sale counted.
export const UNSORTED = 'Unsorted';

// Bucket names live in display order with Unsorted first, and are stored on
// the document (see ActiveModeState in types) because an empty bucket has no
// transaction to infer it from — a vendor who sets up three buckets before the
// rush must still find them after a reload.
export type { ActiveModeState };

export function emptyActiveModeState(): ActiveModeState {
    return { buckets: [UNSORTED], pending: null };
}

// Tolerates a document stored before a field existed, or one from another flow.
// Dates come back from IndexedDB as Dates already, but a JSON round-trip or an
// older record can leave a string, so the pending capture's date is rebuilt the
// same way useDocumentStore rebuilds the transactions'.
export function readActiveModeState(state: Partial<ActiveModeState> | null | undefined): ActiveModeState {
    const pending = state?.pending ?? null;
    return {
        buckets: normaliseBuckets(state?.buckets ?? []),
        pending: pending ? { ...pending, date: new Date(pending.date) } : null,
    };
}

function normaliseBuckets(names: string[]): string[] {
    const out = [UNSORTED];
    for (const raw of names) {
        const name = raw.trim();
        if (!name || isUnsorted(name)) continue;
        if (!out.some(b => b.toLowerCase() === name.toLowerCase())) out.push(name);
    }
    return out;
}

export function isUnsorted(name: string): boolean {
    return name.trim().toLowerCase() === UNSORTED.toLowerCase();
}

export type BucketError = 'empty' | 'duplicate' | 'reserved';

// Adds a bucket, or explains why it could not. Names are compared
// case-insensitively so "combo sales" doesn't quietly become a second
// "Combo sales" that splits the day's takings in two.
export function addBucket(state: ActiveModeState, rawName: string): { state: ActiveModeState; error: BucketError | null } {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) return { state, error: 'empty' };
    if (isUnsorted(name)) return { state, error: 'reserved' };
    if (state.buckets.some(b => b.toLowerCase() === name.toLowerCase())) return { state, error: 'duplicate' };
    return { state: { ...state, buckets: [...state.buckets, name] }, error: null };
}

// Renames a bucket, moving every sale filed under the old name with it. The
// subtotal and count are a function of the transactions, so carrying the label
// across is all it takes for them to follow.
//
// Unsorted is not renameable: it is the catch-all the auto-file behaviour and
// the delete below both depend on, and a renamed one would leave sales with
// nowhere to land.
export function renameBucket(
    state: ActiveModeState, transactions: ParsedTransaction[], from: string, rawTo: string,
): { state: ActiveModeState; transactions: ParsedTransaction[]; error: BucketError | null } {
    const to = rawTo.trim().replace(/\s+/g, ' ');
    const unchanged = { state, transactions };
    if (isUnsorted(from)) return { ...unchanged, error: 'reserved' };
    if (!to) return { ...unchanged, error: 'empty' };
    if (isUnsorted(to)) return { ...unchanged, error: 'reserved' };
    // Renaming to the same words with different capitalisation is a legitimate
    // tidy-up, so only a DIFFERENT existing bucket counts as a collision.
    if (state.buckets.some(b => b.toLowerCase() === to.toLowerCase() && b !== from)) {
        return { ...unchanged, error: 'duplicate' };
    }
    if (!state.buckets.includes(from)) return { ...unchanged, error: 'empty' };

    return {
        state: { ...state, buckets: state.buckets.map(b => (b === from ? to : b)) },
        transactions: transactions.map(t => (bucketOf(t) === from ? { ...t, bucketLabel: to } : t)),
        error: null,
    };
}

// Removes a bucket. Its sales are NOT removed with it — they move to Unsorted,
// the same place an unfiled capture goes. Deleting a category is a change of
// mind about how the day was organised, never a decision to throw away money
// that was actually taken.
export function deleteBucket(
    state: ActiveModeState, transactions: ParsedTransaction[], name: string,
): { state: ActiveModeState; transactions: ParsedTransaction[]; moved: number } {
    if (isUnsorted(name) || !state.buckets.includes(name)) {
        return { state, transactions, moved: 0 };
    }
    const affected = transactions.filter(t => bucketOf(t) === name);
    return {
        state: { ...state, buckets: state.buckets.filter(b => b !== name) },
        transactions: transactions.map(t => (bucketOf(t) === name ? fileInto(t, UNSORTED) : t)),
        moved: affected.length,
    };
}

// How many sales a delete would move — what the confirmation has to state, and
// zero for a bucket that can just go.
export function bucketSaleCount(transactions: ParsedTransaction[], name: string): number {
    return transactions.filter(t => bucketOf(t) === name).length;
}

export interface BucketTally {
    name: string;
    total: number;
    count: number;
    currency: string;
}

// Every bucket's running subtotal and count. Buckets with no sales yet are
// still listed — the chip row is how a vendor files, so it cannot only show
// buckets that already have something in them.
export function bucketTallies(state: ActiveModeState, transactions: ParsedTransaction[]): BucketTally[] {
    return state.buckets.map(name => {
        const mine = transactions.filter(t => bucketOf(t) === name);
        return {
            name,
            count: mine.length,
            total: round2(mine.reduce((sum, t) => sum + t.amount, 0)),
            currency: mine[0]?.currency ?? 'KES',
        };
    });
}

// Anything unlabelled, or labelled with a bucket since removed, counts as
// Unsorted rather than disappearing from the tallies.
export function bucketOf(t: ParsedTransaction): string {
    const label = t.bucketLabel?.trim();
    return label ? label : UNSORTED;
}

export function dayTotal(transactions: ParsedTransaction[]): number {
    return round2(transactions.reduce((sum, t) => sum + t.amount, 0));
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function fileInto(t: ParsedTransaction, bucket: string): ParsedTransaction {
    return { ...t, bucketLabel: isUnsorted(bucket) ? null : bucket.trim() };
}

// ── Capture ──────────────────────────────────────────────────────────────────

export interface CaptureResult {
    transaction: ParsedTransaction | null;
    // Why nothing was captured, for a one-line inline hint. Never a dialog.
    error: 'empty' | 'unreadable' | 'no-amount' | null;
}

// A pasted M-Pesa message. Runs the ordinary SMS pipeline, then applies the
// Active Mode direction default to whatever it could not resolve.
export function captureFromPaste(text: string): CaptureResult {
    if (!text.trim()) return { transaction: null, error: 'empty' };
    const parsed = parseAllMessages(text).transactions;
    if (parsed.length === 0) return { transaction: null, error: 'unreadable' };
    // A paste of several messages at once files the first and is rare; the
    // screen is built around one sale at a time.
    const [t] = applyActiveModeDirectionAll(parsed);
    return { transaction: t, error: null };
}

// Typed shorthand ("combo 350"). Uses the same conversational extraction the
// chat uses — but asks nothing, because asking is the thing Active Mode
// exists to avoid. Without an amount there is nothing to record, so that is
// the one case it declines.
export function captureFromTyped(text: string, now: Date = new Date()): CaptureResult {
    if (!text.trim()) return { transaction: null, error: 'empty' };
    const r = extractDescription(text, now);

    // In free text the extractors require a currency token before they will
    // call a number an amount — rightly, since a bare number in a sentence is
    // usually something else. Here the screen supplies that context: a vendor
    // typing "combo 350" into a sale-capture field means 350. Same reasoning
    // as answering "how much was it?" with a bare figure.
    const amount = r.amount ?? parseAmountAnswer(text);
    if (amount == null || amount <= 0) return { transaction: null, error: 'no-amount' };

    const transaction = buildSelfReportedTransaction({
        amount,
        currency: r.currency,
        recipient: r.recipient ?? describeTyped(text) ?? 'Sale',
        date: r.date ?? now,
        purposeLabel: r.purposeLabel,
        lineItems: r.itemisation?.items ?? null,
        // Everything captured here is a sale. A typed line carries no message
        // for the oracle to read, so the direction comes from the mode — and
        // is marked as assumed, exactly as a pasted unresolvable one is.
        direction: r.direction.source !== 'unresolved'
            ? r.direction
            : { type: 'received', confidence: 60, source: 'unresolved' },
    });

    return {
        transaction: r.direction.source !== 'unresolved'
            ? transaction
            : { ...transaction, directionAssumed: true, directionUnresolved: false },
        error: null,
    };
}

// The words either side of the figure in a typed line — "combo 350" is a
// combo. Falls back to null when nothing is left but the number.
function describeTyped(text: string): string | null {
    const words = text.replace(/[\d.,]+\s*(k|m)?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return words.length >= 2 ? words.slice(0, 60) : null;
}

// A paste is a message; anything else is typed shorthand. The distinction is
// the one the SMS parser itself makes, so a vendor never picks a mode.
export function capture(text: string, now: Date = new Date()): CaptureResult {
    const pasted = captureFromPaste(text);
    if (pasted.transaction) return pasted;
    return captureFromTyped(text, now);
}

// ── Duplicate warning ────────────────────────────────────────────────────────

export interface DuplicateWarning {
    kind: 'exact' | 'near';
    // 1-based position of the sale it looks like, for "the same as sale #14".
    saleNumber: number;
    existing: ParsedTransaction;
    minutesApart: number;
}

// Whether a fresh capture looks like something already in this session.
//
// Reuses detectNearDuplicates rather than reimplementing it: the candidate is
// appended to the session's transactions and only the pairs involving it are
// kept. An exact duplicate — the same transaction code — is checked first,
// since that one is certain rather than a judgement call.
//
// Non-blocking by design. It returns a warning; it never refuses the capture.
// Double-counting a day's revenue is bad, and so is a modal in front of a
// vendor with a queue.
export function findDuplicate(
    candidate: ParsedTransaction, existing: ParsedTransaction[],
): DuplicateWarning | null {
    if (!candidate.codeIsSynthetic) {
        const i = existing.findIndex(t => !t.codeIsSynthetic && t.transactionCode === candidate.transactionCode);
        if (i >= 0) {
            return {
                kind: 'exact', saleNumber: i + 1, existing: existing[i],
                minutesApart: minutesBetween(existing[i], candidate),
            };
        }
    }

    const pairs: NearDuplicatePair[] = detectNearDuplicates([...existing, candidate]);
    for (const pair of pairs) {
        const counterpart = pair.larger === candidate ? pair.smaller
            : pair.smaller === candidate ? pair.larger
            : null;
        if (!counterpart) continue;
        const i = existing.indexOf(counterpart);
        if (i < 0) continue;
        return { kind: 'near', saleNumber: i + 1, existing: counterpart, minutesApart: pair.minutesApart };
    }
    return null;
}

function minutesBetween(a: ParsedTransaction, b: ParsedTransaction): number {
    return Math.round(Math.abs(a.date.getTime() - b.date.getTime()) / 60000);
}
