import type { ParsedTransaction, StoredReceipt, TrackedDocument } from '../types';
import { computeCoveringDates } from './documentModel';

// ---------------------------------------------------------------------------
// Single source of truth for the shared 'mtrack-db' schema.
//
// receiptStore, chatSessionStore, allTimeStore and documentStore all open the
// SAME database by name. IndexedDB runs onupgradeneeded exactly once, on
// whichever module happens to open the database first at a higher version, so
// every module must apply the identical superset schema — otherwise the store
// another module needs is silently never created. Each module still declares
// its own `DB_VERSION` constant (kept equal, grep-verified) and simply calls
// applyUpgrade() from its onupgradeneeded handler.
// ---------------------------------------------------------------------------

export const MTRACK_DB_NAME = 'mtrack-db';
export const MTRACK_DB_VERSION = 5;

export const RECEIPTS_STORE = 'receipts';
export const SESSIONS_STORE = 'sessions';
export const AGGREGATE_STORE = 'aggregate';
export const DOCUMENTS_STORE = 'documents';

function migrateTransaction(t: ParsedTransaction): ParsedTransaction {
    const legacy = t as Partial<ParsedTransaction>;
    return {
        ...t,
        fulizaAmount: legacy.fulizaAmount ?? null,
        reversalOf: legacy.reversalOf ?? null,
        isReversed: legacy.isReversed ?? false,
        amountVerified: legacy.amountVerified ?? false,
        balanceMismatch: legacy.balanceMismatch ?? false,
        directionSource: legacy.directionSource ?? 'keyword',
        directionDisputed: legacy.directionDisputed ?? false,
        directionUnresolved: legacy.directionUnresolved ?? false,
        directionAssumed: legacy.directionAssumed ?? false,
        dataSource: 'sms_verified',
        lineItems: null,
        purposeLabel: null,
        bucketLabel: legacy.bucketLabel ?? null,
    };
}

// A legacy StoredReceipt record, lifted into the unified document model. Every
// migrated summary is an already-approved expense_summary backed entirely by
// SMS-verified transactions.
export function receiptToDocument(r: StoredReceipt): TrackedDocument {
    const transactions = (r.transactions ?? []).map(migrateTransaction);
    const { coveringFrom, coveringTo } = computeCoveringDates(transactions);
    return {
        id: r.id,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        status: 'approved',
        documentType: 'expense_summary',
        dataSource: 'sms_verified',
        transactions,
        merchantProfile: null,
        onBehalfOf: null,
        coveringFrom,
        coveringTo,
        // Nothing that predates Active Mode came from it.
        capturedViaActiveMode: false,
        activeMode: null,
    };
}

// Applies the full schema. Safe to run from any module's onupgradeneeded and
// on any oldVersion (including 0, a fresh install): every step is guarded.
export function applyUpgrade(db: IDBDatabase, txn: IDBTransaction | null): void {
    if (!db.objectStoreNames.contains(RECEIPTS_STORE)) {
        const store = db.createObjectStore(RECEIPTS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
    }
    if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
    }
    if (!db.objectStoreNames.contains(AGGREGATE_STORE)) {
        db.createObjectStore(AGGREGATE_STORE);
    }
    if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        const store = db.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('documentType', 'documentType');
    }

    // v5 — badges and personal records were removed. Drop the earnedBadges and
    // records keys from the stored aggregate record, keeping everything else
    // (session counts, totals, monthly buckets) untouched.
    if (txn && db.objectStoreNames.contains(AGGREGATE_STORE)) {
        const aggStore = txn.objectStore(AGGREGATE_STORE);
        const statsReq = aggStore.get('all-time');
        statsReq.onsuccess = () => {
            const stats = statsReq.result as Record<string, unknown> | undefined;
            if (stats && ('earnedBadges' in stats || 'records' in stats)) {
                delete stats.earnedBadges;
                delete stats.records;
                try {
                    aggStore.put(stats, 'all-time');
                } catch {
                    // Leave the record as-is rather than abort the upgrade.
                }
            }
        };
    }

    // Migrate legacy receipts into documents. The original receipts records
    // are left in place so a failed migration stays recoverable — reads only
    // ever go to documents. Idempotent: skips any id already present.
    if (txn && db.objectStoreNames.contains(RECEIPTS_STORE) && db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        const receiptsStore = txn.objectStore(RECEIPTS_STORE);
        const documentsStore = txn.objectStore(DOCUMENTS_STORE);
        const cursorReq = receiptsStore.openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const receipt = cursor.value as StoredReceipt;
            const existing = documentsStore.get(receipt.id);
            existing.onsuccess = () => {
                if (!existing.result) {
                    try {
                        documentsStore.put(receiptToDocument(receipt));
                    } catch {
                        // A single malformed legacy record must not abort the
                        // whole upgrade — its receipt row is still intact.
                    }
                }
            };
            cursor.continue();
        };
    }
}
