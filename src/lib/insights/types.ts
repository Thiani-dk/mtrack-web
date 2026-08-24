import type { AllTimeStats } from '../aggregate/allTimeStore';

export interface Insight {
    id: string;
    kind: InsightKind;
    priority: number;        // 0-100, higher surfaces first
    headline: string;        // one sentence, the observation
    detail?: string;         // optional second sentence with supporting numbers
    evidence: string[];      // transaction codes backing this claim
    shareable: boolean;      // is this a "screenshot this" moment
}

export type InsightKind =
    | 'fee_total'
    | 'fee_projection'
    | 'top_category'
    | 'biggest_single'
    | 'subscription_load'
    | 'business_vs_personal'
    | 'busiest_day'
    | 'spend_velocity'
    | 'inflow_outflow'
    | 'merchant_frequency'
    | 'small_spend_creep'
    | 'recurring'
    | 'comparison'
    | 'fee_trend'
    | 'milestone';

export interface InsightContext {
    // Trailing prepositional phrase, ready to append at the end of a
    // sentence — e.g. "over the past 7 days", "today".
    dateRangeLabel: string;
    // Actual days spanned by the in-scope transactions (not the nominal
    // window the user picked) — the honest denominator for rate math.
    dayCount: number;
    today: Date;
    // True if a past session in history spans more days than this batch —
    // used to hint at running a longer range to catch monthly patterns.
    // Undefined/false when unknown or not applicable (e.g. demo mode).
    longerRangeAvailable?: boolean;
    // Cross-session aggregate, if available — powers comparison/trend/
    // milestone insights. Undefined/null when no aggregate exists yet or
    // wasn't loaded (e.g. demo mode, IndexedDB unavailable).
    allTimeStats?: AllTimeStats | null;
}
