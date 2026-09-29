import type { ParsedTransaction, TrackedDocument } from '../../types';
import { fmtCurrency } from '../receiptGenerator';
import { isCashSale } from '../activeMode/session';
import { amountInWords } from './amountInWords';

// The sales receipt's data: everything receipt/layout.ts needs, already
// decided. Reconciliation (Phase 4) in particular is a judgement call — does
// a gap between the itemised lines and the money actually received look like
// a tip, a discount, or neither — and that judgement is made HERE, once, from
// the document's own stored tip/discount (set by a one-time prompt when the
// gap was first seen), never re-derived by a renderer.

export interface ReceiptLineRow {
    description: string;
    // "2 x Ksh 20.00", already formatted — null when there is no quantity or
    // unit price to show (an un-itemised sale, or an item priced as a whole).
    detail: string | null;
    amountLabel: string;
}

export type Reconciliation =
    | { kind: 'match' }
    | { kind: 'tip'; amountLabel: string }
    | { kind: 'discount'; amountLabel: string }
    // The items don't sum to what was received, and nothing on the document
    // says why. Printed plainly rather than hidden — see D-series honesty
    // rules elsewhere in this app about never silently absorbing a gap.
    | { kind: 'unexplained'; amountLabel: string; amount: number };

export interface ReceiptData {
    businessName: string | null;
    contact: string | null;
    servedBy: string | null;
    receiptNumber: string;
    dateLabel: string;
    timeLabel: string;
    lines: ReceiptLineRow[];
    subtotal: number;
    subtotalLabel: string;
    reconciliation: Reconciliation;
    totalLabel: string;
    total: number;
    amountWords: string;
    currency: string;
    provenanceLine: string;
    footerLine: string;
    qrFacts: string;
}

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Flattens every included transaction into printable rows: a transaction's
// own itemisation if it has one, otherwise the transaction itself as a single
// row — the same per-line shape documentLayout.ts already uses for
// point_of_sale, reused here rather than re-invented. Returns the raw amounts
// alongside the formatted rows, since callers need both the number (to sum
// for reconciliation) and the printable string (the layout never formats).
function buildLines(transactions: ParsedTransaction[], currency: string): { rows: ReceiptLineRow[]; itemsTotal: number } {
    const rows: ReceiptLineRow[] = [];
    let itemsTotal = 0;
    for (const t of transactions) {
        if (t.lineItems && t.lineItems.length > 0) {
            for (const li of t.lineItems) {
                const detail = li.quantity != null && li.unitPrice != null
                    ? `${li.quantity} x ${fmtCurrency(li.unitPrice, currency)}` : null;
                rows.push({ description: li.description, detail, amountLabel: fmtCurrency(li.amount, currency) });
                itemsTotal += li.amount;
            }
        } else {
            rows.push({ description: t.purposeLabel || t.receiptLabel || 'Sale', detail: null, amountLabel: fmtCurrency(t.amount, currency) });
            itemsTotal += t.amount;
        }
    }
    return { rows, itemsTotal: round2(itemsTotal) };
}

function computeReconciliation(
    itemsTotal: number, receivedTotal: number, tip: number | null, discount: number | null, currency: string,
): Reconciliation {
    const diff = round2(receivedTotal - itemsTotal);
    if (Math.abs(diff) < 0.01) return { kind: 'match' };
    if (tip != null && Math.abs(round2(tip) - diff) < 0.01) {
        return { kind: 'tip', amountLabel: fmtCurrency(tip, currency) };
    }
    if (discount != null && Math.abs(round2(-discount) - diff) < 0.01) {
        return { kind: 'discount', amountLabel: fmtCurrency(discount, currency) };
    }
    return { kind: 'unexplained', amountLabel: fmtCurrency(Math.abs(diff), currency), amount: diff };
}

function provenanceLine(transactions: ParsedTransaction[]): string {
    const allCash = transactions.every(isCashSale);
    const allVerified = transactions.every(t => t.dataSource === 'sms_verified');
    const allHand = transactions.every(t => t.dataSource === 'self_reported' && !isCashSale(t));

    if (allCash) return 'Cash, entered by the seller.';
    if (allVerified) return 'Verified from an M-Pesa payment message.';
    if (allHand) return 'Entered by the seller, not from a payment message.';
    return 'A mix of verified messages and amounts entered by the seller.';
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(d: Date): string {
    return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

// A compact, offline-verifiable payload — no live URL, since a scanner
// showing "yes, this reference and amount really are what the paper says"
// must work with no network at all, matching this app's own hard offline
// constraint. Pipe-delimited, not JSON: shorter, and unambiguous for the six
// fixed fields it carries.
function buildQrFacts(receiptNumber: string, businessName: string | null, total: number, currency: string, dateLabel: string): string {
    return [
        'MTRACK-RECEIPT-V1',
        receiptNumber,
        businessName ?? '',
        total.toFixed(2),
        currency,
        dateLabel,
    ].join('|');
}

export function buildReceiptData(doc: TrackedDocument): ReceiptData {
    const transactions = doc.transactions.filter(t => !t.excludedFromReceipt);
    const currency = transactions[0]?.currency ?? 'KES';
    const { rows, itemsTotal } = buildLines(transactions, currency);
    const receivedTotal = round2(transactions.reduce((s, t) => s + t.amount, 0));
    const reconciliation = computeReconciliation(itemsTotal, receivedTotal, doc.tip, doc.discount, currency);

    const dated = transactions.filter(t => t.date instanceof Date && Number.isFinite(t.date.getTime()));
    const latest = dated.length > 0 ? dated.reduce((a, b) => (a.date > b.date ? a : b)).date : new Date(doc.createdAt);

    return {
        businessName: doc.merchantProfile?.businessName || null,
        contact: doc.merchantProfile?.contact || null,
        servedBy: doc.servedBy,
        receiptNumber: doc.receiptNumber,
        dateLabel: fmtDate(latest),
        timeLabel: fmtTime(latest),
        lines: rows,
        subtotal: itemsTotal,
        subtotalLabel: fmtCurrency(itemsTotal, currency),
        reconciliation,
        totalLabel: fmtCurrency(receivedTotal, currency),
        total: receivedTotal,
        amountWords: amountInWords(receivedTotal),
        currency,
        provenanceLine: provenanceLine(transactions),
        footerLine: 'Thank you  ·  Made with M-Track',
        qrFacts: buildQrFacts(doc.receiptNumber, doc.merchantProfile?.businessName || null, receivedTotal, currency, fmtDate(latest)),
    };
}

// Whether reconciliation still needs a one-time human answer — an
// itemised/received gap with no stored tip or discount to explain it yet.
// The capture UI prompts for this once; after that, doc.tip/doc.discount
// carries the answer forever and this returns false even on the same gap.
export function needsReconciliationPrompt(doc: TrackedDocument): boolean {
    const transactions = doc.transactions.filter(t => !t.excludedFromReceipt);
    const currency = transactions[0]?.currency ?? 'KES';
    const { itemsTotal } = buildLines(transactions, currency);
    const receivedTotal = round2(transactions.reduce((s, t) => s + t.amount, 0));
    if (Math.abs(round2(receivedTotal - itemsTotal)) < 0.01) return false;
    return doc.tip == null && doc.discount == null;
}
