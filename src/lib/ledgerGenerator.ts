import { ParsedTransaction } from '../types';

function escapeCSVField(field: string | number): string {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

export function generateLedgerCSV(transactions: ParsedTransaction[], dateRange: string): string {
    let csv = 'Date,Time,Transaction Code,Type,Description,Amount (Ksh),Running Balance (Ksh)\n';
    
    let runningBalance = 0;
    transactions.forEach(t => {
        runningBalance = t.balance ?? runningBalance;
        csv += [
            escapeCSVField(t.date.toLocaleDateString('en-GB')),
            escapeCSVField(t.time),
            escapeCSVField(t.transactionCode),
            escapeCSVField(t.type),
            escapeCSVField(t.recipient),
            escapeCSVField(t.amount.toFixed(2)),
            escapeCSVField(runningBalance.toFixed(2))
        ].join(',') + '\n';
    });

    return csv;
}

export function generateLedgerSummaryCSV(transactions: ParsedTransaction[]): string {
    const dailySummaries: Record<string, {
        date: Date,
        totalSent: number,
        totalReceived: number,
        count: number
    }> = {};

    transactions.forEach(t => {
        const dateKey = t.date.toLocaleDateString('en-GB');
        if (!dailySummaries[dateKey]) {
            dailySummaries[dateKey] = {
                date: t.date,
                totalSent: 0,
                totalReceived: 0,
                count: 0
            };
        }

        const day = dailySummaries[dateKey];
        day.count++;
        if (t.type === 'sent') {
            day.totalSent += t.amount;
        } else {
            day.totalReceived += t.amount;
        }
    });

    let csv = 'Date,Total Sent (Ksh),Total Received (Ksh),Net (Ksh),Transaction Count\n';
    Object.values(dailySummaries).forEach(day => {
        const net = day.totalReceived - day.totalSent;
        csv += [
            escapeCSVField(day.date.toLocaleDateString('en-GB')),
            escapeCSVField(day.totalSent.toFixed(2)),
            escapeCSVField(day.totalReceived.toFixed(2)),
            escapeCSVField(net.toFixed(2)),
            escapeCSVField(day.count)
        ].join(',') + '\n';
    });

    return csv;
}
