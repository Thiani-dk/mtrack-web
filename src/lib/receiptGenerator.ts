import type { ParsedTransaction } from '../types';
import QRCode from 'qrcode';
import { detectRecurring, type RecurringPattern } from './insights/recurring';
import { type DocRenderMeta, formatCovering, claimTotals } from './documentRender';
import { buildDocModel, renderDocHTML, renderDocPDF } from './documentLayout';
import { stripEmojiOr, stripEmojiOptional } from './sanitizeText';

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
    // A hand-entered line has no external payment channel to name — and
    // "Self-reported" is an internal token, never shown to a user.
    if (t.provider === 'Self-reported') return null;
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

    // Only include transactions the user hasn't removed.
    //
    // Every user-supplied string that will reach a rendered document is emoji
    // stripped here, at assembly, rather than in each renderer — all three
    // surfaces (chat preview, HTML, PDF) read from this one function, and all
    // three entry paths (typed, parsed from a message, edited afterwards)
    // converge on it. An emoji in a name breaks jsPDF's text measurement and
    // garbles the layout; see sanitizeText.ts.
    const activeTransactions = transactions
        .filter(t => !t.excludedFromReceipt)
        .map(t => {
            const recipient = stripEmojiOr(t.recipient, 'Unknown');
            const merchant = stripEmojiOptional(t.merchant);
            const purposeLabel = stripEmojiOptional(t.purposeLabel);
            const receiptLabel = stripEmojiOptional(t.receiptLabel);
            const sender = stripEmojiOptional(t.sender);
            const unchanged =
                recipient === t.recipient && merchant === t.merchant &&
                purposeLabel === t.purposeLabel && receiptLabel === t.receiptLabel &&
                sender === t.sender;
            return unchanged ? t : { ...t, recipient, merchant, purposeLabel, receiptLabel, sender };
        });

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

// ── Document rendering ────────────────────────────────────────────────────────
// All four document types render through ONE shared layout (documentLayout.ts).
// expense_summary used to have its own richer renderer and the other three
// shared a row-model builder; both are retired so the design lives in one place
// and the HTML and PDF can never disagree.

// The embedded font data (~390 KB base64 — Source Serif 4 plus Geist for the
// micro-labels) is split into its own module and pulled in only here, on the
// first export, so it lands in a lazy chunk instead of weighing down the
// initial load.
const docFonts = () => import('./pdfFontData');

export async function generateReceiptHTML(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo = false): Promise<string> {
    const model = buildDocModel(transactions, meta, isDemo);
    const [{ SOURCE_SERIF_VARIABLE_WOFF2_B64, GEIST_VARIABLE_WOFF2_B64 }, qr] = await Promise.all([docFonts(), buildQRDataUrl()]);
    return renderDocHTML(model, qr, { serifWoff2: SOURCE_SERIF_VARIABLE_WOFF2_B64, sansWoff2: GEIST_VARIABLE_WOFF2_B64 });
}

export async function generateReceiptPDF(transactions: ParsedTransaction[], meta: DocRenderMeta, isDemo = false): Promise<Blob> {
    const model = buildDocModel(transactions, meta, isDemo);
    const [{ SOURCE_SERIF_REGULAR_TTF_B64, SOURCE_SERIF_SEMIBOLD_TTF_B64, GEIST_REGULAR_TTF_B64 }, qr] = await Promise.all([docFonts(), buildQRDataUrl()]);
    return renderDocPDF(model, qr, {
        serifRegular: SOURCE_SERIF_REGULAR_TTF_B64,
        serifBold: SOURCE_SERIF_SEMIBOLD_TTF_B64,
        sans: GEIST_REGULAR_TTF_B64,
    });
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
