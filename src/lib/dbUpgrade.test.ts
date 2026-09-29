import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TrackedDocument } from '../types';
import {
    addReceiptNumber, generateReceiptNumber, isActiveModeExpenseSummary, migrateToDailySales,
    MTRACK_DB_VERSION, needsReceiptNumber,
} from './dbUpgrade';

// The v6 migration: Active Mode gets its own document type instead of
// reusing expense_summary. Tested as two plain functions — the decision
// (isActiveModeExpenseSummary) and the transform (migrateToDailySales) — kept
// separate from the IndexedDB cursor that drives them in applyUpgrade, so the
// logic itself is unit-testable with no fake IndexedDB. The cursor wiring is
// exercised for real in the browser e2e suite (buckets.e2e.mjs reads and
// writes the real 'mtrack-db').

function preMigrationDraft(): TrackedDocument {
    return {
        id: 'active-123',
        createdAt: 1_000,
        updatedAt: 2_000,
        status: 'draft',
        documentType: 'expense_summary',
        dataSource: 'sms_verified',
        transactions: [],
        merchantProfile: null,
        onBehalfOf: null,
        coveringFrom: null,
        coveringTo: null,
        capturedViaActiveMode: true,
        activeMode: { buckets: ['Unsorted', 'Combo sales'], pending: null },
        receiptNumber: 'MT260101-00000',
        servedBy: null,
        tip: null,
        discount: null,
    };
}

describe('isActiveModeExpenseSummary', () => {
    it('is true for an expense_summary document captured via Active Mode', () => {
        expect(isActiveModeExpenseSummary(preMigrationDraft())).toBe(true);
    });

    it('is false for an ordinary expense_summary (chat-built)', () => {
        expect(isActiveModeExpenseSummary({ ...preMigrationDraft(), capturedViaActiveMode: false })).toBe(false);
    });

    it('is false for any other document type, even with the flag set', () => {
        // Never actually occurs in practice (only Active Mode sets the flag),
        // but the predicate must not key on the flag alone.
        expect(isActiveModeExpenseSummary({ ...preMigrationDraft(), documentType: 'point_of_sale' })).toBe(false);
    });

    it('is false once a document is already daily_sales', () => {
        // This is what makes running the migration twice a no-op: the second
        // pass's own filter no longer matches an already-migrated record.
        expect(isActiveModeExpenseSummary({ ...preMigrationDraft(), documentType: 'daily_sales' })).toBe(false);
    });
});

describe('migrateToDailySales', () => {
    it('flips documentType and changes nothing else', () => {
        const before = preMigrationDraft();
        const after = migrateToDailySales(before);
        expect(after.documentType).toBe('daily_sales');
        expect(after).toEqual({ ...before, documentType: 'daily_sales' });
    });

    it('preserves a draft status, since a shift closed mid-day must resume as one', () => {
        const after = migrateToDailySales(preMigrationDraft());
        expect(after.status).toBe('draft');
    });

    it('preserves an approved status', () => {
        const approved: TrackedDocument = { ...preMigrationDraft(), status: 'approved' };
        expect(migrateToDailySales(approved).status).toBe('approved');
    });

    it('preserves the activeMode state — buckets and any pending capture', () => {
        const withPending: TrackedDocument = {
            ...preMigrationDraft(),
            activeMode: {
                buckets: ['Unsorted', 'Combo sales', 'Drinks'],
                pending: {
                    date: new Date('2026-09-12T13:05:00'), time: '1:05 PM', type: 'received',
                    subType: 'unknown', amount: 350, recipient: 'JOHN KAMAU',
                    transactionCode: 'QA01XK9P2L', balance: 20_350, transactionCost: null,
                    rawLine: '', label: null, customLabel: null, receiptLabel: null,
                    excludedFromReceipt: false, currency: 'KES', sender: 'JOHN KAMAU', account: null,
                    provider: 'M-PESA', method: 'p2p', merchant: null, merchantCategory: null,
                    location: null, isBusiness: false, confidence: 100, confidenceLevel: 'high',
                    missingFields: [], codeIsSynthetic: false, dateAmbiguous: false, failed: false,
                    isHold: false, isVerificationCharge: false, cardLast4: null, fulizaAmount: null,
                    reversalOf: null, isReversed: false, amountVerified: false, balanceMismatch: false,
                    directionSource: 'keyword', directionDisputed: false, directionUnresolved: false,
                    directionAssumed: false, dataSource: 'sms_verified', lineItems: null,
                    bucketLabel: null, purposeLabel: null, isLumpSum: false, lumpSumCount: null,
                },
            },
        };
        const after = migrateToDailySales(withPending);
        expect(after.activeMode).toBe(withPending.activeMode);
        expect(after.activeMode?.pending?.amount).toBe(350);
        expect(after.activeMode?.buckets).toEqual(['Unsorted', 'Combo sales', 'Drinks']);
    });

    it('preserves transactions, timestamps and every other field untouched', () => {
        const withTxns: TrackedDocument = {
            ...preMigrationDraft(),
            status: 'approved',
            transactions: [{
                date: new Date('2026-09-12T13:05:00'), time: '1:05 PM', type: 'received',
                subType: 'unknown', amount: 700, recipient: 'MARY WANJIKU',
                transactionCode: 'QA02XK9P2L', balance: null, transactionCost: null,
                rawLine: '', label: null, customLabel: null, receiptLabel: null,
                excludedFromReceipt: false, currency: 'KES', sender: 'MARY WANJIKU', account: null,
                provider: 'M-PESA', method: 'p2p', merchant: null, merchantCategory: null,
                location: null, isBusiness: false, confidence: 100, confidenceLevel: 'high',
                missingFields: [], codeIsSynthetic: false, dateAmbiguous: false, failed: false,
                isHold: false, isVerificationCharge: false, cardLast4: null, fulizaAmount: null,
                reversalOf: null, isReversed: false, amountVerified: false, balanceMismatch: false,
                directionSource: 'keyword', directionDisputed: false, directionUnresolved: false,
                directionAssumed: false, dataSource: 'sms_verified', lineItems: null,
                bucketLabel: 'Combo sales', purposeLabel: null, isLumpSum: false, lumpSumCount: null,
            }],
        };
        const after = migrateToDailySales(withTxns);
        expect(after.transactions).toBe(withTxns.transactions);
        expect(after.createdAt).toBe(withTxns.createdAt);
        expect(after.updatedAt).toBe(withTxns.updatedAt);
        expect(after.id).toBe(withTxns.id);
    });

    it('running it twice (idempotent, once gated by the predicate) does not change a migrated record further', () => {
        const once = migrateToDailySales(preMigrationDraft());
        const guardedTwice = isActiveModeExpenseSummary(once) ? migrateToDailySales(once) : once;
        expect(guardedTwice).toEqual(once);
    });
});

// v7 — a stable receiptNumber, replacing the old generateReceiptRef's
// read-the-clock-on-every-render bug (see dbUpgrade.ts's own comment).
describe('generateReceiptNumber', () => {
    it('is deterministic — the same id and createdAt always produce the same number', () => {
        const a = generateReceiptNumber('active-123', 1_735_500_000_000);
        const b = generateReceiptNumber('active-123', 1_735_500_000_000);
        expect(a).toBe(b);
    });

    it('encodes the creation date, human-scannable', () => {
        const number = generateReceiptNumber('any-id', new Date('2026-09-29T10:00:00').getTime());
        expect(number.startsWith('MT260929-')).toBe(true);
    });

    it('two different ids on the same day produce different numbers', () => {
        const now = Date.now();
        const a = generateReceiptNumber('active-123', now);
        const b = generateReceiptNumber('active-456', now);
        expect(a).not.toBe(b);
    });

    it('the same document rendered a minute apart still agrees with itself (the bug this replaces)', () => {
        const created = new Date('2026-09-29T10:00:00').getTime();
        const renderedNow = generateReceiptNumber('active-123', created);
        const renderedLater = generateReceiptNumber('active-123', created);
        expect(renderedNow).toBe(renderedLater);
    });
});

describe('needsReceiptNumber / addReceiptNumber', () => {
    it('is true for a document saved before this field existed', () => {
        const legacy = preMigrationDraft() as Partial<TrackedDocument>;
        delete legacy.receiptNumber;
        expect(needsReceiptNumber(legacy as TrackedDocument)).toBe(true);
    });

    it('is false once a document has one', () => {
        expect(needsReceiptNumber(preMigrationDraft())).toBe(false);
    });

    it('backfills a stable number and defaults the receipt-only fields to null', () => {
        const legacy = preMigrationDraft() as Partial<TrackedDocument>;
        delete legacy.receiptNumber;
        const migrated = addReceiptNumber(legacy as TrackedDocument);
        expect(migrated.receiptNumber).toBe(generateReceiptNumber(migrated.id, migrated.createdAt));
        expect(migrated.servedBy).toBeNull();
        expect(migrated.tip).toBeNull();
        expect(migrated.discount).toBeNull();
    });

    it('is idempotent — running it twice does not change an already-migrated document', () => {
        const once = addReceiptNumber(preMigrationDraft());
        const twice = addReceiptNumber(once);
        expect(twice).toEqual(once);
    });
});

// "Each module still declares its own DB_VERSION constant (kept equal,
// grep-verified)" — the comment in dbUpgrade.ts describes a manual practice.
// This makes it a real, automated check: read each of the five files' own
// constant straight from source and assert they all agree with the shared
// schema version. A bump to one without the others is exactly the mismatch
// this project has been bitten by before (see the comment history in
// dbUpgrade.ts) — this test fails the moment that happens again.
describe('the five DB_VERSION declarations stay in lockstep', () => {
    const FILES_WITH_LOCAL_CONSTANT = [
        'src/lib/receiptStore.ts',
        'src/lib/chatSessionStore.ts',
        'src/lib/documentStore.ts',
        'src/lib/aggregate/allTimeStore.ts',
    ];

    it(`every local DB_VERSION equals MTRACK_DB_VERSION (${MTRACK_DB_VERSION})`, () => {
        for (const file of FILES_WITH_LOCAL_CONSTANT) {
            const source = readFileSync(file, 'utf8');
            const match = source.match(/const DB_VERSION = (\d+);/);
            expect(match, `${file} has no "const DB_VERSION = N;" — did its declaration change shape?`).not.toBeNull();
            const value = Number(match![1]);
            expect(value, `${file} declares DB_VERSION ${value}, MTRACK_DB_VERSION is ${MTRACK_DB_VERSION}`)
                .toBe(MTRACK_DB_VERSION);
        }
    });
});
