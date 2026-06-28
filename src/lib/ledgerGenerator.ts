import type { ParsedTransaction } from '../types';

function escapeCSVField(field: string | number): string {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function getTypeLabel(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'person_send':    return 'Send Money';
        case 'person_receive': return 'Receive Money';
        case 'pochi_send':     return 'Pochi la Biashara';
        case 'paybill':        return 'Paybill/Till';
        case 'airtime':        return 'Airtime';
        case 'data':           return 'Data Bundle';
        case 'withdrawal':     return 'Withdrawal';
        case 'mshwari':        return 'M-Shwari Transfer';
        case 'investment':     return 'Investment (ZIIDI)';
        default:               return t.type;
    }
}

export function generateLedgerCSV(transactions: ParsedTransaction[], _dateRange: string): string {
    const header = [
        'Date',
        'Time',
        'Transaction Code',
        'Category',
        'Description',
        'KRA Label',
        'Custom Note',
        'Sent (Ksh)',
        'Received (Ksh)',
        'Running Balance (Ksh)',
    ].join(',');

    let runningBalance = 0;
    const rows = transactions.map(t => {
        runningBalance = t.balance ?? runningBalance;
        return [
            escapeCSVField(t.date.toLocaleDateString('en-GB')),
            escapeCSVField(t.time),
            escapeCSVField(t.transactionCode),
            escapeCSVField(getTypeLabel(t)),
            escapeCSVField(t.recipient),
            escapeCSVField(t.label ?? ''),
            escapeCSVField(t.customLabel ?? ''),
            escapeCSVField(t.type === 'sent'     ? t.amount.toFixed(2) : ''),
            escapeCSVField(t.type === 'received' ? t.amount.toFixed(2) : ''),
            escapeCSVField(runningBalance.toFixed(2)),
        ].join(',');
    });

    return [header, ...rows].join('\n');
}

export function generateLedgerSummaryCSV(transactions: ParsedTransaction[]): string {
    // Group by KRA label first, then by date within each label
    const byLabel: Record<string, ParsedTransaction[]> = {};

    transactions.forEach(t => {
        const key = t.customLabel ?? t.label ?? 'Unlabelled';
        if (!byLabel[key]) byLabel[key] = [];
        byLabel[key].push(t);
    });

    const header = [
        'KRA Label',
        'Custom Note',
        'Date',
        'Transaction Code',
        'Category',
        'Description',
        'Sent (Ksh)',
        'Received (Ksh)',
        'Label Total Sent (Ksh)',
        'Label Total Received (Ksh)',
    ].join(',');

    const rows: string[] = [];

    Object.entries(byLabel).forEach(([labelKey, group]) => {
        const labelTotalSent = group.filter(t => t.type === 'sent').reduce((s, t) => s + t.amount, 0);
        const labelTotalReceived = group.filter(t => t.type === 'received').reduce((s, t) => s + t.amount, 0);

        group.forEach(t => {
            rows.push([
                escapeCSVField(t.label ?? 'Unlabelled'),
                escapeCSVField(t.customLabel ?? ''),
                escapeCSVField(t.date.toLocaleDateString('en-GB')),
                escapeCSVField(t.transactionCode),
                escapeCSVField(getTypeLabel(t)),
                escapeCSVField(t.recipient),
                escapeCSVField(t.type === 'sent'     ? t.amount.toFixed(2) : ''),
                escapeCSVField(t.type === 'received' ? t.amount.toFixed(2) : ''),
                escapeCSVField(labelTotalSent.toFixed(2)),
                escapeCSVField(labelTotalReceived.toFixed(2)),
            ].join(','));
        });

        // Subtotal row per label
        rows.push([
            escapeCSVField(`SUBTOTAL: ${labelKey}`),
            '',
            '',
            '',
            '',
            '',
            escapeCSVField(labelTotalSent.toFixed(2)),
            escapeCSVField(labelTotalReceived.toFixed(2)),
            '',
            '',
        ].join(','));

        rows.push(''); // blank line between label groups
    });

    return [header, ...rows].join('\n');
}