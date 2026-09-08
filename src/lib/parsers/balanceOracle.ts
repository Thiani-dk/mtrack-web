import type { ParsedTransaction } from './types';

// ---------------------------------------------------------------------------
// Balance reconciliation oracle.
//
// extractBalance already captures "New M-PESA balance is Ksh X" / "Avail Bal
// KES X" on most messages. Two consecutive balances on the SAME ledger are
// arithmetic proof of direction and of the amount:
//
//   delta = later.balance - earlier.balance
//   RECEIVED  <=>  delta === +later.amount
//   SENT      <=>  delta === -(later.amount + later.transactionCost)
//
// Arithmetic outranks vocabulary. A message worded in any bank's house style
// still reconciles as long as it reports a running balance.
//
// The governing rule: a FAILED reconciliation proves nothing. Gaps in a
// pasted chain (the user didn't paste every message) are normal. On failure
// the oracle stays silent — it never forces a direction.
// ---------------------------------------------------------------------------

// Two decimal places, to absorb float representation error — NOT to absorb a
// genuine mismatch.
const EPSILON = 0.01;

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The ledger a transaction's balance belongs to. Balances from different pots
// of money must NEVER be compared.
//
//  - M-PESA / Airtel Money / T-Kash are each a single wallet — key by provider
//    alone (a GlobalPay virtual-card payment still draws on, and reports, the
//    M-PESA wallet balance).
//  - A bank card reports an "available balance" that need not equal the
//    account balance on a non-card message, so each (provider + card) is its
//    own ledger.
//  - Everything else on a named provider is that provider's account ledger.
//  - `provider === 'Unknown'` and no card => no identifiable ledger => the
//    transaction sits alone and gets no reconciliation.
//
// Note on interleaved wallets (two phones in one SMS-backup export, same
// provider): they would share a key, but the EXACT-match requirement below is
// the safety net — adjacent transactions from two different wallets almost
// never produce a delta that exactly equals one side's amount(+fee).
export function ledgerKey(t: ParsedTransaction): string | null {
    const provider = t.provider || 'Unknown';
    if (provider === 'M-PESA' || provider === 'Airtel Money' || provider === 'T-Kash') {
        return `wallet:${provider}`;
    }
    if (provider === 'Unknown') {
        return t.cardLast4 ? `card:Unknown:${t.cardLast4}` : null;
    }
    if (t.cardLast4) return `card:${provider}:${t.cardLast4}`;
    return `account:${provider}`;
}

export interface OracleVerdict {
    // transactionCode -> direction the arithmetic proves
    provenDirection: Map<string, 'sent' | 'received'>;
    // transactionCodes whose amount is confirmed correct by a reconciled pair
    amountVerified: Set<string>;
    // transactionCodes where both balances exist, neither hypothesis matches,
    // and the unexplained delta is close enough to the amount to look like a
    // wrong pick rather than a multi-message gap
    balanceMismatch: Set<string>;
}

// Is `delta` "close enough" to the expected move that a mismatch looks like a
// wrong-amount pick rather than a gap of several untracked transactions?
// Requires a whole-shilling figure within ~3x of the expected magnitude.
function looksLikeWrongAmount(delta: number, expectedMagnitude: number): boolean {
    const mag = Math.abs(delta);
    if (mag < 1) return false;
    if (Math.abs(mag - Math.round(mag)) > EPSILON) return false; // not whole shillings
    return mag <= expectedMagnitude * 3 + 1;
}

export function reconcileLedgers(transactions: ParsedTransaction[]): OracleVerdict {
    const provenDirection = new Map<string, 'sent' | 'received'>();
    const amountVerified = new Set<string>();
    const balanceMismatch = new Set<string>();

    const ledgers = new Map<string, ParsedTransaction[]>();
    for (const t of transactions) {
        const key = ledgerKey(t);
        if (key == null) continue;
        const bucket = ledgers.get(key);
        if (bucket) bucket.push(t);
        else ledgers.set(key, [t]);
    }

    for (const group of ledgers.values()) {
        if (group.length < 2) continue; // 1.4 — a single message proves nothing
        const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());

        for (let i = 1; i < sorted.length; i++) {
            const earlier = sorted[i - 1];
            const later = sorted[i];
            if (earlier.balance == null || later.balance == null) continue;

            const delta = round2(later.balance - earlier.balance);
            const fee = later.transactionCost ?? 0;
            const receivedMatch = Math.abs(delta - later.amount) < EPSILON;
            const sentMatch = Math.abs(delta - -(later.amount + fee)) < EPSILON;

            if (receivedMatch && sentMatch) {
                // Only possible when amount === 0 and fee === 0. Conclude nothing.
                continue;
            }
            if (receivedMatch) {
                provenDirection.set(later.transactionCode, 'received');
                amountVerified.add(later.transactionCode);
            } else if (sentMatch) {
                provenDirection.set(later.transactionCode, 'sent');
                amountVerified.add(later.transactionCode);
            } else {
                // Neither matches: a gap in the pasted chain OR a wrong amount.
                // Prove nothing about direction. Flag a possible wrong amount
                // only when the unexplained move looks like a single payment.
                if (looksLikeWrongAmount(delta, later.amount + fee)) {
                    balanceMismatch.add(later.transactionCode);
                }
            }
        }
    }

    return { provenDirection, amountVerified, balanceMismatch };
}

// Applies the verdict to the transaction list. Where a direction is proven the
// oracle overrides whatever the keyword/structural layer decided (arithmetic
// wins) and records directionSource: 'balance'. subType is NOT re-derived here
// — the caller does that, where deriveSubType is in scope.
export function applyBalanceOracle(transactions: ParsedTransaction[]): ParsedTransaction[] {
    const verdict = reconcileLedgers(transactions);
    if (
        verdict.provenDirection.size === 0 &&
        verdict.amountVerified.size === 0 &&
        verdict.balanceMismatch.size === 0
    ) {
        return transactions;
    }

    return transactions.map(t => {
        const proven = verdict.provenDirection.get(t.transactionCode);
        const verified = verdict.amountVerified.has(t.transactionCode);
        const mismatch = verdict.balanceMismatch.has(t.transactionCode);
        if (!proven && !verified && !mismatch) return t;

        return {
            ...t,
            type: proven ?? t.type,
            directionSource: proven ? ('balance' as const) : t.directionSource,
            amountVerified: verified || t.amountVerified,
            balanceMismatch: mismatch || t.balanceMismatch,
        };
    });
}
