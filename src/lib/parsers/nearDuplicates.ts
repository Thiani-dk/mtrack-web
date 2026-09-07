import type { ParsedTransaction } from './types';
import { normalizeParty } from './linkTransactions';

// Two transactions to the same party, minutes apart, with either the same
// amount or one tiny amount alongside a real one — the shape of a card-check
// charge sitting next to the payment it was checking, or the same payment
// entered twice from two channels. NOT a duplicate paste (those share a
// transaction code and are handled by dedup) and NOT a linked pair (those also
// share a code and are merged by linkTransactions). This is a genuine
// judgement call, so it is only ever surfaced as a question.

const WINDOW_MS = 15 * 60 * 1000;
const SMALL_AMOUNT = 5;

export interface NearDuplicatePair {
    larger: ParsedTransaction;
    smaller: ParsedTransaction;
    minutesApart: number;
    // true when one side is under Ksh 5 and the other is not — the
    // "looks like a card check" case, as opposed to two equal amounts.
    smallOneIsTrivial: boolean;
}

function partyKey(t: ParsedTransaction): string {
    return normalizeParty(t.merchant ?? t.recipient);
}

export function detectNearDuplicates(transactions: ParsedTransaction[]): NearDuplicatePair[] {
    const pairs: NearDuplicatePair[] = [];

    for (let i = 0; i < transactions.length; i++) {
        for (let j = i + 1; j < transactions.length; j++) {
            const a = transactions[i];
            const b = transactions[j];

            if (a.transactionCode === b.transactionCode) continue;

            const key = partyKey(a);
            if (!key || key !== partyKey(b)) continue;

            const gap = Math.abs(a.date.getTime() - b.date.getTime());
            if (gap > WINDOW_MS) continue;

            const sameAmount = a.amount === b.amount;
            const oneTrivial = (a.amount < SMALL_AMOUNT) !== (b.amount < SMALL_AMOUNT);
            if (!sameAmount && !oneTrivial) continue;

            const [larger, smaller] = a.amount >= b.amount ? [a, b] : [b, a];
            pairs.push({
                larger,
                smaller,
                minutesApart: Math.round(gap / 60000),
                smallOneIsTrivial: oneTrivial,
            });
        }
    }

    return pairs;
}
