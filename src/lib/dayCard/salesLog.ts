import type { ParsedTransaction } from '../../types';
import { bucketOf } from '../activeMode/session';

// Reshapes a day's sales for the existing document pipeline (buildDocModel /
// generateReceiptPDF / generateReceiptHTML) to produce a secondary "sales
// log" export — one line per sale, its bucket and time in place of a
// customer's name. getRecipientShort() reads `merchant` ahead of `recipient`
// (see receiptGenerator.ts), so overriding `merchant` here is enough to keep
// every customer's name out of the printed line: nothing else the pipeline
// prints per line reads a name at all (see buildLine in documentLayout.ts).
// `recipient` is blanked too, defensively, since this reshaped array only
// ever feeds this one export and nothing depends on it surviving intact.
export function salesLogTransactions(transactions: ParsedTransaction[]): ParsedTransaction[] {
    return transactions.map(t => ({
        ...t,
        merchant: t.time ? `${bucketOf(t)} · ${t.time}` : bucketOf(t),
        recipient: '',
    }));
}
