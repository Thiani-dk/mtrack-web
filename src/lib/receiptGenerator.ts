import type { ParsedTransaction } from '../types';
import { jsPDF } from 'jspdf';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return 'Ksh ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

function getRecipientShort(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'airtime':        return 'AIRTIME';
        case 'data':           return 'DATA BUNDLE';
        case 'mshwari':        return 'M-SHWARI';
        case 'investment':     return 'ZIIDI MMF';
        case 'withdrawal':     return 'CASH WITHDRAWAL';
        default:               return t.recipient.toUpperCase();
    }
}

function getTypeFlag(t: ParsedTransaction): string {
    // Right-margin single-char flag — Costco pattern
    switch (t.subType) {
        case 'person_receive': return 'R'; // Received
        case 'person_send':    return 'S'; // Send
        case 'pochi_send':     return 'P'; // Pochi
        case 'paybill':        return 'B'; // Bill
        case 'airtime':        return 'A'; // Airtime
        case 'data':           return 'D'; // Data
        case 'withdrawal':     return 'W'; // Withdrawal
        case 'mshwari':        return 'M'; // M-Shwari
        case 'investment':     return 'I'; // Investment
        default:               return '?';
    }
}

// ── Shared computation ────────────────────────────────────────────────────────

interface ReceiptData {
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
    hasLabels: boolean;
    activeTransactions: ParsedTransaction[];
}

function computeReceiptData(transactions: ParsedTransaction[]): ReceiptData {
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

    // Receipt label totals
    const labelTotals: Record<string, number> = {};
    activeTransactions.forEach(t => {
        if (t.receiptLabel && t.type === 'sent') {
            labelTotals[t.receiptLabel] = (labelTotals[t.receiptLabel] ?? 0) + t.amount;
        }
    });
    const hasLabels = activeTransactions.some(t => t.receiptLabel != null);

    return {
        currentDate, currentTime, receiptRef, secCode,
        totalSent, totalReceived, personSendTotal, pochiTotal,
        paybillTotal, airtimeTotal, dataTotal, withdrawalTotal,
        mshwariTotal, investmentTotal, trueOutflow, net,
        totalFees, feesBreakdown, labelTotals, hasLabels,
        activeTransactions,
    };
}

// ── HTML Receipt ──────────────────────────────────────────────────────────────

export function generateReceiptHTML(transactions: ParsedTransaction[], dateRange: string): string {
    const d = computeReceiptData(transactions);
    const W = 44;

    const lines: string[] = [
        // Security code top-left, date top-right — Costco pattern
        leftRight(d.secCode, d.currentDate.toUpperCase(), W),
        '',
        center('M-TRACK', W),
        center('Expense Receipt', W),
        '',
        leftRight(`REF: ${d.receiptRef}`, `PERIOD: ${dateRange.toUpperCase()}`, W),
        repeat('=', W),
        // Item count bold — Costco pattern
        leftRight(`${d.activeTransactions.length} ITEMS`, d.currentTime, W),
        repeat('-', W),
        // Column headers
        leftRight('  # DATE       RECIPIENT', 'AMOUNT  [T]', W),
        repeat('-', W),
    ];

    // Single-line transaction rows — Costco dense layout
    d.activeTransactions.forEach((t, i) => {
        const num      = String(i + 1).padStart(2, '0');
        const dateStr  = t.date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const flag     = getTypeFlag(t);
        const sign     = t.type === 'sent' ? '-' : '+';
        const amtStr   = `${sign}${fmt(t.amount)}`;
        const nameCol  = trunc(getRecipientShort(t), 16);
        const left     = `  ${num} ${dateStr}  ${nameCol}`;
        lines.push(leftRight(left, `${amtStr}  [${flag}]`, W));
        // Receipt label indented below if set — Target "You Saved" style
        if (t.receiptLabel) {
            lines.push(`       → ${t.receiptLabel.toUpperCase()}`);
        }
        // Transaction code on its own line, small
        lines.push(`       ${t.transactionCode}`);
        if (t.transactionCost != null && t.transactionCost > 0) {
            lines.push(`       FEE: ${fmt(t.transactionCost)}`);
        }
    });

    lines.push(repeat('-', W));
    lines.push('');
    lines.push(center('TYPE FLAGS: R=Received S=Send P=Pochi', W));
    lines.push(center('B=Bill  A=Airtime  W=Withdrawal  M=M-Shwari', W));
    lines.push('');
    lines.push(repeat('=', W));

    // Totals section — Target rigid negative space
    lines.push('');
    lines.push(leftRight('SUBTOTAL', fmt(d.trueOutflow), W));
    if (d.totalFees > 0) {
        lines.push(leftRight('TRANSACTION FEES', fmt(d.totalFees), W));
        if (d.feesBreakdown.length > 0) {
            d.feesBreakdown.forEach(f => {
                lines.push(leftRight(`  ${f.label} (x${f.count})`, fmt(f.total), W));
            });
        }
    }
    lines.push(repeat('-', W));
    lines.push(leftRight('TOTAL SPENT', fmt(d.trueOutflow + d.totalFees), W));
    if (d.totalReceived > 0) {
        lines.push(leftRight('TOTAL RECEIVED', fmt(d.totalReceived), W));
        lines.push(repeat('-', W));
        lines.push(leftRight('NET FLOW', fmtSigned(d.net), W));
    }
    lines.push(repeat('=', W));

    // Label / category breakdown — Target "You Saved" block
    if (d.hasLabels) {
        lines.push('');
        lines.push(center('CATEGORY BREAKDOWN', W));
        lines.push(repeat('-', W));
        Object.entries(d.labelTotals).forEach(([label, total]) => {
            lines.push(leftRight(`  ${label.toUpperCase()}`, fmt(total), W));
        });
        lines.push(repeat('=', W));
    }

    lines.push('');
    lines.push(center('GENERATED BY M-TRACK', W));
    lines.push(center(`REF: ${d.receiptRef}`, W));
    // Security code repeated at bottom — Costco daily-code pattern
    lines.push(leftRight('mtrack.vercel.app', d.secCode, W));

    const receiptText = lines.join('\n');

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
        <div class="receipt"><pre>${receiptText}</pre></div>
        <div class="tear-bottom"></div>
    </div>
</body>
</html>`;
}

// ── PDF Receipt ───────────────────────────────────────────────────────────────

export function generateReceiptPDF(transactions: ParsedTransaction[], dateRange: string): Blob {
    const d = computeReceiptData(transactions);

    // Dynamic height: base ~80mm + ~14mm per transaction + label/fee extras
    const extraPerTx   = d.hasLabels ? 18 : 14;
    const featureLines = d.totalFees > 0 ? d.feesBreakdown.length * 4 + 8 : 0;
    const labelLines   = d.hasLabels ? Object.keys(d.labelTotals).length * 4 + 12 : 0;
    const pageHeight   = Math.max(120, Math.min(80 + d.activeTransactions.length * extraPerTx + featureLines + labelLines, 900));

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
    // Security code left, date right
    lr(d.secCode, d.currentDate.toUpperCase(), 6.5);
    sp();
    line('M-TRACK', 13, true, 'center');
    line('Expense Receipt', 7.5, false, 'center');
    sp();
    lr(`REF: ${d.receiptRef}`, `PERIOD: ${dateRange.toUpperCase()}`, 6.5);
    divider('=');

    // Item count large — Costco pattern
    lr(`${d.activeTransactions.length} ITEMS`, d.currentTime, 8, true);
    divider();

    // Column header
    line('  # DATE      RECIPIENT        AMT    [T]', 6.5);
    divider();

    // ── Transaction rows ──
    d.activeTransactions.forEach((t, i) => {
        const num     = String(i + 1).padStart(2, '0');
        const dateStr = t.date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const flag    = getTypeFlag(t);
        const sign    = t.type === 'sent' ? '-' : '+';
        const name    = trunc(getRecipientShort(t), 13);
        const amt     = `${sign}${fmt(t.amount)}`;

        // Main row — left name, right amount + flag
        lr(`  ${num} ${dateStr}  ${name}`, `${amt} [${flag}]`, 7);

        // Transaction code
        line(`       ${t.transactionCode}`, 6);

        // Receipt label
        if (t.receiptLabel) {
            line(`       > ${t.receiptLabel.toUpperCase()}`, 6.5, true);
        }

        // Fee line
        if (t.transactionCost != null && t.transactionCost > 0) {
            lr(`       FEE:`, fmt(t.transactionCost), 6);
        }

        sp(0.3);
    });

    divider();
    sp();

    // Flag legend
    line('FLAGS: R=Received S=Send P=Pochi B=Bill', 6, false, 'center');
    line('A=Airtime W=Withdrawal M=M-Shwari I=Invest', 6, false, 'center');
    sp();
    divider('=');

    // ── Totals — Target rigid spacing ──
    sp(0.5);
    lr('SUBTOTAL', fmt(d.trueOutflow), 7.5);

    if (d.totalFees > 0) {
        lr('TRANSACTION FEES', fmt(d.totalFees), 7.5);
        d.feesBreakdown.forEach(f => {
            lr(`  ${f.label} (x${f.count})`, fmt(f.total), 6.5);
        });
    }

    divider();
    lr('TOTAL SPENT', fmt(d.trueOutflow + d.totalFees), 8.5, true);

    if (d.totalReceived > 0) {
        sp(0.3);
        lr('TOTAL RECEIVED', fmt(d.totalReceived), 7.5);
        divider();
        lr('NET FLOW', fmtSigned(d.net), 8.5, true);
    }

    divider('=');

    // ── Category breakdown — Target "You Saved" style ──
    if (d.hasLabels) {
        sp(0.5);
        line('CATEGORY BREAKDOWN', 7.5, true, 'center');
        divider();
        Object.entries(d.labelTotals).forEach(([label, total]) => {
            lr(`  ${label.toUpperCase()}`, fmt(total), 7);
        });
        divider('=');
    }

    // ── Footer ──
    sp(0.5);
    line('GENERATED BY M-TRACK', 7, false, 'center');
    line(`REF: ${d.receiptRef}`, 6.5, false, 'center');
    sp(0.3);
    // Security code bottom-right, URL bottom-left — Costco mirror pattern
    lr('mtrack.vercel.app', d.secCode, 6.5);

    return doc.output('blob');
}