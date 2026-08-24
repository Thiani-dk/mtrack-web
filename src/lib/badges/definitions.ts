import type { AllTimeStats } from '../aggregate/allTimeStore';

// Everything a badge check might need to know about the session that was
// just recorded, beyond the cumulative AllTimeStats itself.
export interface SessionSummary {
    transactionCount: number;
    labelledCount: number;
    subscriptionCount: number;
    fees: number;
    generatedAt: number;
    hasRecurringPattern: boolean;
}

export interface BadgeDefinition {
    id: string;
    name: string;
    description: string;      // what you did to earn it
    tier: 'bronze' | 'silver' | 'gold';
    hidden: boolean;          // secret badges only revealed on unlock
    check: (stats: AllTimeStats, latest: SessionSummary) => boolean;
}

// ── Getting started ──────────────────────────────────────────────────────────

const gettingStarted: BadgeDefinition[] = [
    {
        id: 'first_summary',
        name: 'First Summary',
        description: 'Generated your first expense summary.',
        tier: 'bronze',
        hidden: false,
        check: stats => stats.sessionCount >= 1,
    },
    {
        id: 'five_summaries',
        name: 'Regular',
        description: 'Five summaries in the bag.',
        tier: 'silver',
        hidden: false,
        check: stats => stats.sessionCount >= 5,
    },
    {
        id: 'twenty_summaries',
        name: 'Archivist',
        description: 'Twenty summaries tracked.',
        tier: 'gold',
        hidden: false,
        check: stats => stats.sessionCount >= 20,
    },
];

// ── Fee awareness ─────────────────────────────────────────────────────────────

const feeAwareness: BadgeDefinition[] = [
    {
        id: 'fee_hunter',
        name: 'Fee Hunter',
        description: 'Spotted your first Ksh 100 in transaction fees.',
        tier: 'bronze',
        hidden: false,
        check: stats => stats.totalFees >= 100,
    },
    {
        id: 'fee_hunter_pro',
        name: 'Fee Auditor',
        description: 'Tracked Ksh 1,000 in fees across all summaries.',
        tier: 'silver',
        hidden: false,
        check: stats => stats.totalFees >= 1000,
    },
    {
        id: 'fee_hunter_elite',
        name: 'Fee Archaeologist',
        description: 'Ksh 5,000 in fees uncovered.',
        tier: 'gold',
        hidden: false,
        check: stats => stats.totalFees >= 5000,
    },
];

// ── Sorting ───────────────────────────────────────────────────────────────────

const sorting: BadgeDefinition[] = [
    {
        id: 'sorter',
        name: 'Sorter',
        description: 'Labelled every transaction in a summary.',
        tier: 'bronze',
        hidden: false,
        check: (_stats, latest) => latest.transactionCount > 0 && latest.labelledCount === latest.transactionCount,
    },
    {
        id: 'century',
        name: 'Century',
        description: 'Sorted 100 transactions in total.',
        tier: 'silver',
        hidden: false,
        check: stats => stats.totalLabelledTransactions >= 100,
    },
    {
        id: 'five_hundred',
        name: 'Ledger Legend',
        description: 'Sorted 500 transactions.',
        tier: 'gold',
        hidden: false,
        check: stats => stats.totalLabelledTransactions >= 500,
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
        check: (_stats, latest) => latest.subscriptionCount >= 4,
    },
    {
        id: 'pattern_spotter',
        name: 'Pattern Spotter',
        description: 'Detected your first recurring payment.',
        tier: 'silver',
        hidden: false,
        check: (_stats, latest) => latest.hasRecurringPattern,
    },
    {
        id: 'multi_channel',
        name: 'Multi-Channel',
        description: 'Tracked transactions from three or more providers.',
        tier: 'silver',
        hidden: false,
        check: stats => Object.keys(stats.providerCounts).length >= 3,
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
        check: stats => !!stats.records.largestSingleTransaction && stats.records.largestSingleTransaction.amount > 10000,
    },
    {
        id: 'six_figures',
        name: 'Six Figures',
        description: 'Ksh 100,000 tracked in total.',
        tier: 'gold',
        hidden: false,
        check: stats => stats.totalSpent + stats.totalReceived >= 100000,
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
        check: (_stats, latest) => new Date(latest.generatedAt).getHours() < NIGHT_OWL_HOUR_CUTOFF,
    },
    {
        id: 'minimalist',
        name: 'Minimalist',
        description: 'A summary where fees came to exactly zero.',
        tier: 'bronze',
        hidden: true,
        check: (_stats, latest) => latest.transactionCount > 0 && latest.fees === 0,
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
    check: stats => NON_COMPLETIONIST_BADGES.every(b => stats.earnedBadges[b.id] != null),
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
        if (badge.check(stats, latest)) {
            stats.earnedBadges[badge.id] = now;
            newly.push(badge.id);
        }
    }
    return newly;
}
