import type { DataSource, DocumentType, MerchantProfile, OnBehalfOfContext, ParsedTransaction } from '../types';
import type { ReceiptData } from './receiptGenerator';

// Everything the four document layouts need beyond the shared computeReceiptData
// math. One module so the chat preview, the HTML file and the PDF all derive
// the same strings and totals — no surface computes its own.

export interface DocRenderMeta {
    documentType: DocumentType;
    coveringFrom: number | null;
    coveringTo: number | null;
    dataSource: DataSource;
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
}

function fmtDay(ms: number): string {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// E1 — the actual span the document covers, never a relative range.
//   both null            -> ""     (field is left blank; a wrong date is worse)
//   same calendar day    -> "16 Aug 2026"
//   otherwise            -> "16 Aug – 23 Aug 2026"
export function formatCovering(from: number | null, to: number | null): string {
    if (from == null || to == null) return '';
    const a = new Date(from);
    const b = new Date(to);
    const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay) return fmtDay(from);
    const aShort = a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${aShort} – ${fmtDay(to)}`;
}

export function issuedDate(now: Date = new Date()): string {
    return now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// E3 — the base "not a tax invoice" disclaimer, per type.
export function baseDisclaimerLines(documentType: DocumentType): string[] {
    switch (documentType) {
        case 'personal_note':
            return ['Not a tax invoice. Entered by hand, not matched to a payment message.'];
        case 'point_of_sale':
            return ['Not a tax invoice. For record-keeping only.'];
        case 'on_behalf_of':
            return ['Not a tax invoice. A reimbursement claim, for record-keeping only.'];
        case 'expense_summary':
        default:
            return ['Not a tax invoice. For record-keeping only.'];
    }
}

// E2 — the extra line carried by any document with hand-entered detail a
// third party might rely on.
export function trustDisclaimerLine(dataSource: DataSource, documentType: DocumentType): string | null {
    if (documentType === 'expense_summary') return null; // reader is the author
    if (dataSource === 'self_reported' || dataSource === 'mixed') {
        return "Some details were entered by hand and aren't matched to a payment message.";
    }
    return null;
}

// E2 — whether an individual line should carry a "self-reported" tag. Only on
// documents someone other than the author reads.
export function lineShowsSelfReportedTag(t: ParsedTransaction, documentType: DocumentType): boolean {
    return (documentType === 'point_of_sale' || documentType === 'on_behalf_of')
        && t.dataSource === 'self_reported';
}

// E3 on_behalf_of — the explicit totals block. Transaction costs are part of
// the sum: the errand runner paid them out of pocket and gets them back.
export interface ClaimTotals {
    itemCount: number;
    subtotal: number;
    transactionCosts: number;
    totalDue: number;
}

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function claimTotals(data: ReceiptData): ClaimTotals {
    const subtotal = round2(data.totalTransactionAmount);
    const transactionCosts = round2(data.totalTransactionCost);
    return {
        itemCount: data.totalTransactionCount,
        subtotal,
        transactionCosts,
        totalDue: round2(subtotal + transactionCosts),
    };
}

// E3 point_of_sale — a gentle preview-only flag when a line's items don't add
// up to its total. Never blocks approval.
export function lineItemMismatch(t: ParsedTransaction): { itemsTotal: number; lineTotal: number } | null {
    if (!t.lineItems || t.lineItems.length === 0) return null;
    const itemsTotal = round2(t.lineItems.reduce((s, li) => s + li.amount, 0));
    const lineTotal = round2(t.amount);
    return itemsTotal === lineTotal ? null : { itemsTotal, lineTotal };
}

export function anyLineItemMismatch(transactions: ParsedTransaction[]): boolean {
    return transactions.some(t => !t.excludedFromReceipt && lineItemMismatch(t) !== null);
}
