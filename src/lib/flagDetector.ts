import type { ParsedTransaction } from '../types';

export interface DangerFlag {
    id: string;
    severity: 'warning' | 'info';
    title: string;
    detail: string;
    matchedTransactions: ParsedTransaction[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}`;
}

function groupByMonth<T>(items: T[], getDate: (item: T) => Date): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = monthKey(getDate(item));
        const bucket = map.get(key) ?? [];
        bucket.push(item);
        map.set(key, bucket);
    }
    return map;
}

// ── Flag detectors ────────────────────────────────────────────────────────────

/** Flag 1 — Salary signature: same sender, same amount ±10%, day 24–31, 3+ months */
function detectSalarySignature(transactions: ParsedTransaction[]): DangerFlag | null {
    const credits = transactions.filter(t => t.subType === 'person_receive');

    const bySender = new Map<string, ParsedTransaction[]>();
    for (const t of credits) {
        const key = t.recipient.toLowerCase().trim();
        const bucket = bySender.get(key) ?? [];
        bucket.push(t);
        bySender.set(key, bucket);
    }

    for (const [, txns] of bySender) {
        if (txns.length < 3) continue;

        const lateMonth = txns.filter(t => t.date.getDate() >= 24);
        if (lateMonth.length < 3) continue;

        const byMonth = groupByMonth(lateMonth, t => t.date);
        const monthEntries = [...byMonth.entries()];
        if (monthEntries.length < 3) continue;

        const reps = monthEntries.map(([, bucket]) => bucket[0]);
        const repAmounts = reps.map(t => t.amount);
        const sorted = [...repAmounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        const qualifying = reps.filter(t => Math.abs(t.amount - median) / median <= 0.1);
        if (qualifying.length >= 3) {
            return {
                id: 'salary_signature',
                severity: 'warning',
                title: 'Recurring salary-like credits detected',
                detail: 'Consistent same-amount inflows near month-end may indicate employment income to KRA.',
                matchedTransactions: qualifying,
            };
        }
    }
    return null;
}

/** Flag 2 — High inflow volume: received > Ksh 50,000 in any single month */
function detectHighInflowVolume(transactions: ParsedTransaction[]): DangerFlag | null {
    const credits = transactions.filter(t => t.subType === 'person_receive');
    const byMonth = groupByMonth(credits, t => t.date);

    for (const [, txns] of byMonth) {
        const total = txns.reduce((sum, t) => sum + t.amount, 0);
        if (total > 50000) {
            return {
                id: 'high_inflow_volume',
                severity: 'warning',
                title: 'Monthly inflow exceeds Ksh 50,000',
                detail: 'KRA may treat high inflow volume as evidence of business or employment income.',
                matchedTransactions: txns,
            };
        }
    }
    return null;
}

/** Flag 3 — Many unique senders: >10 unique senders in any single month */
function detectManyUniqueSenders(transactions: ParsedTransaction[]): DangerFlag | null {
    const credits = transactions.filter(t => t.subType === 'person_receive');
    const byMonth = groupByMonth(credits, t => t.date);

    for (const [, txns] of byMonth) {
        const uniqueSenders = new Set(txns.map(t => t.recipient.toLowerCase().trim()));
        if (uniqueSenders.size > 10) {
            return {
                id: 'many_unique_senders',
                severity: 'info',
                title: 'High number of unique senders',
                detail: '10+ unique people sending you money monthly may indicate informal business activity.',
                matchedTransactions: txns,
            };
        }
    }
    return null;
}

/** Flag 4 — Circular transactions: sent to X, received back from X within 72h, ±15% */
function detectCircularTransactions(transactions: ParsedTransaction[]): DangerFlag | null {
    const sent     = transactions.filter(t => t.subType === 'person_send');
    const received = transactions.filter(t => t.subType === 'person_receive');

    const MS_72H = 72 * 60 * 60 * 1000;
    const matched: ParsedTransaction[] = [];

    for (const out of sent) {
        const senderKey = out.recipient.toLowerCase().trim();
        for (const inn of received) {
            const recipientKey = inn.recipient.toLowerCase().trim();
            if (recipientKey !== senderKey) continue;

            const timeDiff = Math.abs(inn.date.getTime() - out.date.getTime());
            if (timeDiff > MS_72H) continue;

            const amountDiff = Math.abs(inn.amount - out.amount) / out.amount;
            if (amountDiff <= 0.15) {
                if (!matched.find(m => m.transactionCode === out.transactionCode)) matched.push(out);
                if (!matched.find(m => m.transactionCode === inn.transactionCode)) matched.push(inn);
            }
        }
    }

    if (matched.length > 0) {
        return {
            id: 'circular_transactions',
            severity: 'warning',
            title: 'Possible circular transactions',
            detail: 'Money sent and returned between the same parties can raise questions during audits.',
            matchedTransactions: matched,
        };
    }
    return null;
}

/** Flag 5 — Betting activity: paybill/send to known betting operators */
const BETTING_KEYWORDS = ['sportpesa', 'betika', 'odibets', 'shabiki', 'mcheza', 'betin', 'premiumbets'];

function detectBettingActivity(transactions: ParsedTransaction[]): DangerFlag | null {
    const matched = transactions.filter(t => {
        if (t.type !== 'sent') return false;
        const name = t.recipient.toLowerCase();
        return BETTING_KEYWORDS.some(kw => name.includes(kw));
    });

    if (matched.length > 0) {
        return {
            id: 'betting_activity',
            severity: 'info',
            title: 'Betting transactions detected',
            detail: 'Gambling activity is visible in M-PESA data and may be noted in credit assessments.',
            matchedTransactions: matched,
        };
    }
    return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function detectFlags(transactions: ParsedTransaction[]): DangerFlag[] {
    const checks = [
        detectSalarySignature,
        detectHighInflowVolume,
        detectManyUniqueSenders,
        detectCircularTransactions,
        detectBettingActivity,
    ];

    const flags: DangerFlag[] = [];
    for (const check of checks) {
        const flag = check(transactions);
        if (flag) flags.push(flag);
    }
    return flags;
}