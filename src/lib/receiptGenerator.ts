import type { ParsedTransaction } from '../types';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { detectRecurring, type RecurringPattern } from './insights/recurring';
import {
    type DocRenderMeta, formatCovering, issuedDate, baseDisclaimerLines,
    trustDisclaimerLine, lineShowsSelfReportedTag, claimTotals, lineItemMismatch,
} from './documentRender';
import { getUncertaintyNote } from './transactionDisplay';

export type { DocRenderMeta };

const QR_TARGET_URL = 'https://mtrack.vercel.app';

function buildQRDataUrl(): Promise<string> {
    return QRCode.toDataURL(QR_TARGET_URL, { margin: 1, width: 200 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function group(n: number): string {
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmt(n: number): string {
    return 'Ksh ' + group(n);
}

// Currency-aware amount. KES / KSH keep the familiar "Ksh" prefix; any other
// currency prints its ISO code so a mixed-currency document is never
// ambiguous.
export function fmtCurrency(n: number, currency: string | null | undefined): string {
    const c = (currency ?? 'KES').toUpperCase();
    if (c === 'KES' || c === 'KSH') return 'Ksh ' + group(n);
    return `${c} ${group(n)}`;
}

function fmtSigned(n: number): string {
    return (n >= 0 ? '+' : '-') + fmt(Math.abs(n));
}

function repeat(ch: string, n: number): string { return ch.repeat(n); }

function center(text: string, W: number): string {
    const pad = Math.max(0, Math.floor((W - text.length) / 2));
    return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, W: number): string {
    const gap = Math.max(1, W - left.length - right.length);
    return left + ' '.repeat(gap) + right;
}

// Truncate a string to maxLen, adding … if trimmed
function trunc(s: string, maxLen: number): string {
    return s.length <= maxLen ? s : s.substring(0, maxLen - 1) + '…';
}

// Security code: first 6 chars of a djb2 hash of the receipt ref
// Appears at top-left AND bottom-right — Costco pattern
function securityCode(ref: string): string {
    let h = 5381;
    for (let i = 0; i < ref.length; i++) {
        h = ((h << 5) + h) ^ ref.charCodeAt(i);
        h = h >>> 0;
    }
    return h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function generateReceiptRef(): string {
    const n = new Date();
    return `MT${String(n.getFullYear()).slice(2)}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}-${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;
}

export function getRecipientShort(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'airtime':        return 'AIRTIME';
        case 'data':           return 'DATA BUNDLE';
        case 'mshwari':        return 'M-SHWARI';
        case 'investment':     return 'ZIIDI MMF';
        case 'withdrawal':     return 'CASH WITHDRAWAL';
        default:               return (t.merchant ?? t.recipient).toUpperCase();
    }
}

// Category grouping key — receiptLabel first, falling back to the parser's
// own merchantCategory, then "Unlabelled". Shared by computeReceiptData's
// category summary and the interactive chat receipt's category drilldown so
// both agree on which transactions belong to which category.
export function categoryKeyFor(t: ParsedTransaction): string {
    return t.receiptLabel
        ? t.receiptLabel.toUpperCase()
        : t.merchantCategory
        ? t.merchantCategory.toUpperCase()
        : 'Unlabelled';
}

// Short provider tag shown next to the name when the channel isn't M-PESA —
// e.g. "NETFLIX  ·  Card" for a Co-op card alert.
export function getProviderSuffix(t: ParsedTransaction): string | null {
    if (t.method === 'card') return 'Card';
    if (t.provider === 'M-PESA' || t.provider === 'Unknown') return null;
    if (t.provider === 'Co-operative Bank') return 'Co-op';
    return t.provider;
}

// ── Shared computation ────────────────────────────────────────────────────────

export interface ReceiptData {
    currentDate: string;
    currentTime: string;
    receiptRef: string;
    secCode: string;
    totalSent: number;
    totalReceived: number;
    personSendTotal: number;
    pochiTotal: number;
    paybillTotal: number;
    airtimeTotal: number;
    dataTotal: number;
    withdrawalTotal: number;
    mshwariTotal: number;
    investmentTotal: number;
    trueOutflow: number;
    net: number;
    totalFees: number;
    feesBreakdown: { label: string; count: number; total: number }[];
    labelTotals: Record<string, number>;
    labelCounts: Record<string, number>;
    hasLabels: boolean;
    recurringPatterns: RecurringPattern[];
    activeTransactions: ParsedTransaction[];
    totalTransactionCount: number;
    totalTransactionAmount: number;
    totalTransactionCost: number;
    grandTotal: number;
    // Multi-currency: distinct currencies among the included transactions, and
    // a per-currency subtotal for each. When more than one currency is
    // present, callers must show perCurrency rather than the single
    // grandTotal, which would be a meaningless mix.
    distinctCurrencies: string[];
    isMultiCurrency: boolean;
    perCurrency: { currency: string; count: number; amount: number; cost: number; total: number }[];
}

// Round to 2dp before summing/comparing so displayed totals never drift from
// their component parts (e.g. grandTotal !== amount + cost by a cent).
function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeReceiptData(transactions: ParsedTransaction[]): ReceiptData {
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const receiptRef  = generateReceiptRef();
    const secCode     = securityCode(receiptRef);

    // Only include transactions the user hasn't removed
    const activeTransactions = transactions.filter(t => !t.excludedFromReceipt);

    const sum = (fn: (t: ParsedTransaction) => boolean) =>
        activeTransactions.filter(fn).reduce((s, t) => s + t.amount, 0);

    const totalSent       = sum(t => t.type === 'sent');
    const totalReceived   = sum(t => t.type === 'received');
    const mshwariTotal    = sum(t => t.subType === 'mshwari');
    const investmentTotal = sum(t => t.subType === 'investment');
    const withdrawalTotal = sum(t => t.subType === 'withdrawal');
    const paybillTotal    = sum(t => t.subType === 'paybill');
    const airtimeTotal    = sum(t => t.subType === 'airtime');
    const dataTotal       = sum(t => t.subType === 'data');
    const personSendTotal = sum(t => t.subType === 'person_send');
    const pochiTotal      = sum(t => t.subType === 'pochi_send');
    const trueOutflow     = totalSent - mshwariTotal - investmentTotal;
    const net             = totalReceived - trueOutflow;

    // Transaction fees — parsed directly from SMS
    const totalFees = activeTransactions.reduce((s, t) => s + (t.transactionCost ?? 0), 0);

    // Fee breakdown by subtype
    const feeGroups: Record<string, { count: number; total: number }> = {};
    activeTransactions.forEach(t => {
        if ((t.transactionCost ?? 0) > 0) {
            const key = t.subType === 'person_send' ? 'Send Money'
                      : t.subType === 'pochi_send'  ? 'Pochi la Biashara'
                      : t.subType === 'paybill'     ? 'Paybill / Till'
                      : t.subType === 'withdrawal'  ? 'Withdrawal'
                      : t.subType === 'airtime'     ? 'Airtime'
                      : 'Other';
            if (!feeGroups[key]) feeGroups[key] = { count: 0, total: 0 };
            feeGroups[key].count++;
            feeGroups[key].total += t.transactionCost!;
        }
    });
    const feesBreakdown = Object.entries(feeGroups).map(([label, v]) => ({ label, ...v }));

    // Category summary — grouped by receiptLabel, falling back to the
    // parser's own merchantCategory before landing in "Unlabelled"
    const labelTotals: Record<string, number> = {};
    const labelCounts: Record<string, number> = {};
    activeTransactions.forEach(t => {
        const key = categoryKeyFor(t);
        labelTotals[key] = (labelTotals[key] ?? 0) + t.amount;
        labelCounts[key] = (labelCounts[key] ?? 0) + 1;
    });
    const hasLabels = activeTransactions.some(t => t.receiptLabel != null);

    // Only surface patterns confident enough to print without caveats.
    const recurringPatterns = detectRecurring(activeTransactions).filter(p => p.confidence >= 60);

    // TALLY — final summary-of-summaries, grand total of everything counted.
    const totalTransactionCount  = activeTransactions.length;
    const totalTransactionAmount = round2(activeTransactions.reduce((s, t) => s + Math.abs(t.amount), 0));
    const totalTransactionCost   = round2(activeTransactions.reduce((s, t) => s + (t.transactionCost ?? 0), 0));
    const grandTotal             = round2(totalTransactionAmount + totalTransactionCost);

    // Per-currency breakdown. A document must never sum two currencies into one
    // figure — when there is more than one, callers show these instead.
    const currencyOf = (t: ParsedTransaction) => (t.currency || 'KES').toUpperCase();
    const distinctCurrencies = [...new Set(activeTransactions.map(currencyOf))];
    const perCurrency = distinctCurrencies.map(currency => {
        const rows = activeTransactions.filter(t => currencyOf(t) === currency);
        const amount = round2(rows.reduce((s, t) => s + Math.abs(t.amount), 0));
        const cost = round2(rows.reduce((s, t) => s + (t.transactionCost ?? 0), 0));
        return { currency, count: rows.length, amount, cost, total: round2(amount + cost) };
    });
    const isMultiCurrency = distinctCurrencies.length > 1;

    return {
        currentDate, currentTime, receiptRef, secCode,
        totalSent, totalReceived, personSendTotal, pochiTotal,
        paybillTotal, airtimeTotal, dataTotal, withdrawalTotal,
        mshwariTotal, investmentTotal, trueOutflow, net,
        totalFees, feesBreakdown, labelTotals, labelCounts, hasLabels,
        recurringPatterns,
        activeTransactions,
        totalTransactionCount, totalTransactionAmount, totalTransactionCost, grandTotal,
        distinctCurrencies, isMultiCurrency, perCurrency,
    };
}

// Shared disclaimer copy — the load-bearing part of the repositioning
const DISCLAIMER_LINES = [
    'THIS IS NOT A TAX INVOICE',
    'For record-keeping only. Not valid',
    'for eTIMS or VAT claims. Obtain',
    'eTIMS invoices from your suppliers.',
];

// A demo receipt must never be mistakable for a real one — this line is
// non-negotiable whenever isDemo is set.
const DEMO_LINE = 'SAMPLE, NOT REAL DATA';

const CADENCE_DISPLAY: Record<RecurringPattern['cadence'], string> = {
    weekly: 'Weekly',
    fortnightly: 'Fortnightly',
    monthly: 'Monthly',
    irregular: 'Irregular',
};

// Fixed-width 3-column row: name | cadence | amount (right-aligned)
function recurringRow(name: string, cadence: string, amount: string, W: number): string {
    const nameW = 18;
    const cadenceW = 10;
    const amountW = W - nameW - cadenceW;
    return trunc(name, nameW).padEnd(nameW) + cadence.padEnd(cadenceW) + amount.padStart(amountW);
}

// ── Shared document row model (personal_note / point_of_sale / on_behalf_of) ──
// One builder feeds both the HTML file and the PDF, so their content and
// numbers can never drift. expense_summary keeps its own richer renderer below.

type DocRow =
    | { t: 'center'; text: string; strong?: boolean }
    | { t: 'lr'; left: string; right: string; strong?: boolean }
    | { t: 'line'; text: string; muted?: boolean }
    | { t: 'rule'; ch: string }
    | { t: 'gap' }
    | { t: 'total'; left: string; right: string };

function buildDocumentRows(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo: boolean): DocRow[] {
    const d = computeReceiptData(transactions);
    const rows: DocRow[] = [];
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const active = d.activeTransactions;
    const push = (r: DocRow) => rows.push(r);

    // Header — the business name replaces M-Track on a point-of-sale receipt.
    if (meta.documentType === 'point_of_sale') {
        push({ t: 'center', text: (meta.merchantProfile?.businessName || 'Receipt').toUpperCase(), strong: true });
        push({ t: 'center', text: 'RECEIPT' });
    } else if (meta.documentType === 'on_behalf_of') {
        push({ t: 'center', text: 'REIMBURSEMENT CLAIM', strong: true });
    } else {
        push({ t: 'center', text: 'M-TRACK', strong: true });
        push({ t: 'center', text: 'PERSONAL RECORD' });
    }
    push({ t: 'gap' });

    for (const l of baseDisclaimerLines(meta.documentType)) push({ t: 'center', text: l });
    const trust = trustDisclaimerLine(meta.dataSource, meta.documentType);
    if (trust) push({ t: 'center', text: trust });
    if (isDemo) push({ t: 'center', text: DEMO_LINE, strong: true });
    push({ t: 'gap' });

    push({ t: 'line', text: `Ref  ${d.receiptRef}` });
    push({ t: 'line', text: `Issued  ${issuedDate()}` });
    if (meta.documentType === 'on_behalf_of' && meta.onBehalfOf) {
        push({ t: 'line', text: `Prepared by  ${meta.onBehalfOf.preparedBy || '—'}` });
        push({ t: 'line', text: `Prepared for  ${meta.onBehalfOf.partyName}` });
        if (meta.onBehalfOf.purpose) push({ t: 'line', text: `Purpose  ${meta.onBehalfOf.purpose}` });
        push({ t: 'line', text: `Expenses dated  ${covering || '—'}` });
    } else if (covering) {
        push({ t: 'line', text: `Covering  ${covering}` });
    }
    if (meta.documentType === 'point_of_sale' && meta.merchantProfile?.contact) {
        push({ t: 'line', text: `Contact  ${meta.merchantProfile.contact}` });
    }
    push({ t: 'rule', ch: '=' });

    active.forEach((tx, i) => {
        const num = String(i + 1).padStart(2, '0');
        const dateStr = tx.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const name = trunc(getRecipientShort(tx), 20);
        const sign = tx.type === 'sent' ? '' : '+';
        push({ t: 'lr', left: `${num}  ${dateStr}  ${name}`, right: `${sign}${fmtCurrency(tx.amount, tx.currency)}` });

        if (meta.documentType === 'point_of_sale' && tx.lineItems && tx.lineItems.length > 0) {
            for (const li of tx.lineItems) {
                const mid = li.quantity != null && li.unitPrice != null
                    ? `${li.quantity} x ${fmtCurrency(li.unitPrice, tx.currency)}` : '';
                push({ t: 'lr', left: `    ${trunc(li.description, 20)}${mid ? '  ' + mid : ''}`, right: fmtCurrency(li.amount, tx.currency) });
            }
            const mm = lineItemMismatch(tx);
            if (mm) push({ t: 'line', text: `    items add to ${fmtCurrency(mm.itemsTotal, tx.currency)}, total given ${fmtCurrency(mm.lineTotal, tx.currency)}`, muted: true });
        }
        if (tx.transactionCode && !tx.codeIsSynthetic) push({ t: 'line', text: `    Ref ${tx.transactionCode}`, muted: true });
        if (tx.transactionCost != null && tx.transactionCost > 0) push({ t: 'line', text: `    Fee ${fmtCurrency(tx.transactionCost, tx.currency)}`, muted: true });
        if (tx.purposeLabel) push({ t: 'line', text: `    ${tx.purposeLabel}`, muted: true });
        if (lineShowsSelfReportedTag(tx, meta.documentType)) push({ t: 'line', text: '    self-reported', muted: true });
        const note = getUncertaintyNote(tx);
        if (note) push({ t: 'line', text: `    (check) ${note}`, muted: true });
        push({ t: 'gap' });
    });
    push({ t: 'rule', ch: '=' });

    const totalLabel = meta.documentType === 'on_behalf_of' ? 'TOTAL DUE' : 'TOTAL';

    if (d.isMultiCurrency) {
        // Never a single combined figure — one subtotal per currency.
        push({ t: 'gap' });
        push({ t: 'line', text: 'Totalled separately by currency:' });
        for (const pc of d.perCurrency) {
            push({ t: 'lr', left: `  ${pc.currency}, ${pc.count} item${pc.count === 1 ? '' : 's'}`, right: fmtCurrency(pc.amount, pc.currency) });
            if (pc.cost > 0) push({ t: 'lr', left: `  ${pc.currency} transaction costs`, right: fmtCurrency(pc.cost, pc.currency) });
            push({ t: 'lr', left: `  ${totalLabel} (${pc.currency})`, right: fmtCurrency(pc.total, pc.currency), strong: true });
        }
        push({ t: 'rule', ch: '=' });
    } else if (meta.documentType === 'on_behalf_of') {
        const ct = claimTotals(d);
        push({ t: 'gap' });
        push({ t: 'lr', left: `Subtotal, ${ct.itemCount} item${ct.itemCount === 1 ? '' : 's'}`, right: fmt(ct.subtotal) });
        push({ t: 'lr', left: 'M-Pesa transaction costs', right: fmt(ct.transactionCosts) });
        push({ t: 'rule', ch: '-' });
        push({ t: 'total', left: 'TOTAL DUE', right: fmt(ct.totalDue) });
        push({ t: 'rule', ch: '=' });
    } else if (meta.documentType === 'point_of_sale') {
        push({ t: 'gap' });
        if (d.totalTransactionCost > 0) push({ t: 'lr', left: 'Transaction costs', right: fmt(d.totalTransactionCost) });
        push({ t: 'total', left: 'TOTAL', right: fmt(d.grandTotal) });
        push({ t: 'rule', ch: '=' });
    } else {
        push({ t: 'gap' });
        push({ t: 'total', left: 'TOTAL', right: fmt(d.grandTotal) });
        push({ t: 'rule', ch: '=' });
    }

    if (meta.documentType === 'on_behalf_of') {
        push({ t: 'gap' });
        push({ t: 'gap' });
        push({ t: 'line', text: 'Approved by  ____________________________' });
        push({ t: 'gap' });
        push({ t: 'line', text: 'Date         ____________________________' });
    } else if (meta.documentType === 'point_of_sale') {
        push({ t: 'gap' });
        push({ t: 'center', text: 'Thank you. Keep this for your records.' });
    }

    // M-Track's mark lives in the footer for a customer-facing receipt.
    push({ t: 'gap' });
    push({ t: 'center', text: 'Made with M-Track' });
    push({ t: 'center', text: 'mtrack.vercel.app' });

    return rows;
}

function renderRowsToText(rows: DocRow[], W: number): { top: string; totalLine: string | null; bottom: string } {
    const before: string[] = [];
    const after: string[] = [];
    let totalLine: string | null = null;
    let seenTotal = false;
    for (const r of rows) {
        const target = seenTotal ? after : before;
        switch (r.t) {
            case 'center': target.push(center(r.text, W)); break;
            case 'lr': target.push(leftRight(r.left, r.right, W)); break;
            case 'line': target.push(r.text); break;
            case 'rule': target.push(repeat(r.ch, W)); break;
            case 'gap': target.push(''); break;
            case 'total':
                totalLine = leftRight(r.left, r.right, W);
                seenTotal = true;
                break;
        }
    }
    return { top: before.join('\n'), totalLine, bottom: after.join('\n') };
}

async function generateSimpleDocHTML(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo: boolean): Promise<string> {
    const W = 44;
    const rows = buildDocumentRows(transactions, meta, isDemo);
    const { top, totalLine, bottom } = renderRowsToText(rows, W);
    const qrDataUrl = await buildQRDataUrl();
    const d = computeReceiptData(transactions);

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-TRACK ${d.receiptRef}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #e8e8e8; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 32px 16px; font-family: 'Courier New', Courier, monospace; }
        .receipt { background: white; padding: 24px; width: 380px; box-shadow: 2px 4px 28px rgba(0,0,0,0.15); }
        pre { font-family: 'Courier New', Courier, monospace; font-size: 11px; line-height: 1.65; color: #1a1a1a; white-space: pre; overflow-x: auto; }
        .total { font-family: 'Courier New', Courier, monospace; font-size: 13px; font-weight: 700; line-height: 1.65; color: #1a1a1a; white-space: pre; overflow-x: auto; }
        .qr { text-align: center; padding: 8px 0; }
    </style>
</head>
<body>
    <div class="receipt">
        <pre>${top}</pre>
        ${totalLine ? `<pre class="total">${totalLine}</pre>` : ''}
        <pre>${bottom}</pre>
        <div class="qr"><img src="${qrDataUrl}" width="90" height="90" alt="QR code linking to mtrack.vercel.app" /></div>
    </div>
</body>
</html>`;
}

async function generateSimpleDocPDF(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo: boolean): Promise<Blob> {
    const rows = buildDocumentRows(transactions, meta, isDemo);
    const qrDataUrl = await buildQRDataUrl();

    const pageHeight = Math.max(140, Math.min(60 + rows.length * 5.2 + 40, 5000));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, pageHeight] });
    const pageW = 80;
    const margin = 4;
    let y = 8;
    const lh = 3.8;
    doc.setFont('Courier', 'normal');

    for (const r of rows) {
        switch (r.t) {
            case 'center':
                doc.setFontSize(r.strong ? 12 : 7);
                doc.setFont('Courier', r.strong ? 'bold' : 'normal');
                doc.text(r.text, pageW / 2, y, { align: 'center' });
                y += lh;
                break;
            case 'lr':
                doc.setFontSize(7);
                doc.setFont('Courier', r.strong ? 'bold' : 'normal');
                doc.text(r.left, margin, y);
                doc.text(r.right, pageW - margin, y, { align: 'right' });
                y += lh;
                break;
            case 'line':
                doc.setFontSize(6.5);
                doc.setFont('Courier', 'normal');
                doc.text(r.text, margin, y);
                y += lh;
                break;
            case 'rule':
                doc.setFontSize(6.5);
                doc.setFont('Courier', 'normal');
                doc.text(r.ch.repeat(40), margin, y);
                y += lh;
                break;
            case 'gap':
                y += lh * 0.5;
                break;
            case 'total':
                doc.setFontSize(9.5);
                doc.setFont('Courier', 'bold');
                doc.text(r.left, margin, y);
                doc.text(r.right, pageW - margin, y, { align: 'right' });
                y += lh * 1.3;
                break;
        }
    }

    const qrSize = 22;
    doc.addImage(qrDataUrl, 'PNG', (pageW - qrSize) / 2, y + 2, qrSize, qrSize);

    return doc.output('blob');
}

// ── HTML Receipt ──────────────────────────────────────────────────────────────

export async function generateReceiptHTML(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo = false): Promise<string> {
    if (meta.documentType !== 'expense_summary') return generateSimpleDocHTML(transactions, meta, isDemo);
    const d = computeReceiptData(transactions);
    const W = 44;
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const trustLine = trustDisclaimerLine(meta.dataSource, meta.documentType);

    const lines: string[] = [
        // Security code top-left, date top-right — Costco pattern
        leftRight(d.secCode, d.currentDate.toUpperCase(), W),
        leftRight('', d.currentTime, W),
        '',
        center('M-TRACK', W),
        center('EXPENSE SUMMARY', W),
        '',
    ];

    // ── Disclaimer block ──
    DISCLAIMER_LINES.forEach(l => lines.push(center(l, W)));
    if (trustLine) lines.push(center(trustLine, W));
    if (isDemo) lines.push(center(DEMO_LINE, W));
    lines.push('');

    lines.push(`REF: ${d.receiptRef}`);
    lines.push(`ISSUED: ${issuedDate().toUpperCase()}`);
    if (covering) lines.push(`COVERING: ${covering.toUpperCase()}`);
    lines.push(repeat('=', W));
    // Item count bold — Costco pattern
    lines.push(leftRight(`${d.activeTransactions.length} ITEMS`, '', W));
    lines.push(repeat('-', W));
    // Column headers
    lines.push(leftRight('DATE DESCRIPTION', 'AMOUNT', W));
    lines.push(repeat('-', W));
    lines.push('');

    // ── Transaction rows — breathing room, one blank line between each ──
    d.activeTransactions.forEach((t, i) => {
        const num       = String(i + 1).padStart(2, '0');
        const dateStr   = t.date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const sign      = t.type === 'sent' ? '-' : '+';
        const amtStr    = `${sign}${fmt(t.amount)}`;
        const nameCol   = trunc(getRecipientShort(t), 16);
        const providerTag = getProviderSuffix(t);
        const nameWithProvider = providerTag ? `${nameCol}  ·  ${providerTag}` : nameCol;
        const left      = `${num} ${dateStr} ${nameWithProvider}`;
        lines.push(leftRight(left, amtStr, W));
        lines.push(`   Ref: ${t.transactionCode}`);
        if (t.transactionCost != null && t.transactionCost > 0) {
            lines.push(`   Fee: ${fmt(t.transactionCost)}`);
        }
        if (t.receiptLabel) {
            lines.push(`   → ${t.receiptLabel.toUpperCase()}`);
        } else if (t.merchantCategory) {
            lines.push(`   → ${t.merchantCategory.toUpperCase()}`);
        }
        const esNote = getUncertaintyNote(t);
        if (esNote) lines.push(`   (check) ${esNote}`);
        lines.push('');
    });

    lines.push(repeat('=', W));

    // ── Category summary ──
    lines.push('');
    lines.push(center('CATEGORY SUMMARY', W));
    lines.push(repeat('-', W));
    Object.entries(d.labelTotals).forEach(([label, total]) => {
        const count = d.labelCounts[label];
        lines.push(leftRight(`${label} (x${count})`, fmt(total), W));
    });
    lines.push(repeat('=', W));

    // ── Recurring payments — only confident, repeated patterns ──
    if (d.recurringPatterns.length > 0) {
        lines.push('');
        lines.push(center('RECURRING PAYMENTS', W));
        lines.push(repeat('-', W));
        d.recurringPatterns.forEach(p => {
            lines.push(recurringRow(p.recipient, CADENCE_DISPLAY[p.cadence], fmt(p.averageAmount), W));
        });
        lines.push(repeat('-', W));
    }

    // ── Totals ──
    lines.push('');
    lines.push(center('TOTALS', W));
    lines.push(repeat('-', W));
    if (d.isMultiCurrency) {
        lines.push(center('Mixed currencies, per-currency subtotals:', W));
        for (const pc of d.perCurrency) {
            lines.push(leftRight(`${pc.currency}, ${pc.count} item${pc.count === 1 ? '' : 's'}`, fmtCurrency(pc.amount, pc.currency), W));
            if (pc.cost > 0) lines.push(leftRight(`${pc.currency} fees`, fmtCurrency(pc.cost, pc.currency), W));
        }
    } else {
        lines.push(leftRight('Items sent', fmt(d.trueOutflow), W));
        lines.push(leftRight('Items received', fmt(d.totalReceived), W));
        lines.push(leftRight('Transaction fees', fmt(d.totalFees), W));
        lines.push(repeat('-', W));
        lines.push(leftRight('NET', fmtSigned(d.net), W));
        lines.push(leftRight('TOTAL + FEES', fmt(d.trueOutflow + d.totalFees), W));
    }
    lines.push(repeat('=', W));

    // ── Fee breakdown ──
    if (d.feesBreakdown.length > 0) {
        lines.push('');
        lines.push(center('FEE BREAKDOWN', W));
        lines.push(repeat('-', W));
        d.feesBreakdown.forEach(f => {
            lines.push(leftRight(`${f.label} (x${f.count})`, fmt(f.total), W));
        });
        lines.push(repeat('=', W));
    }

    // ── Tally — final summary-of-summaries ──
    lines.push('');
    lines.push(center('TALLY', W));
    lines.push(repeat('-', W));
    lines.push(leftRight('Transactions counted', String(d.totalTransactionCount), W));
    lines.push(repeat('-', W));

    let grandTotalLine: string;
    if (d.isMultiCurrency) {
        lines.push(center('Totalled separately by currency', W));
        for (const pc of d.perCurrency) {
            lines.push(leftRight(`${pc.currency} (x${pc.count})`, fmtCurrency(pc.total, pc.currency), W));
        }
        lines.push(repeat('-', W));
        grandTotalLine = leftRight('GRAND TOTAL', 'see per-currency above', W);
    } else {
        lines.push(leftRight('Total transaction amount', fmt(d.totalTransactionAmount), W));
        lines.push(leftRight('Total transaction cost', fmt(d.totalTransactionCost), W));
        lines.push(repeat('-', W));
        // GRAND TOTAL breaks out of the shared <pre> so it can be the single
        // heaviest line on the receipt — bold + accent, not just monospace text.
        grandTotalLine = leftRight('GRAND TOTAL', fmt(d.grandTotal), W);
    }
    const bodyTextTop = lines.join('\n');

    const footerLines: string[] = [
        repeat('=', W),
        '',
        center('GENERATED BY M-TRACK', W),
        // Security code paired with the ref — Costco daily-code pattern
        leftRight(`REF: ${d.receiptRef}`, d.secCode, W),
    ];
    const bodyTextBottom = footerLines.join('\n');

    // QR footer block — a footer mark, not an advertisement. The image sits
    // between two <pre> blocks so the surrounding text keeps its monospace
    // grid; the data URL keeps the file fully self-contained (no CDN, works
    // offline).
    const qrTopText = [repeat('=', W), center('MADE WITH M-TRACK', W)].join('\n');
    const qrBottomText = [center('mtrack.vercel.app', W), repeat('=', W)].join('\n');
    const qrDataUrl = await buildQRDataUrl();

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-TRACK ${d.receiptRef}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #e8e8e8;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            padding: 32px 16px;
            font-family: 'Courier New', Courier, monospace;
        }
        .receipt-wrap { position: relative; }
        .tear-top {
            width: 100%; height: 18px; background: white;
            clip-path: polygon(0% 100%, 2% 20%, 4% 80%, 6% 10%, 8% 70%, 10% 5%, 12% 65%, 14% 15%, 16% 75%, 18% 0%, 20% 60%, 22% 10%, 24% 70%, 26% 5%, 28% 65%, 30% 20%, 32% 80%, 34% 5%, 36% 70%, 38% 15%, 40% 75%, 42% 0%, 44% 60%, 46% 20%, 48% 80%, 50% 10%, 52% 65%, 54% 5%, 56% 70%, 58% 20%, 60% 80%, 62% 10%, 64% 75%, 66% 0%, 68% 60%, 70% 20%, 72% 80%, 74% 5%, 76% 70%, 78% 15%, 80% 75%, 82% 10%, 84% 65%, 86% 0%, 88% 60%, 90% 20%, 92% 80%, 94% 10%, 96% 70%, 98% 15%, 100% 80%, 100% 100%);
        }
        .receipt {
            background: white;
            padding: 10px 24px 28px;
            width: 360px;
            box-shadow: 2px 4px 28px rgba(0,0,0,0.15);
        }
        .tear-bottom {
            width: 100%; height: 18px; background: white;
            clip-path: polygon(0% 0%, 2% 80%, 4% 20%, 6% 90%, 8% 30%, 10% 95%, 12% 35%, 14% 85%, 16% 25%, 18% 100%, 20% 40%, 22% 90%, 24% 30%, 26% 95%, 28% 35%, 30% 80%, 32% 20%, 34% 95%, 36% 30%, 38% 85%, 40% 25%, 42% 100%, 44% 40%, 46% 80%, 48% 20%, 50% 90%, 52% 35%, 54% 95%, 56% 30%, 58% 80%, 60% 20%, 62% 90%, 64% 25%, 66% 100%, 68% 40%, 70% 80%, 72% 20%, 74% 95%, 76% 30%, 78% 85%, 80% 25%, 82% 90%, 84% 35%, 86% 100%, 88% 40%, 90% 80%, 92% 20%, 94% 90%, 96% 30%, 98% 85%, 100% 20%, 100% 0%);
        }
        pre {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            line-height: 1.65;
            color: #1a1a1a;
            white-space: pre;
            overflow-x: auto;
        }
        .grand-total {
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.65;
            color: var(--accent, #1a1a1a);
            white-space: pre;
            overflow-x: auto;
        }
        .disclaimer {
            border: 1px dashed var(--warn-border, #fde68a);
            background: var(--warn-bg, #fffbeb);
            color: var(--warn-text, #b45309);
            font-family: 'Courier New', Courier, monospace;
            font-size: 10px;
            line-height: 1.5;
            text-align: center;
            padding: 6px 4px;
            margin: 8px 0;
            white-space: pre-line;
        }
        @media print {
            body { background: white; padding: 0; }
            .tear-top, .tear-bottom { display: none; }
            .receipt { box-shadow: none; width: 100%; padding: 0; }
            pre { font-size: 9.5px; }
        }
    </style>
</head>
<body>
    <div class="receipt-wrap">
        <div class="tear-top"></div>
        <div class="receipt">
            <pre>${bodyTextTop}</pre>
            <pre class="grand-total">${grandTotalLine}</pre>
            <pre>${bodyTextBottom}</pre>
            <pre>${qrTopText}</pre>
            <div style="text-align:center; padding: 6px 0;">
                <img src="${qrDataUrl}" width="94" height="94" alt="QR code linking to mtrack.vercel.app" />
            </div>
            <pre>${qrBottomText}</pre>
        </div>
        <div class="tear-bottom"></div>
    </div>
</body>
</html>`;
}

// ── PDF Receipt ───────────────────────────────────────────────────────────────

export async function generateReceiptPDF(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo = false): Promise<Blob> {
    if (meta.documentType !== 'expense_summary') return generateSimpleDocPDF(transactions, meta, isDemo);
    const d = computeReceiptData(transactions);
    const qrDataUrl = await buildQRDataUrl();
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const trustLine = trustDisclaimerLine(meta.dataSource, meta.documentType);

    // Dynamic height: base ~80mm + ~14mm per transaction + fee/category extras
    // + ~20mm for the disclaimer block + ~4mm per category in the summary
    // + ~4mm per recurring pattern row + ~35mm for the QR footer block
    const extraPerTx    = 18;
    const feeLines      = d.feesBreakdown.length > 0 ? d.feesBreakdown.length * 4 + 8 : 0;
    const categoryCount = Object.keys(d.labelTotals).length;
    const categoryLines = categoryCount * 4 + 12;
    const disclaimerLines = isDemo ? 24 : 20;
    const recurringLines = d.recurringPatterns.length > 0 ? d.recurringPatterns.length * 4 + 12 : 0;
    // TALLY block — heading + 4 rows + 3 dividers + the taller GRAND TOTAL line (~6 print lines' worth)
    const tallyLines = 40;
    const qrBlockLines = 35;
    // Upper bound is jsPDF's own hard ceiling (a PDF page can't exceed 14400
    // "user units" — ~5080mm at this mm/pt scale), minus headroom, not an
    // arbitrary round number: the previous 900mm cap silently truncated any
    // receipt with more than ~45 transactions, chopping off everything past
    // that row with no error and no indication anything was cut.
    const MAX_PAGE_HEIGHT_MM = 5000;
    const pageHeight = Math.max(
        140,
        Math.min(
            80 + d.activeTransactions.length * extraPerTx + feeLines + categoryLines + recurringLines + disclaimerLines + tallyLines + qrBlockLines,
            MAX_PAGE_HEIGHT_MM
        )
    );

    const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, pageHeight] });
    const pageW  = 80;
    const margin = 4;
    let y        = 6;
    const lh     = 3.8;

    doc.setFont('Courier', 'normal');

    function line(text: string, size = 7.5, bold = false, align: 'left'|'center'|'right' = 'left') {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        if (align === 'center') doc.text(text, pageW / 2, y, { align: 'center' });
        else if (align === 'right') doc.text(text, pageW - margin, y, { align: 'right' });
        else doc.text(text, margin, y);
        y += lh;
    }

    function lr(left: string, right: string, size = 7.5, bold = false) {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        doc.text(left, margin, y);
        doc.text(right, pageW - margin, y, { align: 'right' });
        y += lh;
    }

    function divider(ch = '-') { line(ch.repeat(40), 6.5); }
    function sp(factor = 0.5) { y += lh * factor; }

    // ── Header ──
    // Security code left, date right, time below right
    lr(d.secCode, d.currentDate.toUpperCase(), 6.5);
    lr('', d.currentTime, 6.5);
    sp();
    line('M-TRACK', 13, true, 'center');
    line('EXPENSE SUMMARY', 8.5, true, 'center');
    sp();

    // ── Disclaimer block — smaller font, still readable ──
    DISCLAIMER_LINES.forEach(l => line(l, 6, false, 'center'));
    if (trustLine) line(trustLine, 6, false, 'center');
    if (isDemo) line(DEMO_LINE, 6.5, true, 'center');
    sp();

    line(`REF: ${d.receiptRef}`, 6.5);
    line(`ISSUED: ${issuedDate().toUpperCase()}`, 6.5);
    if (covering) line(`COVERING: ${covering.toUpperCase()}`, 6.5);
    divider('=');

    // Item count
    line(`${d.activeTransactions.length} ITEMS`, 8, true);
    divider();

    // Column header
    lr('DATE DESCRIPTION', 'AMOUNT', 6.5, true);
    divider();
    sp(0.3);

    // ── Transaction rows — breathing room, blank line between each ──
    d.activeTransactions.forEach((t, i) => {
        const num     = String(i + 1).padStart(2, '0');
        const dateStr = t.date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const sign    = t.type === 'sent' ? '-' : '+';
        const name    = trunc(getRecipientShort(t), 13);
        const amt     = `${sign}${fmt(t.amount)}`;
        const providerTag = getProviderSuffix(t);
        const nameWithProvider = providerTag ? `${name}  ·  ${providerTag}` : name;

        // Main row — left name, right amount
        lr(`${num} ${dateStr} ${nameWithProvider}`, amt, 7);

        // Ref line, indented
        line(`   Ref: ${t.transactionCode}`, 6);

        // Fee line, indented
        if (t.transactionCost != null && t.transactionCost > 0) {
            line(`   Fee: ${fmt(t.transactionCost)}`, 6);
        }

        // Label line, indented — falls back to the parser's own category
        if (t.receiptLabel) {
            line(`   → ${t.receiptLabel.toUpperCase()}`, 6.5, true);
        } else if (t.merchantCategory) {
            line(`   → ${t.merchantCategory.toUpperCase()}`, 6.5, true);
        }

        const esNote = getUncertaintyNote(t);
        if (esNote) line(`   (check) ${esNote}`, 6);

        sp(0.6);
    });

    divider('=');

    // ── Category summary ──
    sp(0.5);
    line('CATEGORY SUMMARY', 7.5, true, 'center');
    divider();
    Object.entries(d.labelTotals).forEach(([label, total]) => {
        const count = d.labelCounts[label];
        lr(`${label} (x${count})`, fmt(total), 7);
    });
    divider('=');

    // ── Recurring payments — only confident, repeated patterns ──
    if (d.recurringPatterns.length > 0) {
        sp(0.5);
        line('RECURRING PAYMENTS', 7.5, true, 'center');
        divider();
        d.recurringPatterns.forEach(p => {
            lr(`${trunc(p.recipient, 18)}  ${CADENCE_DISPLAY[p.cadence]}`, fmt(p.averageAmount), 6.5);
        });
        divider();
    }

    // ── Totals ──
    sp(0.5);
    line('TOTALS', 7.5, true, 'center');
    divider();
    if (d.isMultiCurrency) {
        line('Mixed currencies, per-currency subtotals:', 6.5, false, 'center');
        d.perCurrency.forEach(pc => {
            lr(`${pc.currency}, ${pc.count} item${pc.count === 1 ? '' : 's'}`, fmtCurrency(pc.amount, pc.currency), 7.5);
            if (pc.cost > 0) lr(`${pc.currency} fees`, fmtCurrency(pc.cost, pc.currency), 7);
        });
    } else {
        lr('Items sent', fmt(d.trueOutflow), 7.5);
        lr('Items received', fmt(d.totalReceived), 7.5);
        lr('Transaction fees', fmt(d.totalFees), 7.5);
        divider();
        lr('NET', fmtSigned(d.net), 8.5, true);
        lr('TOTAL + FEES', fmt(d.trueOutflow + d.totalFees), 8.5, true);
    }
    divider('=');

    // ── Fee breakdown ──
    if (d.feesBreakdown.length > 0) {
        sp(0.5);
        line('FEE BREAKDOWN', 7.5, true, 'center');
        divider();
        d.feesBreakdown.forEach(f => {
            lr(`${f.label} (x${f.count})`, fmt(f.total), 6.5);
        });
        divider('=');
    }

    // ── Tally — final summary-of-summaries, GRAND TOTAL is the heaviest line on the receipt ──
    sp(0.5);
    line('TALLY', 7.5, true, 'center');
    divider();
    lr('Transactions counted', String(d.totalTransactionCount), 7.5);
    divider();
    if (d.isMultiCurrency) {
        line('Totalled separately by currency', 6.5, false, 'center');
        d.perCurrency.forEach(pc => lr(`${pc.currency} (x${pc.count})`, fmtCurrency(pc.total, pc.currency), 8, true));
        divider('=');
    } else {
        lr('Total transaction amount', fmt(d.totalTransactionAmount), 7.5);
        lr('Total transaction cost', fmt(d.totalTransactionCost), 7.5);
        divider();
        lr('GRAND TOTAL', fmt(d.grandTotal), 9.5, true);
        divider('=');
    }

    // ── Footer ──
    sp(0.5);
    line('GENERATED BY M-TRACK', 7, false, 'center');
    // Security code paired with the ref — Costco daily-code pattern
    lr(`REF: ${d.receiptRef}`, d.secCode, 6.5);

    // ── QR footer block — a footer mark, not an advertisement ──
    sp(0.5);
    divider('=');
    line('MADE WITH M-TRACK', 7, true, 'center');
    sp(0.3);
    const qrSize = 25; // mm, per spec
    doc.addImage(qrDataUrl, 'PNG', (pageW - qrSize) / 2, y, qrSize, qrSize);
    y += qrSize + 2;
    line('mtrack.vercel.app', 6.5, false, 'center');
    divider('=');

    return doc.output('blob');
}

// ── Share text ────────────────────────────────────────────────────────────────

// Plain-text summary for the Web Share API / clipboard fallback — deliberately
// short, not the full receipt.
const DOC_NOUN: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'Expense summary',
    personal_note: 'Personal record',
    point_of_sale: 'Receipt',
    on_behalf_of: 'Reimbursement claim',
};

export function summariseReceiptForShare(transactions: ParsedTransaction[], meta: DocRenderMeta): string {
    const d = computeReceiptData(transactions);
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const noun = DOC_NOUN[meta.documentType];
    const lines = [
        covering ? `${noun} · ${covering}` : noun,
    ];
    if (d.isMultiCurrency) {
        lines.push(`${d.activeTransactions.length} item${d.activeTransactions.length !== 1 ? 's' : ''}`);
        for (const pc of d.perCurrency) lines.push(`${fmtCurrency(pc.total, pc.currency)} (${pc.count})`);
    } else if (meta.documentType === 'on_behalf_of') {
        const ct = claimTotals(d);
        lines.push(`${ct.itemCount} item${ct.itemCount === 1 ? '' : 's'} · ${fmt(ct.totalDue)} due`);
    } else if (meta.documentType === 'expense_summary') {
        lines.push(`${d.activeTransactions.length} transaction${d.activeTransactions.length !== 1 ? 's' : ''} · ${fmt(d.trueOutflow)} out`);
        if (d.totalFees > 0) lines.push(`${fmt(d.totalFees)} in fees`);
    } else {
        lines.push(`${d.activeTransactions.length} item${d.activeTransactions.length !== 1 ? 's' : ''} · ${fmt(d.grandTotal)}`);
    }
    lines.push('');
    lines.push('Made with M-Track');
    lines.push('mtrack.vercel.app');
    return lines.join('\n');
}
