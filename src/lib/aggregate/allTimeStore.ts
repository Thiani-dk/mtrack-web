import type { ParsedTransaction } from '../../types';
import { detectRecurring } from '../insights/recurring';
import { applyNewlyEarnedBadges, type SessionSummary, type EvidenceTransaction } from '../badges/definitions';

export interface MonthBucket {
    month: string;           // 'YYYY-MM'
    transactionCount: number;
    spent: number;
    received: number;
    fees: number;
    categoryTotals: Record<string, number>;
}

export interface AllTimeStats {
    firstTrackedAt: number;
    lastTrackedAt: number;
    sessionCount: number;
    totalTransactionsTracked: number;
    totalSpent: number;
    totalReceived: number;
    totalFees: number;
    totalLabelledTransactions: number;
    // Rolling per-period buckets, keyed 'YYYY-MM'
    monthly: Record<string, MonthBucket>;
    // Running counts for records and badges
    categoryTotals: Record<string, number>;
    merchantCounts: Record<string, number>;
    providerCounts: Record<string, number>;
    // Personal records
    records: {
        lowestFeeMonth: { month: string; amount: number } | null;
        highestSpendMonth: { month: string; amount: number } | null;
        mostTransactionsInOneSummary: number;
        largestSingleTransaction: { amount: number; recipient: string; date: number } | null;
        longestGapBetweenSummaries: number; // days
    };
    // Badge id -> unlock record (evidence: [] for badges not about a
    // specific transaction, e.g. completionist)
    earnedBadges: Record<string, { earnedAt: number; evidence: EvidenceTransaction[] }>;
}

// Pre-Part-C records stored a bare unlock timestamp per badge id
// (Record<string, number>) instead of { earnedAt, evidence }. IndexedDB
// doesn't validate shapes on read, so a user who earned badges before this
// migration would otherwise crash the first time badge code touches
// `.earnedAt`/`.evidence` on what's still a plain number.
export function migrateEarnedBadges(stats: AllTimeStats): boolean {
    let migrated = false;
    // Cast away the compile-time shape — the whole point here is defending
    // against data written before that shape existed.
    const raw = stats.earnedBadges as Record<string, number | { earnedAt: number; evidence: EvidenceTransaction[] }>;
    for (const [id, value] of Object.entries(raw)) {
        if (typeof value === 'number') {
            stats.earnedBadges[id] = { earnedAt: value, evidence: [] };
            migrated = true;
        }
    }
    return migrated;
}

const DB_NAME = 'mtrack-db';
// Shared with receiptStore.ts and chatSessionStore.ts — see the comment on
// DB_VERSION in receiptStore.ts. All three must stay in sync.
const DB_VERSION = 3;
const RECEIPTS_STORE = 'receipts';
const SESSIONS_STORE = 'sessions';
const AGGREGATE_STORE = 'aggregate';

const STATS_KEY = 'all-time';
const SEEN_CODES_KEY = 'seen-codes';
const MAX_SEEN_CODES = 10000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            // Preserve existing stores — only create what's missing,
            // regardless of which version this database is upgrading from.
            if (!db.objectStoreNames.contains(RECEIPTS_STORE)) {
                const store = db.createObjectStore(RECEIPTS_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt');
            }
            if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
                const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt');
            }
            if (!db.objectStoreNames.contains(AGGREGATE_STORE)) {
                // No keyPath — this store holds a couple of explicitly-keyed
                // records ('all-time' stats, 'seen-codes' dedup list) rather
                // than a collection of same-shaped rows.
                db.createObjectStore(AGGREGATE_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ── Low-level record access ──────────────────────────────────────────────────

export async function getAllTimeStats(): Promise<AllTimeStats | undefined> {
    const db = await initDB();
    const stats = await new Promise<AllTimeStats | undefined>((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readonly');
        const req = tx.objectStore(AGGREGATE_STORE).get(STATS_KEY);
        req.onsuccess = () => resolve(req.result as AllTimeStats | undefined);
        req.onerror = () => reject(req.error);
    });

    if (stats && migrateEarnedBadges(stats)) {
        await saveAllTimeStats(stats);
    }

    return stats;
}

async function saveAllTimeStats(stats: AllTimeStats): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readwrite');
        tx.objectStore(AGGREGATE_STORE).put(stats, STATS_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getSeenCodes(): Promise<string[]> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readonly');
        const req = tx.objectStore(AGGREGATE_STORE).get(SEEN_CODES_KEY);
        req.onsuccess = () => resolve((req.result as string[] | undefined) ?? []);
        req.onerror = () => reject(req.error);
    });
}

async function saveSeenCodes(codes: string[]): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readwrite');
        tx.objectStore(AGGREGATE_STORE).put(codes, SEEN_CODES_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function resetAllTime(): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readwrite');
        const store = tx.objectStore(AGGREGATE_STORE);
        store.delete(STATS_KEY);
        store.delete(SEEN_CODES_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── Pure merge logic ──────────────────────────────────────────────────────────

function monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function emptyStats(now: number): AllTimeStats {
    return {
        firstTrackedAt: now,
        lastTrackedAt: now,
        sessionCount: 0,
        totalTransactionsTracked: 0,
        totalSpent: 0,
        totalReceived: 0,
        totalFees: 0,
        totalLabelledTransactions: 0,
        monthly: {},
        categoryTotals: {},
        merchantCounts: {},
        providerCounts: {},
        records: {
            lowestFeeMonth: null,
            highestSpendMonth: null,
            mostTransactionsInOneSummary: 0,
            largestSingleTransaction: null,
            longestGapBetweenSummaries: 0,
        },
        earnedBadges: {},
    };
}

// Merges one summary's transactions into the running aggregate. Pure and
// synchronous so it's independently testable — persistence is a thin
// wrapper (recordSession) around this.
export function mergeSessionIntoStats(
    current: AllTimeStats | undefined,
    seenCodes: Set<string>,
    transactions: ParsedTransaction[],
    now: number = Date.now()
): { stats: AllTimeStats; seenCodes: Set<string>; newlyEarnedBadges: string[] } {
    const stats: AllTimeStats = current ? structuredClone(current) : emptyStats(now);
    const nextSeenCodes = new Set(seenCodes);

    if (stats.sessionCount > 0) {
        const gapDays = Math.round((now - stats.lastTrackedAt) / MS_PER_DAY);
        if (gapDays > stats.records.longestGapBetweenSummaries) {
            stats.records.longestGapBetweenSummaries = gapDays;
        }
    }

    stats.sessionCount += 1;
    stats.lastTrackedAt = now;

    const inScope = transactions.filter(t => !t.excludedFromReceipt);
    if (inScope.length > stats.records.mostTransactionsInOneSummary) {
        stats.records.mostTransactionsInOneSummary = inScope.length;
    }

    // Deduplicate by transaction code — the same transaction appearing in
    // two overlapping summaries must only count once, ever.
    const freshTxns = inScope.filter(t => !nextSeenCodes.has(t.transactionCode));

    for (const t of freshTxns) {
        nextSeenCodes.add(t.transactionCode);
        stats.totalTransactionsTracked += 1;
        if (t.receiptLabel != null) stats.totalLabelledTransactions += 1;

        const isSpend = t.type === 'sent' && t.subType !== 'mshwari' && t.subType !== 'investment';
        if (isSpend) stats.totalSpent += t.amount;
        if (t.type === 'received') stats.totalReceived += t.amount;
        stats.totalFees += t.transactionCost ?? 0;

        const mk = monthKey(t.date);
        const bucket = stats.monthly[mk] ?? {
            month: mk, transactionCount: 0, spent: 0, received: 0, fees: 0, categoryTotals: {},
        };
        bucket.transactionCount += 1;
        if (isSpend) bucket.spent += t.amount;
        if (t.type === 'received') bucket.received += t.amount;
        bucket.fees += t.transactionCost ?? 0;
        stats.monthly[mk] = bucket;

        const category = t.receiptLabel ?? t.merchantCategory;
        if (category && isSpend) {
            stats.categoryTotals[category] = (stats.categoryTotals[category] ?? 0) + t.amount;
            bucket.categoryTotals[category] = (bucket.categoryTotals[category] ?? 0) + t.amount;
        }

        if (isSpend) {
            const merchantName = t.merchant ?? t.recipient;
            stats.merchantCounts[merchantName] = (stats.merchantCounts[merchantName] ?? 0) + 1;
        }

        stats.providerCounts[t.provider] = (stats.providerCounts[t.provider] ?? 0) + 1;

        if (isSpend) {
            const merchantName = t.merchant ?? t.recipient;
            if (!stats.records.largestSingleTransaction || t.amount > stats.records.largestSingleTransaction.amount) {
                stats.records.largestSingleTransaction = { amount: t.amount, recipient: merchantName, date: t.date.getTime() };
            }
        }
    }

    // Recompute month-level records from the full bucket set — cheap, and
    // avoids drift from incremental tracking.
    let lowestFee: { month: string; amount: number } | null = null;
    let highestSpend: { month: string; amount: number } | null = null;
    for (const bucket of Object.values(stats.monthly)) {
        if (bucket.fees > 0 && (!lowestFee || bucket.fees < lowestFee.amount)) {
            lowestFee = { month: bucket.month, amount: bucket.fees };
        }
        if (!highestSpend || bucket.spent > highestSpend.amount) {
            highestSpend = { month: bucket.month, amount: bucket.spent };
        }
    }
    stats.records.lowestFeeMonth = lowestFee;
    stats.records.highestSpendMonth = highestSpend;

    // Cap the seen-codes set — evict oldest (insertion order) once over 10k.
    if (nextSeenCodes.size > MAX_SEEN_CODES) {
        const excess = nextSeenCodes.size - MAX_SEEN_CODES;
        const it = nextSeenCodes.values();
        for (let i = 0; i < excess; i++) {
            const { value, done } = it.next();
            if (done) break;
            nextSeenCodes.delete(value);
        }
    }

    // Badges check last, against the fully-updated cumulative stats, using
    // this session's own characteristics (not the dedup-filtered subset —
    // "labelled every transaction" etc. is about the session as pasted).
    const sessionFees = inScope.reduce((s, t) => s + (t.transactionCost ?? 0), 0);
    const sessionSubscriptionMerchants = new Set(
        inScope
            .filter(t => t.merchantCategory === 'Streaming & Subscriptions' || t.merchantCategory === 'Gaming')
            .map(t => t.merchant ?? t.recipient)
    );
    const summary: SessionSummary = {
        transactionCount: inScope.length,
        labelledCount: inScope.filter(t => t.receiptLabel != null).length,
        subscriptionCount: sessionSubscriptionMerchants.size,
        fees: sessionFees,
        generatedAt: now,
        recurringPatterns: detectRecurring(inScope),
        transactions: inScope,
    };
    const newlyEarnedBadges = applyNewlyEarnedBadges(stats, summary, now);

    return { stats, seenCodes: nextSeenCodes, newlyEarnedBadges };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface RecordSessionResult {
    stats: AllTimeStats;
    previousStats: AllTimeStats | undefined;
    newlyEarnedBadges: string[];
}

export async function recordSession(transactions: ParsedTransaction[]): Promise<RecordSessionResult> {
    const [current, seenArray] = await Promise.all([getAllTimeStats(), getSeenCodes()]);
    const { stats, seenCodes, newlyEarnedBadges } = mergeSessionIntoStats(current, new Set(seenArray), transactions);
    await Promise.all([saveAllTimeStats(stats), saveSeenCodes([...seenCodes])]);
    return { stats, previousStats: current, newlyEarnedBadges };
}
