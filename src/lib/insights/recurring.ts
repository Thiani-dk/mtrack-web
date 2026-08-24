import type { ParsedTransaction } from '../../types';

export interface RecurringPattern {
    id: string;
    recipient: string;          // normalised recipient/merchant name (display form)
    merchantCategory: string | null;
    occurrences: ParsedTransaction[];
    cadence: 'weekly' | 'fortnightly' | 'monthly' | 'irregular';
    averageAmount: number;
    amountVariance: number;     // stddev / mean, 0 = identical every time
    isFixedAmount: boolean;     // variance under 5%
    confidence: number;         // 0-100
    nextExpected: Date | null;  // projected, null if irregular
    totalPaid: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RECURRING_CATEGORIES = new Set([
    'Streaming & Subscriptions',
    'Utilities',
    'Banking & Transfers',
]);

function displayName(t: ParsedTransaction): string {
    return t.merchant ?? t.recipient;
}

// Lowercase, strip phone numbers (plain and masked), strip punctuation,
// collapse whitespace — "KEVIN ELIJAH", "Kevin  Elijah" and
// "KEVIN ELIJAH 0740755525" must all group together.
function normaliseRecipient(name: string): string {
    let s = name.toLowerCase();
    s = s.replace(/\s*\+?(?:254|0)[17]\d{8}\b/g, '');
    s = s.replace(/\s*0\d{3}\*{2,3}\d{3}\b/g, '');
    s = s.replace(/[.,\-_/]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function mean(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stddev(nums: number[], avg: number): number {
    if (nums.length === 0) return 0;
    const variance = nums.reduce((s, n) => s + (n - avg) ** 2, 0) / nums.length;
    return Math.sqrt(variance);
}

function gapsInDays(sorted: ParsedTransaction[]): number[] {
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        gaps.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / MS_PER_DAY);
    }
    return gaps;
}

function determineCadence(gaps: number[], allowMonthly: boolean): RecurringPattern['cadence'] {
    if (gaps.length === 0) return 'irregular';
    const avgGap = mean(gaps);
    const sd = stddev(gaps, avgGap);
    // Noisy gaps never count as a cadence, regardless of the mean.
    if (avgGap <= 0 || sd / avgGap > 0.25) return 'irregular';
    if (avgGap >= 6 && avgGap <= 8) return 'weekly';
    if (avgGap >= 13 && avgGap <= 16) return 'fortnightly';
    if (allowMonthly && avgGap >= 27 && avgGap <= 33) return 'monthly';
    return 'irregular';
}

function scoreConfidence(
    occCount: number,
    cadence: RecurringPattern['cadence'],
    isFixedAmount: boolean,
    category: string | null
): number {
    let score = 0;
    if (occCount >= 3) score += 40;
    else if (occCount === 2) score += 20;
    if (cadence !== 'irregular') score += 30;
    if (isFixedAmount) score += 20;
    if (category && RECURRING_CATEGORIES.has(category)) score += 10;
    return Math.min(100, score);
}

function mostCommonName(occurrences: ParsedTransaction[]): string {
    const counts = new Map<string, number>();
    for (const t of occurrences) {
        const name = displayName(t);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let best = displayName(occurrences[0]);
    let bestCount = 0;
    for (const [name, count] of counts) {
        if (count > bestCount) {
            best = name;
            bestCount = count;
        }
    }
    return best;
}

// Recurring detection runs on the in-range, non-excluded set only — callers
// are responsible for that filtering before calling in.
export function detectRecurring(transactions: ParsedTransaction[]): RecurringPattern[] {
    const sent = transactions.filter(t => t.type === 'sent');
    if (sent.length === 0) return [];

    // A 7-day date range cannot detect monthly patterns — only run monthly
    // detection if the whole batch spans at least 45 days.
    const times = sent.map(t => t.date.getTime());
    const spanDays = (Math.max(...times) - Math.min(...times)) / MS_PER_DAY;
    const allowMonthly = spanDays >= 45;

    const groups = new Map<string, ParsedTransaction[]>();
    for (const t of sent) {
        const key = normaliseRecipient(displayName(t));
        if (!key) continue;
        const bucket = groups.get(key) ?? [];
        bucket.push(t);
        groups.set(key, bucket);
    }

    const patterns: RecurringPattern[] = [];

    for (const [key, occurrences] of groups) {
        if (occurrences.length < 2) continue;

        const sorted = [...occurrences].sort((a, b) => a.date.getTime() - b.date.getTime());
        const gaps = gapsInDays(sorted);
        const avgGap = mean(gaps);
        const cadence = determineCadence(gaps, allowMonthly);

        const amounts = sorted.map(t => t.amount);
        const avgAmount = mean(amounts);
        const amtSd = stddev(amounts, avgAmount);
        const amountVariance = avgAmount > 0 ? amtSd / avgAmount : 0;
        const isFixedAmount = amountVariance < 0.05;

        const category = sorted.find(t => t.merchantCategory)?.merchantCategory ?? null;

        const confidence = scoreConfidence(sorted.length, cadence, isFixedAmount, category);
        if (confidence < 40) continue;

        const lastDate = sorted[sorted.length - 1].date;
        const nextExpected = cadence !== 'irregular' && avgGap > 0
            ? new Date(lastDate.getTime() + avgGap * MS_PER_DAY)
            : null;

        patterns.push({
            id: `recurring-${key}`,
            recipient: mostCommonName(sorted),
            merchantCategory: category,
            occurrences: sorted,
            cadence,
            averageAmount: avgAmount,
            amountVariance,
            isFixedAmount,
            confidence,
            nextExpected,
            totalPaid: amounts.reduce((s, n) => s + n, 0),
        });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence || b.totalPaid - a.totalPaid);
}
