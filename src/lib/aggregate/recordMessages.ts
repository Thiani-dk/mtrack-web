import type { AllTimeStats } from './allTimeStore';

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Only mentions a record if it was actually beaten by this session — never
// lists records that weren't touched, and never fires on the very first
// session (there's nothing to have "beaten" yet).
export function describeNewRecords(before: AllTimeStats | undefined, after: AllTimeStats): string[] {
    if (after.sessionCount < 2 || !before) return [];

    const messages: string[] = [];
    const b = before.records;
    const a = after.records;

    if (a.lowestFeeMonth && (!b.lowestFeeMonth || a.lowestFeeMonth.amount < b.lowestFeeMonth.amount)) {
        messages.push(`That's your lowest fee month yet — ${fmt(a.lowestFeeMonth.amount)}.`);
    }

    if (a.mostTransactionsInOneSummary > b.mostTransactionsInOneSummary) {
        messages.push(`Most transactions you've sorted in one go: ${a.mostTransactionsInOneSummary}.`);
    }

    if (a.largestSingleTransaction && a.largestSingleTransaction.amount > (b.largestSingleTransaction?.amount ?? 0)) {
        messages.push(`Biggest single payment you've tracked: ${fmt(a.largestSingleTransaction.amount)}.`);
    }

    return messages;
}
