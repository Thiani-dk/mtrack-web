import type { AllTimeStats } from '../aggregate/allTimeStore';
import type { ParsedTransaction } from '../../types';
import type { RecurringPattern } from '../insights/recurring';

// Everything a badge check might need to know about the session that was
// just recorded, beyond the cumulative AllTimeStats itself.
export interface SessionSummary {
    transactionCount: number;
    labelledCount: number;
    subscriptionCount: number;
    fees: number;
    generatedAt: number;
    recurringPatterns: RecurringPattern[];
    // The session's own in-scope transactions — the source evidence checks
    // pull from when a badge is earned this session.
    transactions: ParsedTransaction[];
}

// A trimmed, serialisable snapshot of the transaction(s) responsible for a
// badge unlock — enough for a drilldown UI without storing the full
// ParsedTransaction (which carries fields, like Date objects, that don't
// round-trip cleanly through IndexedDB structuredClone the way plain data does).
export interface EvidenceTransaction {
    code: string;
    date: number;
    amount: number;
    type: 'sent' | 'received';
    recipient: string;
    merchant: string | null;
    provider: string;
}

export interface BadgeCheckResult {
    evidence: EvidenceTransaction[];
}

export interface BadgeDefinition {
    id: string;
    name: string;
    description: string;      // what you did to earn it
    tier: 'bronze' | 'silver' | 'gold';
    hidden: boolean;          // secret badges only revealed on unlock
    check: (stats: AllTimeStats, latest: SessionSummary) => BadgeCheckResult | null;
}

function toEvidence(t: ParsedTransaction): EvidenceTransaction {
    return {
        code: t.transactionCode,
        date: t.date.getTime(),
        amount: t.amount,
        type: t.type,
        recipient: t.recipient,
        merchant: t.merchant,
        provider: t.provider,
    };
}

// Shorthand for the common case: earned with no evidence, or earned with a
// specific subset of this session's transactions as proof.
function earned(transactions: ParsedTransaction[] = []): BadgeCheckResult {
    return { evidence: transactions.map(toEvidence) };
}

// ── Getting started ──────────────────────────────────────────────────────────

const gettingStarted: BadgeDefinition[] = [
    {
        id: 'first_summary',
        name: 'First Summary',
        description: 'Generated your first expense summary.',
        tier: 'bronze',
        hidden: false,
        check: (stats, latest) => (stats.sessionCount >= 1 ? earned(latest.transactions) : null),
    },
    {
        id: 'five_summaries',
        name: 'Regular',
        description: 'Five summaries in the bag.',
        tier: 'silver',
        hidden: false,
        check: (stats, latest) => (stats.sessionCount >= 5 ? earned(latest.transactions) : null),
    },
    {
        id: 'twenty_summaries',
        name: 'Archivist',
        description: 'Twenty summaries tracked.',
        tier: 'gold',
        hidden: false,
        check: (stats, latest) => (stats.sessionCount >= 20 ? earned(latest.transactions) : null),
    },
];

// ── Fee awareness ─────────────────────────────────────────────────────────────

function feeBearingTxns(latest: SessionSummary): ParsedTransaction[] {
    return latest.transactions.filter(t => (t.transactionCost ?? 0) > 0);
}

const feeAwareness: BadgeDefinition[] = [
    {
        id: 'fee_hunter',
        name: 'Fee Hunter',
        description: 'Spotted your first Ksh 100 in transaction fees.',
        tier: 'bronze',
        hidden: false,
        check: (stats, latest) => (stats.totalFees >= 100 ? earned(feeBearingTxns(latest)) : null),
    },
    {
        id: 'fee_hunter_pro',
        name: 'Fee Auditor',
        description: 'Tracked Ksh 1,000 in fees across all summaries.',
        tier: 'silver',
        hidden: false,
        check: (stats, latest) => (stats.totalFees >= 1000 ? earned(feeBearingTxns(latest)) : null),
    },
    {
        id: 'fee_hunter_elite',
        name: 'Fee Archaeologist',
        description: 'Ksh 5,000 in fees uncovered.',
        tier: 'gold',
        hidden: false,
        check: (stats, latest) => (stats.totalFees >= 5000 ? earned(feeBearingTxns(latest)) : null),
    },
];

// ── Sorting ───────────────────────────────────────────────────────────────────

function labelledTxns(latest: SessionSummary): ParsedTransaction[] {
    return latest.transactions.filter(t => t.receiptLabel != null);
}

const sorting: BadgeDefinition[] = [
    {
        id: 'sorter',
        name: 'Sorter',
        description: 'Labelled every transaction in a summary.',
        tier: 'bronze',
        hidden: false,
        check: (_stats, latest) =>
            latest.transactionCount > 0 && latest.labelledCount === latest.transactionCount
                ? earned(labelledTxns(latest))
                : null,
    },
    {
        id: 'century',
        name: 'Century',
        description: 'Sorted 100 transactions in total.',
        tier: 'silver',
        hidden: false,
        check: (stats, latest) => (stats.totalLabelledTransactions >= 100 ? earned(labelledTxns(latest)) : null),
    },
    {
        id: 'five_hundred',
        name: 'Ledger Legend',
        description: 'Sorted 500 transactions.',
        tier: 'gold',
        hidden: false,
        check: (stats, latest) => (stats.totalLabelledTransactions >= 500 ? earned(labelledTxns(latest)) : null),
    },
];

// ── Discovery ─────────────────────────────────────────────────────────────────

const discovery: BadgeDefinition[] = [
    {
        id: 'subscription_slayer',
        name: 'Subscription Slayer',
        description: 'Found four or more active subscriptions in one summary.',
        tier: 'silver',
        hidden: false,
        check: (_stats, latest) => {
            if (latest.subscriptionCount < 4) return null;
            const subs = latest.transactions.filter(t =>
                t.merchantCategory === 'Streaming & Subscriptions' || t.merchantCategory === 'Gaming'
            );
            return earned(subs);
        },
    },
    {
        id: 'pattern_spotter',
        name: 'Pattern Spotter',
        description: 'Detected your first recurring payment.',
        tier: 'silver',
        hidden: false,
        check: (_stats, latest) =>
            latest.recurringPatterns.length > 0 ? earned(latest.recurringPatterns[0].occurrences) : null,
    },
    {
        id: 'multi_channel',
        name: 'Multi-Channel',
        description: 'Tracked transactions from three or more providers.',
        tier: 'silver',
        hidden: false,
        check: (stats, latest) => {
            if (Object.keys(stats.providerCounts).length < 3) return null;
            const seen = new Set<string>();
            const representative: ParsedTransaction[] = [];
            for (const t of latest.transactions) {
                if (seen.has(t.provider)) continue;
                seen.add(t.provider);
                representative.push(t);
            }
            return earned(representative);
        },
    },
];

// ── Scale ─────────────────────────────────────────────────────────────────────

const scale: BadgeDefinition[] = [
    {
        id: 'big_ticket',
        name: 'Big Ticket',
        description: 'Tracked a single transaction over Ksh 10,000.',
        tier: 'bronze',
        hidden: false,
        check: (stats, latest) => {
            if (!stats.records.largestSingleTransaction || stats.records.largestSingleTransaction.amount <= 10000) return null;
            return earned(latest.transactions.filter(t => t.amount > 10000));
        },
    },
    {
        id: 'six_figures',
        name: 'Six Figures',
        description: 'Ksh 100,000 tracked in total.',
        tier: 'gold',
        hidden: false,
        check: (stats, latest) => (stats.totalSpent + stats.totalReceived >= 100000 ? earned(latest.transactions) : null),
    },
];

// ── Hidden ────────────────────────────────────────────────────────────────────

const NIGHT_OWL_HOUR_CUTOFF = 5; // midnight through 4:59am counts as "after midnight"

const hidden: BadgeDefinition[] = [
    {
        id: 'night_owl',
        name: 'Night Owl',
        description: 'Generated a summary after midnight.',
        tier: 'bronze',
        hidden: true,
        check: (_stats, latest) => {
            if (new Date(latest.generatedAt).getHours() >= NIGHT_OWL_HOUR_CUTOFF) return null;
            const afterMidnight = latest.transactions.filter(t => t.date.getHours() < NIGHT_OWL_HOUR_CUTOFF);
            return earned(afterMidnight.length > 0 ? afterMidnight : latest.transactions.slice(0, 1));
        },
    },
    {
        id: 'minimalist',
        name: 'Minimalist',
        description: 'A summary where fees came to exactly zero.',
        tier: 'bronze',
        hidden: true,
        check: (_stats, latest) =>
            latest.transactionCount > 0 && latest.fees === 0 ? earned(latest.transactions) : null,
    },
];

const NON_COMPLETIONIST_BADGES: BadgeDefinition[] = [
    ...gettingStarted,
    ...feeAwareness,
    ...sorting,
    ...discovery,
    ...scale,
    ...hidden,
];

const completionist: BadgeDefinition = {
    id: 'completionist',
    name: 'Completionist',
    description: 'Earned every other badge.',
    tier: 'gold',
    hidden: true,
    check: stats => (NON_COMPLETIONIST_BADGES.every(b => stats.earnedBadges[b.id] != null) ? earned() : null),
};

// Order matters: completionist must be checked last so it sees every badge
// awarded earlier in the same pass.
export const BADGES: BadgeDefinition[] = [...NON_COMPLETIONIST_BADGES, completionist];

export function getBadge(id: string): BadgeDefinition | undefined {
    return BADGES.find(b => b.id === id);
}

// Awards any newly-qualifying badges by mutating stats.earnedBadges in
// place (stats is expected to already be a working copy the caller owns).
// Never re-awards — a badge already present in earnedBadges is skipped.
export function applyNewlyEarnedBadges(stats: AllTimeStats, latest: SessionSummary, now: number): string[] {
    const newly: string[] = [];
    for (const badge of BADGES) {
        if (stats.earnedBadges[badge.id] != null) continue;
        const result = badge.check(stats, latest);
        if (result) {
            stats.earnedBadges[badge.id] = { earnedAt: now, evidence: result.evidence };
            newly.push(badge.id);
        }
    }
    return newly;
}
