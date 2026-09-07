import type { DataSource, ParsedTransaction, TrackedDocument } from '../types';

// The set a document's computed fields are derived from: every transaction the
// user hasn't toggled out. Excluded transactions never contribute to the
// document-level data source or the covering dates.
export function includedTransactions(transactions: ParsedTransaction[]): ParsedTransaction[] {
    return transactions.filter(t => !t.excludedFromReceipt);
}

// A usable timestamp for `t`, or null. Handles a `date` that has been
// serialised to a string by IndexedDB and not yet rehydrated.
function usableTime(t: ParsedTransaction): number | null {
    const ms = t.date instanceof Date ? t.date.getTime() : new Date(t.date).getTime();
    return Number.isNaN(ms) ? null : ms;
}

// Document-level provenance. Computed from the included transactions, never
// stored on its own:
//   every included transaction sms_verified  -> 'sms_verified'
//   every included transaction self_reported -> 'self_reported'
//   any mix (or an empty set)                -> caller's baseline
// An empty included set has no provenance of its own, so it reports
// 'sms_verified' — the state that carries no hand-entry disclaimer.
export function computeDataSource(transactions: ParsedTransaction[]): DataSource {
    const included = includedTransactions(transactions);
    if (included.length === 0) return 'sms_verified';

    let sawVerified = false;
    let sawSelfReported = false;
    for (const t of included) {
        if (t.dataSource === 'self_reported') sawSelfReported = true;
        else sawVerified = true;
    }
    if (sawVerified && sawSelfReported) return 'mixed';
    return sawSelfReported ? 'self_reported' : 'sms_verified';
}

// Min and max transaction date across the included transactions, as epoch ms.
// Both null when no included transaction has a usable date. Never derived from
// a relative range the user asked for — only from the transactions themselves.
export function computeCoveringDates(
    transactions: ParsedTransaction[]
): { coveringFrom: number | null; coveringTo: number | null } {
    let from: number | null = null;
    let to: number | null = null;
    for (const t of includedTransactions(transactions)) {
        const ms = usableTime(t);
        if (ms === null) continue;
        if (from === null || ms < from) from = ms;
        if (to === null || ms > to) to = ms;
    }
    return { coveringFrom: from, coveringTo: to };
}

// Recomputes every derived field on a document from its current transaction
// set and stamps `updatedAt`. The single place document invariants are
// enforced — callers mutate `transactions` then run this.
export function reconcileDocument(doc: TrackedDocument, now: number = Date.now()): TrackedDocument {
    const { coveringFrom, coveringTo } = computeCoveringDates(doc.transactions);
    return {
        ...doc,
        dataSource: computeDataSource(doc.transactions),
        coveringFrom,
        coveringTo,
        updatedAt: now,
    };
}
