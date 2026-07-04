import type { ParsedTransaction } from '../types';
import { jsPDF } from 'jspdf';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDescription(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'person_receive': return `FROM: ${t.recipient.toUpperCase()}`;
        case 'person_send':    return `TO: ${t.recipient.toUpperCase()}`;
        case 'pochi_send':     return `POCHI: ${t.recipient.toUpperCase()}`;
        case 'paybill':        return `PAYBILL: ${t.recipient.toUpperCase()}`;
        case 'airtime':        return 'AIRTIME PURCHASE';
        case 'data':           return 'DATA BUNDLE';
        case 'withdrawal':     return t.recipient.toUpperCase();
        case 'mshwari':        return 'M-SHWARI SAVINGS';
        case 'investment':     return `INVESTMENT: ${t.recipient.toUpperCase()}`;
        default:               return t.recipient.toUpperCase();
    }
}

function getBadgeLabel(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'person_receive': return 'RECEIVED';
        case 'person_send':    return 'SENT';
        case 'pochi_send':     return 'POCHI';
        case 'paybill':        return 'PAYBILL';
        case 'airtime':        return 'AIRTIME';
        case 'data':           return 'DATA';
        case 'withdrawal':     return 'WITHDRAWAL';
        case 'mshwari':        return 'M-SHWARI';
        case 'investment':     return 'INVESTMENT';
        default:               return t.type.toUpperCase();
    }
}

// Correct Kenyan Shilling abbreviation is Ksh, not KSH
function fmt(n: number): string {
    return 'Ksh ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtSigned(n: number): string {
    const abs = fmt(Math.abs(n));
    return (n >= 0 ? '+' : '-') + abs;
}

function repeat(char: string, n: number): string {
    return char.repeat(n);
}

function center(text: string, width: number): string {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, width: number): string {
    const gap = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(gap) + right;
}

// Generates a short human-readable receipt reference from the current timestamp
function generateReceiptRef(): string {
    const now = new Date();
    const y = String(now.getFullYear()).slice(2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `MT${y}${m}${d}-${h}${min}`;
}

// ── Shared data computation ───────────────────────────────────────────────────

interface ReceiptData {
    now: Date;
    currentDate: string;
    currentTime: string;
    receiptRef: string;
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
    savingsTotal: number;
    trueOutflow: number;
    net: number;
    labelTotals: Record<string, number>;
    hasLabels: boolean;
}

function computeReceiptData(transactions: ParsedTransaction[]): ReceiptData {
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const receiptRef = generateReceiptRef();

    const totalSent       = transactions.filter(t => t.type === 'sent').reduce((s, t) => s + t.amount, 0);
    const totalReceived   = transactions.filter(t => t.type === 'received').reduce((s, t) => s + t.amount, 0);
    const mshwariTotal    = transactions.filter(t => t.subType === 'mshwari').reduce((s, t) => s + t.amount, 0);
    const investmentTotal = transactions.filter(t => t.subType === 'investment').reduce((s, t) => s + t.amount, 0);
    const withdrawalTotal = transactions.filter(t => t.subType === 'withdrawal').reduce((s, t) => s + t.amount, 0);
    const paybillTotal    = transactions.filter(t => t.subType === 'paybill').reduce((s, t) => s + t.amount, 0);
    const airtimeTotal    = transactions.filter(t => t.subType === 'airtime').reduce((s, t) => s + t.amount, 0);
    const dataTotal       = transactions.filter(t => t.subType === 'data').reduce((s, t) => s + t.amount, 0);
    const personSendTotal = transactions.filter(t => t.subType === 'person_send').reduce((s, t) => s + t.amount, 0);
    const pochiTotal      = transactions.filter(t => t.subType === 'pochi_send').reduce((s, t) => s + t.amount, 0);
    const savingsTotal    = mshwariTotal + investmentTotal;
    const trueOutflow     = totalSent - savingsTotal;
    const net             = totalReceived - trueOutflow;

    const labelTotals: Record<string, number> = {};
    transactions.forEach(t => {
        const key = t.customLabel ?? t.label ?? 'Unlabelled';
        if (t.type === 'sent') {
            labelTotals[key] = (labelTotals[key] ?? 0) + t.amount;
        }
    });

    const hasLabels = transactions.some(t => t.label !== null);

    return {
        now, currentDate, currentTime, receiptRef,
        totalSent, totalReceived,
        personSendTotal, pochiTotal, paybillTotal,
        airtimeTotal, dataTotal, withdrawalTotal,
        mshwariTotal, investmentTotal,
        savingsTotal, trueOutflow, net,
        labelTotals, hasLabels,
    };
}

// ── HTML Receipt ─────────────────────────────────────────────────────────────

export function generateReceiptHTML(transactions: ParsedTransaction[], dateRange: string): string {
    const d = computeReceiptData(transactions);
    const W = 42;

    const lines: string[] = [
        repeat('=', W),
        center('M-TRACK', W),
        center('Mobile Money Receipt', W),
        repeat('-', W),
        leftRight('REF:', d.receiptRef, W),
        leftRight('DATE:', d.currentDate.toUpperCase(), W),
        leftRight('TIME:', d.currentTime, W),
        leftRight('PERIOD:', dateRange.toUpperCase(), W),
        repeat('=', W),
        '',
        center('TRANSACTION SUMMARY', W),
        repeat('-', W),
        leftRight('TRANSACTIONS', String(transactions.length), W),
        repeat('-', W),
        // Inflows
        leftRight('TOTAL RECEIVED', fmt(d.totalReceived), W),
        repeat('-', W),
        // Outflow breakdown
        leftRight('SENT TO PEOPLE', fmt(d.personSendTotal), W),
        leftRight('POCHI LA BIASHARA', fmt(d.pochiTotal), W),
        leftRight('PAYBILL & TILL', fmt(d.paybillTotal), W),
        leftRight('AIRTIME', fmt(d.airtimeTotal), W),
        leftRight('DATA BUNDLES', fmt(d.dataTotal), W),
        leftRight('WITHDRAWALS', fmt(d.withdrawalTotal), W),
        repeat('-', W),
        leftRight('TOTAL OUTFLOW', fmt(d.trueOutflow), W),
        repeat('-', W),
        // Savings (excluded from outflow)
        leftRight('M-SHWARI (SAVINGS)', fmt(d.mshwariTotal), W),
        leftRight('INVESTMENTS', fmt(d.investmentTotal), W),
        repeat('-', W),
        leftRight('NET FLOW', fmtSigned(d.net), W),
        center('(SAVINGS & INVESTMENTS EXCLUDED)', W),
        repeat('=', W),
    ];

    // KRA label breakdown
    if (d.hasLabels) {
        lines.push('');
        lines.push(center('EXPENSE BREAKDOWN BY CATEGORY', W));
        lines.push(repeat('-', W));
        Object.entries(d.labelTotals).forEach(([label, total]) => {
            lines.push(leftRight(label.substring(0, 26).toUpperCase(), fmt(total), W));
        });
        lines.push(repeat('=', W));
    }

    // Transaction detail
    lines.push('');
    lines.push(center('TRANSACTION DETAIL', W));
    lines.push(repeat('-', W));

    transactions.forEach((t, i) => {
        const dateStr = t.date.toLocaleDateString('en-GB');
        const sign = t.type === 'sent' ? '-' : '+';
        lines.push('');
        lines.push(leftRight(`${String(i + 1).padStart(2, '0')}. ${dateStr}`, t.time, W));
        lines.push(leftRight(`    ${getBadgeLabel(t)}`, `${sign}${fmt(t.amount)}`, W));
        lines.push(`    ${getDescription(t)}`);
        if (t.customLabel) {
            lines.push(`    NOTE: ${t.customLabel.toUpperCase()}`);
        } else if (t.label) {
            lines.push(`    LABEL: ${t.label.toUpperCase()}`);
        }
        lines.push(`    REF: ${t.transactionCode}`);
        if (t.balance != null) {
            lines.push(leftRight('    BAL:', fmt(t.balance), W));
        }
        lines.push(repeat('-', W));
    });

    lines.push('');
    lines.push(repeat('=', W));
    lines.push(center('GENERATED BY M-TRACK', W));
    lines.push(center(`REF: ${d.receiptRef}`, W));
    lines.push(repeat('=', W));
    lines.push('');

    const receiptText = lines.join('\n');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-TRACK Receipt ${d.receiptRef}</title>
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
            padding: 8px 28px 24px;
            width: 340px;
            box-shadow: 2px 4px 24px rgba(0,0,0,0.15);
        }
        .tear-bottom {
            width: 100%; height: 18px; background: white;
            clip-path: polygon(0% 0%, 2% 80%, 4% 20%, 6% 90%, 8% 30%, 10% 95%, 12% 35%, 14% 85%, 16% 25%, 18% 100%, 20% 40%, 22% 90%, 24% 30%, 26% 95%, 28% 35%, 30% 80%, 32% 20%, 34% 95%, 36% 30%, 38% 85%, 40% 25%, 42% 100%, 44% 40%, 46% 80%, 48% 20%, 50% 90%, 52% 35%, 54% 95%, 56% 30%, 58% 80%, 60% 20%, 62% 90%, 64% 25%, 66% 100%, 68% 40%, 70% 80%, 72% 20%, 74% 95%, 76% 30%, 78% 85%, 80% 25%, 82% 90%, 84% 35%, 86% 100%, 88% 40%, 90% 80%, 92% 20%, 94% 90%, 96% 30%, 98% 85%, 100% 20%, 100% 0%);
        }
        pre {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11.5px;
            line-height: 1.6;
            color: #1a1a1a;
            white-space: pre;
            overflow-x: auto;
        }
        @media print {
            body { background: white; padding: 0; }
            .tear-top, .tear-bottom { display: none; }
            .receipt { box-shadow: none; width: 100%; padding: 0; }
            pre { font-size: 10px; }
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
    // Estimate page height dynamically so there's no blank tail or clipping.
    // Each transaction entry is ~7 lines. Header/summary/footer ~55 lines.
    const estimatedLines = 55 + (transactions.length * 7);
    const pageHeight = Math.max(150, Math.min(estimatedLines * 4.2, 800));

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, pageHeight] });
    const d = computeReceiptData(transactions);

    doc.setFont('Courier', 'normal');
    const pageW = 80;
    const margin = 4;
    let y = 6;
    const lineH = 4;

    function addLine(text: string, size = 8, bold = false, align: 'left' | 'center' | 'right' = 'left') {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        if (align === 'center') doc.text(text, pageW / 2, y, { align: 'center' });
        else if (align === 'right') doc.text(text, pageW - margin, y, { align: 'right' });
        else doc.text(text, margin, y);
        y += lineH;
    }

    function addDivider(char = '-') { addLine(char.repeat(38), 7); }

    function addLR(left: string, right: string, size = 8, bold = false) {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        doc.text(left, margin, y);
        doc.text(right, pageW - margin, y, { align: 'right' });
        y += lineH;
    }

    function addSpacer() { y += lineH * 0.5; }

    // ── Header ──
    addDivider('=');
    addLine('M-TRACK', 14, true, 'center');
    addLine('Mobile Money Receipt', 8, false, 'center');
    addDivider('-');
    addLR('REF:', d.receiptRef, 7);
    addLR('DATE:', d.currentDate.toUpperCase(), 7);
    addLR('TIME:', d.currentTime, 7);
    addLR('PERIOD:', dateRange.toUpperCase(), 7);
    addDivider('=');
    addSpacer();

    // ── Summary ──
    addLine('TRANSACTION SUMMARY', 8, true, 'center');
    addDivider();
    addLR('TRANSACTIONS', String(transactions.length));
    addDivider();
    addLR('TOTAL RECEIVED', fmt(d.totalReceived), 8, true);
    addDivider();
    addLR('SENT TO PEOPLE', fmt(d.personSendTotal));
    addLR('POCHI LA BIASHARA', fmt(d.pochiTotal));
    addLR('PAYBILL & TILL', fmt(d.paybillTotal));
    addLR('AIRTIME', fmt(d.airtimeTotal));
    addLR('DATA BUNDLES', fmt(d.dataTotal));
    addLR('WITHDRAWALS', fmt(d.withdrawalTotal));
    addDivider();
    addLR('TOTAL OUTFLOW', fmt(d.trueOutflow), 8, true);
    addDivider();
    addLR('M-SHWARI (SAVINGS)', fmt(d.mshwariTotal));
    addLR('INVESTMENTS', fmt(d.investmentTotal));
    addDivider();
    addLR('NET FLOW', fmtSigned(d.net), 9, true);
    addLine('(SAVINGS & INVESTMENTS EXCL.)', 7, false, 'center');
    addDivider('=');

    // ── Label breakdown ──
    if (d.hasLabels) {
        addSpacer();
        addLine('EXPENSE BREAKDOWN', 8, true, 'center');
        addDivider();
        Object.entries(d.labelTotals).forEach(([label, total]) => {
            addLR(label.substring(0, 22).toUpperCase(), fmt(total), 7);
        });
        addDivider('=');
    }

    addSpacer();

    // ── Transaction detail ──
    addLine('TRANSACTION DETAIL', 8, true, 'center');
    addDivider();

    transactions.forEach((t, i) => {
        const dateStr = t.date.toLocaleDateString('en-GB');
        const sign = t.type === 'sent' ? '-' : '+';
        addSpacer();
        addLR(`${String(i + 1).padStart(2, '0')}. ${dateStr}`, t.time, 7);
        addLR(`    ${getBadgeLabel(t)}`, `${sign}${fmt(t.amount)}`, 8, true);
        addLine(`    ${getDescription(t)}`, 7);
        if (t.customLabel) addLine(`    NOTE: ${t.customLabel.toUpperCase()}`, 7);
        else if (t.label) addLine(`    LABEL: ${t.label.toUpperCase()}`, 7);
        addLine(`    REF: ${t.transactionCode}`, 7);
        if (t.balance != null) addLR('    BAL:', fmt(t.balance), 7);
        addDivider();
    });

    // ── Footer ──
    addSpacer();
    addDivider('=');
    addLine('GENERATED BY M-TRACK', 7, false, 'center');
    addLine(`REF: ${d.receiptRef}`, 7, false, 'center');
    addDivider('=');

    return doc.output('blob');
}