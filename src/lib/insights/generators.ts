import type { ParsedTransaction } from '../../types';
import type { Insight, InsightContext } from './types';
import { fmtProse, fmtPercent, joinNatural } from '../transactionDisplay';
import { detectRecurring } from './recurring';

type Generator = (txns: ParsedTransaction[], ctx: InsightContext) => Insight | null;

// ── Shared helpers ───────────────────────────────────────────────────────────

// "Real" spending — sent, excluding transfers into savings/investment
// vehicles, matching the convention already used across receiptGenerator.
function spendTxns(txns: ParsedTransaction[]): ParsedTransaction[] {
    return txns.filter(t => t.type === 'sent' && t.subType !== 'mshwari' && t.subType !== 'investment');
}

function sumAmount(txns: ParsedTransaction[]): number {
    return txns.reduce((s, t) => s + t.amount, 0);
}

function displayName(t: ParsedTransaction): string {
    return t.merchant ?? t.recipient;
}

const METHOD_LABELS: Record<string, string> = {
    p2p: 'Person-to-person', p2p_in: 'Person-to-person', till: 'Shopping',
    paybill: 'Bills & payments', card: 'Card purchases', airtime: 'Airtime',
    data: 'Data bundles', cash: 'Cash withdrawals', savings: 'Savings', transfer: 'Transfers',
};

function methodLabel(method: string): string {
    return METHOD_LABELS[method] ?? 'Other spending';
}

// ── 1. Fee total + projection ────────────────────────────────────────────────

const feeTotal: Generator = (txns, ctx) => {
    const paid = txns.filter(t => (t.transactionCost ?? 0) > 0);
    const total = paid.reduce((s, t) => s + (t.transactionCost ?? 0), 0);
    if (total <= 0) return null;

    let detail: string | undefined;
    if (ctx.dayCount >= 5) {
        const annualRaw = (total / ctx.dayCount) * 365;
        const annual = Math.round(annualRaw / 100) * 100;
        if (annual > 0) detail = `At this rate that's about ${fmtProse(annual)} a year.`;
    }

    return {
        id: 'fee_total',
        kind: 'fee_total',
        priority: 90,
        headline: `You paid ${fmtProse(total)} in M-PESA fees ${ctx.dateRangeLabel}.`,
        detail,
        evidence: paid.map(t => t.transactionCode),
        shareable: true,
    };
};

// ── 2. Top category ──────────────────────────────────────────────────────────

const topCategory: Generator = (txns) => {
    const spend = spendTxns(txns);
    const total = sumAmount(spend);
    if (total <= 0) return null;

    const groups = new Map<string, ParsedTransaction[]>();
    for (const t of spend) {
        const key = t.merchantCategory ?? t.receiptLabel ?? methodLabel(t.method);
        const bucket = groups.get(key) ?? [];
        bucket.push(t);
        groups.set(key, bucket);
    }

    let topKey: string | null = null;
    let topTxns: ParsedTransaction[] = [];
    let topTotal = 0;
    for (const [key, bucket] of groups) {
        const bucketTotal = sumAmount(bucket);
        if (bucketTotal > topTotal) {
            topTotal = bucketTotal;
            topKey = key;
            topTxns = bucket;
        }
    }
    if (!topKey) return null;

    const pct = (topTotal / total) * 100;
    if (pct < 30) return null;

    const byRecipient = new Map<string, number>();
    for (const t of topTxns) {
        const name = displayName(t);
        byRecipient.set(name, (byRecipient.get(name) ?? 0) + t.amount);
    }
    const topRecipients = [...byRecipient.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name);

    return {
        id: 'top_category',
        kind: 'top_category',
        priority: 85,
        headline: `${topKey} took the biggest bite — ${fmtProse(topTotal)}, ${fmtPercent(pct)} of everything you spent.`,
        detail: topRecipients.length > 0 ? `Mostly ${joinNatural(topRecipients)}.` : undefined,
        evidence: topTxns.map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 3. Biggest single payment ────────────────────────────────────────────────

const biggestSingle: Generator = (txns) => {
    const spend = spendTxns(txns);
    if (spend.length === 0) return null;
    const total = sumAmount(spend);
    if (total <= 0) return null;

    const biggest = spend.reduce((max, t) => (t.amount > max.amount ? t : max), spend[0]);
    const pct = (biggest.amount / total) * 100;
    if (pct < 20) return null;

    return {
        id: 'biggest_single',
        kind: 'biggest_single',
        priority: 70,
        headline: `Your biggest single payment was ${fmtProse(biggest.amount)} to ${displayName(biggest)}.`,
        evidence: [biggest.transactionCode],
        shareable: false,
    };
};

// ── 4. Subscription load ─────────────────────────────────────────────────────

const subscriptionLoad: Generator = (txns, ctx) => {
    const subs = txns.filter(t =>
        t.type === 'sent' &&
        (t.merchantCategory === 'Streaming & Subscriptions' || t.merchantCategory === 'Gaming')
    );
    if (subs.length === 0) return null;

    const byMerchant = new Map<string, number>();
    for (const t of subs) {
        const name = displayName(t);
        byMerchant.set(name, (byMerchant.get(name) ?? 0) + t.amount);
    }
    if (byMerchant.size < 2) return null;

    const total = sumAmount(subs);
    if (total <= 0) return null;
    const names = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

    let detail = `That's ${names.join(', ')}.`;
    if (ctx.dayCount >= 14) {
        const monthly = Math.round(((total / ctx.dayCount) * 30) / 10) * 10;
        if (monthly > 0) detail += ` Roughly ${fmtProse(monthly)} a month at this pace.`;
    }

    return {
        id: 'subscription_load',
        kind: 'subscription_load',
        priority: 88,
        headline: `You're running ${byMerchant.size} subscriptions — ${fmtProse(total)} ${ctx.dateRangeLabel}.`,
        detail,
        evidence: subs.map(t => t.transactionCode),
        shareable: true,
    };
};

// ── 5. Business vs personal ──────────────────────────────────────────────────

const businessVsPersonal: Generator = (txns) => {
    const spend = spendTxns(txns);
    const business = spend.filter(t => t.isBusiness);
    const personal = spend.filter(t => !t.isBusiness);
    if (business.length < 2 || personal.length < 2) return null;

    const total = sumAmount(spend);
    if (total <= 0) return null;
    const bizPct = (sumAmount(business) / total) * 100;

    return {
        id: 'business_vs_personal',
        kind: 'business_vs_personal',
        priority: 60,
        headline: `${fmtPercent(bizPct)} of your spending went to businesses, ${fmtPercent(100 - bizPct)} to people.`,
        evidence: spend.map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 6. Busiest day ────────────────────────────────────────────────────────────

const busiestDay: Generator = (txns) => {
    if (txns.length === 0) return null;

    const byDay = new Map<string, ParsedTransaction[]>();
    for (const t of txns) {
        const key = t.date.toDateString();
        const bucket = byDay.get(key) ?? [];
        bucket.push(t);
        byDay.set(key, bucket);
    }
    const days = [...byDay.values()];
    if (days.length === 0) return null;

    const busiest = days.reduce((max, d) => (d.length > max.length ? d : max), days[0]);
    if (busiest.length < 3) return null;

    const avgPerDay = txns.length / days.length;
    if (busiest.length < avgPerDay * 1.25) return null;

    const amount = sumAmount(busiest);
    if (amount <= 0) return null;

    const weekday = busiest[0].date.toLocaleDateString('en-GB', { weekday: 'long' });
    return {
        id: 'busiest_day',
        kind: 'busiest_day',
        priority: 50,
        headline: `${weekday} was your busiest — ${busiest.length} transactions, ${fmtProse(amount)}.`,
        evidence: busiest.map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 7. Spend velocity ────────────────────────────────────────────────────────

const spendVelocity: Generator = (txns, ctx) => {
    if (ctx.dayCount < 7) return null;

    const spend = spendTxns(txns);
    const total = sumAmount(spend);
    if (total <= 0) return null;
    const perDay = total / ctx.dayCount;

    const sorted = [...spend].sort((a, b) => a.date.getTime() - b.date.getTime());
    const minTime = sorted[0].date.getTime();
    const maxTime = sorted[sorted.length - 1].date.getTime();
    const midTime = (minTime + maxTime) / 2;
    const firstHalf = sumAmount(sorted.filter(t => t.date.getTime() <= midTime));
    const secondHalf = sumAmount(sorted.filter(t => t.date.getTime() > midTime));

    let detail: string | undefined;
    if (firstHalf > 0) {
        const change = (secondHalf - firstHalf) / firstHalf;
        if (change > 0.15) detail = 'Spending picked up in the second half.';
        else if (change < -0.15) detail = 'You eased off toward the end.';
    }

    return {
        id: 'spend_velocity',
        kind: 'spend_velocity',
        priority: 65,
        headline: `You averaged ${fmtProse(perDay)} a day.`,
        detail,
        evidence: spend.map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 8. Inflow vs outflow ─────────────────────────────────────────────────────

const inflowOutflow: Generator = (txns) => {
    const received = txns.filter(t => t.type === 'received');
    if (received.length === 0) return null;
    const totalReceived = sumAmount(received);
    if (totalReceived <= 0) return null;

    const spend = spendTxns(txns);
    const net = totalReceived - sumAmount(spend);
    if (net === 0) return null;

    return {
        id: 'inflow_outflow',
        kind: 'inflow_outflow',
        priority: 75,
        headline: net > 0
            ? `You came out ahead by ${fmtProse(net)}.`
            : `You spent ${fmtProse(Math.abs(net))} more than came in.`,
        evidence: [...received, ...spend].map(t => t.transactionCode),
        shareable: true,
    };
};

// ── 9. Merchant frequency ────────────────────────────────────────────────────

const merchantFrequency: Generator = (txns) => {
    const spend = spendTxns(txns);
    const byName = new Map<string, ParsedTransaction[]>();
    for (const t of spend) {
        const name = displayName(t);
        const bucket = byName.get(name) ?? [];
        bucket.push(t);
        byName.set(name, bucket);
    }

    let topName: string | null = null;
    let topBucket: ParsedTransaction[] = [];
    for (const [name, bucket] of byName) {
        if (bucket.length > topBucket.length) {
            topName = name;
            topBucket = bucket;
        }
    }
    if (!topName || topBucket.length < 3) return null;

    const total = sumAmount(topBucket);
    if (total <= 0) return null;

    return {
        id: 'merchant_frequency',
        kind: 'merchant_frequency',
        priority: 55,
        headline: `${topName} saw you ${topBucket.length} times — ${fmtProse(total)} altogether.`,
        evidence: topBucket.map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 10. Small spend creep ────────────────────────────────────────────────────

const smallSpendCreep: Generator = (txns) => {
    const small = spendTxns(txns).filter(t => t.amount < 200);
    if (small.length < 8) return null;
    const total = sumAmount(small);
    if (total < 1000) return null;

    return {
        id: 'small_spend_creep',
        kind: 'small_spend_creep',
        priority: 45,
        headline: `${small.length} small payments under Ksh 200 added up to ${fmtProse(total)}.`,
        detail: 'Easy to miss individually.',
        evidence: small.map(t => t.transactionCode),
        shareable: true,
    };
};

// ── 11. Recurring payments ───────────────────────────────────────────────────

const recurring: Generator = (txns, ctx) => {
    const patterns = detectRecurring(txns);
    if (patterns.length === 0) return null;

    // Be honest rather than showing false confidence: if this batch is too
    // short to have caught monthly patterns, and a longer-range session
    // exists in history, say so instead of naming specific merchants.
    if (ctx.dayCount < 45 && ctx.longerRangeAvailable) {
        return {
            id: 'recurring',
            kind: 'recurring',
            priority: 80,
            headline: `Found ${patterns.length} payment${patterns.length === 1 ? '' : 's'} that look regular.`,
            detail: `Only looking at ${ctx.dayCount} days here — run a longer range to spot monthly patterns.`,
            evidence: patterns.flatMap(p => p.occurrences.map(o => o.transactionCode)),
            shareable: false,
        };
    }

    const topByAmount = [...patterns].sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 2);
    const detail = topByAmount.map(p => `${p.recipient}, ${p.cadence}.`).join(' ');

    return {
        id: 'recurring',
        kind: 'recurring',
        priority: 80,
        headline: `Found ${patterns.length} payment${patterns.length === 1 ? '' : 's'} that look regular.`,
        detail,
        evidence: patterns.flatMap(p => p.occurrences.map(o => o.transactionCode)),
        shareable: false,
    };
};

// ── 12. Comparison (cross-session) ───────────────────────────────────────────

function shiftMonthKey(key: string, delta: number): string {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const comparison: Generator = (txns, ctx) => {
    const stats = ctx.allTimeStats;
    if (!stats || stats.sessionCount < 2) return null;

    const spend = spendTxns(txns);
    if (spend.length === 0) return null;

    // Which month does this batch mostly represent? Use the latest date.
    const latest = spend.reduce((max, t) => (t.date > max ? t.date : max), spend[0].date);
    const thisMonthKey = `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}`;
    const prevBucket = stats.monthly[shiftMonthKey(thisMonthKey, -1)];
    if (!prevBucket) return null;

    const thisCategoryTotals = new Map<string, number>();
    for (const t of spend) {
        const key = t.merchantCategory ?? t.receiptLabel;
        if (!key) continue;
        thisCategoryTotals.set(key, (thisCategoryTotals.get(key) ?? 0) + t.amount);
    }

    let biggest: { category: string; pctChange: number } | null = null;
    for (const [category, amount] of thisCategoryTotals) {
        const prevAmount = prevBucket.categoryTotals[category];
        if (!prevAmount || prevAmount <= 0) continue;
        const pctChange = ((amount - prevAmount) / prevAmount) * 100;
        if (Math.abs(pctChange) <= 20) continue;
        if (!biggest || Math.abs(pctChange) > Math.abs(biggest.pctChange)) {
            biggest = { category, pctChange };
        }
    }
    if (!biggest) return null;

    const direction = biggest.pctChange > 0 ? 'up' : 'down';
    return {
        id: 'comparison',
        kind: 'comparison',
        priority: 82,
        headline: `${biggest.category} is ${direction} ${fmtPercent(Math.abs(biggest.pctChange))} on last month.`,
        evidence: spend.filter(t => (t.merchantCategory ?? t.receiptLabel) === biggest!.category).map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 13. Fee trend (cross-session) ────────────────────────────────────────────

const feeTrendVsHistory: Generator = (txns, ctx) => {
    const stats = ctx.allTimeStats;
    if (!stats || stats.sessionCount < 2) return null;

    const thisFees = txns.reduce((s, t) => s + (t.transactionCost ?? 0), 0);
    if (thisFees <= 0) return null;

    const monthCount = Object.keys(stats.monthly).length;
    if (monthCount === 0) return null;
    const avgMonthlyFees = stats.totalFees / monthCount;
    if (avgMonthlyFees <= 0) return null;

    const change = (thisFees - avgMonthlyFees) / avgMonthlyFees;
    if (Math.abs(change) < 0.15) return null;

    return {
        id: 'fee_trend',
        kind: 'fee_trend',
        priority: 78,
        headline: `Your fees are running ${change > 0 ? 'higher' : 'lower'} than usual this time.`,
        detail: `${fmtProse(thisFees)} vs your usual ${fmtProse(avgMonthlyFees)}.`,
        evidence: txns.filter(t => (t.transactionCost ?? 0) > 0).map(t => t.transactionCode),
        shareable: false,
    };
};

// ── 14. Milestone (cross-session) ────────────────────────────────────────────

const MILESTONE_SESSION_COUNTS = new Set([10, 25, 50, 100]);
const MILESTONE_TRANSACTION_COUNTS = new Set([100, 500, 1000]);
const MILESTONE_AMOUNTS = [100_000, 500_000, 1_000_000];

function ordinal(n: number): string {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

const milestone: Generator = (txns, ctx) => {
    const stats = ctx.allTimeStats;
    if (!stats) return null;

    if (MILESTONE_SESSION_COUNTS.has(stats.sessionCount)) {
        return {
            id: 'milestone_sessions',
            kind: 'milestone',
            priority: 95,
            headline: `That's your ${ordinal(stats.sessionCount)} summary.`,
            evidence: [],
            shareable: true,
        };
    }

    if (MILESTONE_TRANSACTION_COUNTS.has(stats.totalTransactionsTracked)) {
        return {
            id: 'milestone_transactions',
            kind: 'milestone',
            priority: 95,
            headline: `You've now tracked ${stats.totalTransactionsTracked} transactions with M-Track.`,
            evidence: [],
            shareable: true,
        };
    }

    // Aggregate stats here don't yet include this in-progress batch (chat
    // doesn't persist to the aggregate itself), so check whether adding it
    // would cross a threshold the running total hasn't reached yet.
    const totalBefore = stats.totalSpent + stats.totalReceived;
    const thisAmount = txns.filter(t => !t.excludedFromReceipt).reduce((s, t) => s + t.amount, 0);
    const projected = totalBefore + thisAmount;
    const crossed = MILESTONE_AMOUNTS.find(m => totalBefore < m && projected >= m);
    if (crossed) {
        return {
            id: `milestone_amount_${crossed}`,
            kind: 'milestone',
            priority: 95,
            headline: `You've now tracked ${fmtProse(projected)} with M-Track.`,
            evidence: [],
            shareable: true,
        };
    }

    return null;
};

export const GENERATORS: Generator[] = [
    feeTotal,
    topCategory,
    biggestSingle,
    subscriptionLoad,
    businessVsPersonal,
    busiestDay,
    spendVelocity,
    inflowOutflow,
    merchantFrequency,
    smallSpendCreep,
    recurring,
    comparison,
    feeTrendVsHistory,
    milestone,
];
