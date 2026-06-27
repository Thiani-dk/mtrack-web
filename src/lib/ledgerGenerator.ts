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
        case 'paybill':        return 'Paybill/Till';
        case 'airtime':        return 'Airtime';
        case 'withdrawal':     return 'Withdrawal';
        case 'mshwari':        return 'M-Shwari Transfer';
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
        'Sent (Ksh)',
        'Received (Ksh)',
        'Running Balance (Ksh)'
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
            escapeCSVField(t.type === 'sent'     ? t.amount.toFixed(2) : ''),
            escapeCSVField(t.type === 'received' ? t.amount.toFixed(2) : ''),
            escapeCSVField(runningBalance.toFixed(2))
        ].join(',');
    });

    return [header, ...rows].join('\n');
}

export function generateLedgerSummaryCSV(transactions: ParsedTransaction[]): string {
    const dailySummaries: Record<string, {
        date: Date;
        personSend: number;
        paybill: number;
        airtime: number;
        withdrawal: number;
        mshwari: number;
        received: number;
        count: number;
    }> = {};

    transactions.forEach(t => {
        const dateKey = t.date.toLocaleDateString('en-GB');
        if (!dailySummaries[dateKey]) {
            dailySummaries[dateKey] = {
                date: t.date,
                personSend: 0,
                paybill: 0,
                airtime: 0,
                withdrawal: 0,
                mshwari: 0,
                received: 0,
                count: 0
            };
        }
        const day = dailySummaries[dateKey];
        day.count++;
        switch (t.subType) {
            case 'person_send':    day.personSend += t.amount; break;
            case 'paybill':        day.paybill    += t.amount; break;
            case 'airtime':        day.airtime    += t.amount; break;
            case 'withdrawal':     day.withdrawal += t.amount; break;
            case 'mshwari':        day.mshwari    += t.amount; break;
            case 'person_receive': day.received   += t.amount; break;
        }
    });

    const header = [
        'Date',
        'Send Money (Ksh)',
        'Paybill & Till (Ksh)',
        'Airtime (Ksh)',
        'Withdrawals (Ksh)',
        'M-Shwari Transfers (Ksh)',
        'Received (Ksh)',
        'Net Flow (Ksh)',
        'Transaction Count'
    ].join(',');

    const rows = Object.values(dailySummaries).map(day => {
        const trueOutflow = day.personSend + day.paybill + day.airtime + day.withdrawal;
        const net = day.received - trueOutflow;
        return [
            escapeCSVField(day.date.toLocaleDateString('en-GB')),
            escapeCSVField(day.personSend.toFixed(2)),
            escapeCSVField(day.paybill.toFixed(2)),
            escapeCSVField(day.airtime.toFixed(2)),
            escapeCSVField(day.withdrawal.toFixed(2)),
            escapeCSVField(day.mshwari.toFixed(2)),
            escapeCSVField(day.received.toFixed(2)),
            escapeCSVField(net.toFixed(2)),
            escapeCSVField(day.count)
        ].join(',');
    });

    return [header, ...rows].join('\n');
}