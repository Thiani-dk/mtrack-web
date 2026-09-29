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
export const MTRACK_DB_VERSION = 6;

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
        isLumpSum: legacy.isLumpSum ?? false,
        lumpSumCount: legacy.lumpSumCount ?? null,
    };
}

// Every document already in the store (draft or approved — a shift closed
// mid-day is still saved as a draft, and must resume as one) whose
// documentType is 'expense_summary' AND capturedViaActiveMode is true is an
// Active Mode day wearing the wrong document type.
export function isActiveModeExpenseSummary(doc: TrackedDocument): boolean {
    return doc.documentType === 'expense_summary' && doc.capturedViaActiveMode === true;
}

// Flips the documentType to 'daily_sales' and changes nothing else:
// transactions, activeMode (the bucket list and any pending capture),
// merchantProfile, timestamps all carry across untouched. Idempotent by
// construction — once a record's documentType is 'daily_sales',
// isActiveModeExpenseSummary(doc) is false, so calling this again (or running
// the whole upgrade again) touches nothing further.
export function migrateToDailySales(doc: TrackedDocument): TrackedDocument {
    return { ...doc, documentType: 'daily_sales' };
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

    // v6 — Active Mode gets its own document type. A day's trading is income,
    // not spending (see documentPipeline.ts), and a document that reused
    // expense_summary could in principle have been swept into insights or
    // all-time totals by anything that later scanned approved expense
    // summaries — a day's sales are the one thing that must never happen to.
    //
    // isActiveModeExpenseSummary / migrateToDailySales are pure and exported
    // so the decision and the transform are unit-testable without a real
    // IndexedDB (this project's convention is to test IndexedDB *wiring*
    // through the browser e2e suite, and keep the actual logic in plain
    // functions the unit suite can drive directly).
    if (txn && db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        const documentsStore = txn.objectStore(DOCUMENTS_STORE);
        const cursorReq = documentsStore.openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const doc = cursor.value as TrackedDocument;
            if (isActiveModeExpenseSummary(doc)) {
                try {
                    cursor.update(migrateToDailySales(doc));
                } catch {
                    // A single malformed record must not abort the whole
                    // upgrade — it is simply left as it was.
                }
            }
            cursor.continue();
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
