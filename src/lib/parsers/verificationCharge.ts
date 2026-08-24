import type { ParsedTransaction } from './types';

// A GlobalPay virtual-card top-up/registration often fires a tiny sent+
// received pair (Safaricom charging then immediately refunding a nominal
// amount to confirm the card works) a few minutes apart. These are noise
// for spending totals and insights — not something the user "spent".
const MAX_AMOUNT = 5;
const WINDOW_MS = 5 * 60 * 1000;
const HINT_RE = /GlobalPay|Virtual/i;

function mentionsHint(t: ParsedTransaction): boolean {
    return HINT_RE.test(t.rawLine) || (t.merchant != null && HINT_RE.test(t.merchant));
}

export function isVerificationCharge(transaction: ParsedTransaction, allTransactions: ParsedTransaction[]): boolean {
    if (transaction.amount > MAX_AMOUNT) return false;

    return allTransactions.some(other => {
        if (other === transaction) return false;
        if (other.amount !== transaction.amount) return false;
        if (other.type === transaction.type) return false;
        const diff = Math.abs(other.date.getTime() - transaction.date.getTime());
        if (diff > WINDOW_MS) return false;
        return mentionsHint(transaction) || mentionsHint(other);
    });
}

// Marks every matching pair with isVerificationCharge: true on both sides.
export function applyVerificationChargeDetection(transactions: ParsedTransaction[]): ParsedTransaction[] {
    return transactions.map(t => ({
        ...t,
        isVerificationCharge: isVerificationCharge(t, transactions),
    }));
}
