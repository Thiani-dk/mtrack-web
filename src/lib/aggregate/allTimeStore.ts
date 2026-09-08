import type { ParsedTransaction } from '../../types';
import { applyUpgrade } from '../dbUpgrade';

export interface MonthBucket {
    month: string;           // 'YYYY-MM'
    transactionCount: number;
    spent: number;
    received: number;
    fees: number;
    categoryTotals: Record<string, number>;
}

// Factual running history only. No achievement layer — badges, milestones and
// personal records were removed. Every field here is a plain count or total.
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
    // Running totals for the all-time view
    categoryTotals: Record<string, number>;
    merchantCounts: Record<string, number>;
    providerCounts: Record<string, number>;
}

const DB_NAME = 'mtrack-db';
// Shared with receiptStore.ts, chatSessionStore.ts and documentStore.ts — see
// the comment on DB_VERSION in receiptStore.ts. All four must stay in sync.
// Shared schema: dbUpgrade.ts / applyUpgrade.
const DB_VERSION = 5;
const AGGREGATE_STORE = 'aggregate';

const STATS_KEY = 'all-time';
const SEEN_CODES_KEY = 'seen-codes';
const MAX_SEEN_CODES = 10000;

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => applyUpgrade(request.result, request.transaction);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ── Low-level record access ──────────────────────────────────────────────────

export async function getAllTimeStats(): Promise<AllTimeStats | undefined> {
    const db = await initDB();
    return new Promise<AllTimeStats | undefined>((resolve, reject) => {
        const tx = db.transaction(AGGREGATE_STORE, 'readonly');
        const req = tx.objectStore(AGGREGATE_STORE).get(STATS_KEY);
        req.onsuccess = () => resolve(req.result as AllTimeStats | undefined);
        req.onerror = () => reject(req.error);
    });
}

export async function saveAllTimeStats(stats: AllTimeStats): Promise<void> {
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
): { stats: AllTimeStats; seenCodes: Set<string> } {
    const stats: AllTimeStats = current ? structuredClone(current) : emptyStats(now);
    const nextSeenCodes = new Set(seenCodes);

    stats.sessionCount += 1;
    stats.lastTrackedAt = now;

    const inScope = transactions.filter(t => !t.excludedFromReceipt);

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
    }

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

    return { stats, seenCodes: nextSeenCodes };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface RecordSessionResult {
    stats: AllTimeStats;
    previousStats: AllTimeStats | undefined;
}

export async function recordSession(transactions: ParsedTransaction[]): Promise<RecordSessionResult> {
    const [current, seenArray] = await Promise.all([getAllTimeStats(), getSeenCodes()]);
    const { stats, seenCodes } = mergeSessionIntoStats(current, new Set(seenArray), transactions);
    await Promise.all([saveAllTimeStats(stats), saveSeenCodes([...seenCodes])]);
    return { stats, previousStats: current };
}
