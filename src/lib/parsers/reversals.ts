import type { ParsedTransaction } from './types';

// A payment and its reversal: the money went out and then came straight back.
// Including both double-counts; including only one misrepresents what happened.
// So both are excluded by default and the pair is surfaced for the user to
// add back if they want it shown.
export interface ReversalPair {
    original: ParsedTransaction;
    reversal: ParsedTransaction;
}

// Finds every reversal whose original is also present in the batch, marks both
// sides isReversed + excludedFromReceipt, and returns the matched pairs.
// Mutates nothing — returns a new array with patched copies.
export function applyReversalPairs(transactions: ParsedTransaction[]): {
    transactions: ParsedTransaction[];
    pairs: ReversalPair[];
} {
    const byCode = new Map<string, ParsedTransaction>();
    for (const t of transactions) byCode.set(t.transactionCode, t);

    const reversedCodes = new Set<string>();
    const pairs: { originalCode: string; reversalCode: string }[] = [];

    for (const t of transactions) {
        if (!t.reversalOf) continue;
        const original = byCode.get(t.reversalOf);
        if (!original) continue;
        reversedCodes.add(original.transactionCode);
        reversedCodes.add(t.transactionCode);
        pairs.push({ originalCode: original.transactionCode, reversalCode: t.transactionCode });
    }

    const patched = transactions.map(t =>
        reversedCodes.has(t.transactionCode)
            ? { ...t, isReversed: true, excludedFromReceipt: true }
            : t
    );
    const patchedByCode = new Map(patched.map(t => [t.transactionCode, t]));

    return {
        transactions: patched,
        pairs: pairs.map(p => ({
            original: patchedByCode.get(p.originalCode)!,
            reversal: patchedByCode.get(p.reversalCode)!,
        })),
    };
}
