import { describe, expect, it } from 'vitest';
import {
    addBucket, bucketOf, bucketSaleCount, bucketTallies, capture, captureFromPaste,
    captureFromTyped, dayTotal, deleteBucket, emptyActiveModeState, fileInto, findDuplicate,
    readActiveModeState, renameBucket, UNSORTED,
} from './session';
import { buildDraft } from '../draftDocument';
import type { ParsedTransaction } from '../../types';

// Active Mode's logic, tested without a browser: buckets, tallies, the
// auto-file safety valve, duplicate warnings, and the draft round-trip that
// makes closing a laptop mid-shift safe.

const SALE_A =
    'QGH7XK9P2L Confirmed. You have received Ksh350.00 from JOHN KAMAU 0712345678 '
    + 'on 11/9/26 at 12:05 PM. New M-PESA balance is Ksh15,230.00.';
const SALE_B =
    'RJH2P9XQ7K Confirmed. You have received Ksh1,200.00 from MARY WANJIKU 0798123456 '
    + 'on 11/9/26 at 12:40 PM. New M-PESA balance is Ksh16,430.00.';

function saleFrom(raw: string): ParsedTransaction {
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error('fixture did not parse');
    return t;
}

describe('buckets', () => {
    it('always has Unsorted, first', () => {
        expect(emptyActiveModeState().buckets).toEqual([UNSORTED]);
        expect(readActiveModeState({ buckets: ['Combo sales'] }).buckets).toEqual([UNSORTED, 'Combo sales']);
    });

    it('adds a bucket on the fly', () => {
        const { state, error } = addBucket(emptyActiveModeState(), '  Combo sales  ');
        expect(error).toBeNull();
        expect(state.buckets).toEqual([UNSORTED, 'Combo sales']);
    });

    it('refuses a blank, a duplicate, or a second Unsorted', () => {
        const base = addBucket(emptyActiveModeState(), 'Combo sales').state;
        expect(addBucket(base, '   ').error).toBe('empty');
        // Case-insensitive, or the day's takings quietly split across two chips.
        expect(addBucket(base, 'combo sales').error).toBe('duplicate');
        expect(addBucket(base, 'unsorted').error).toBe('reserved');
    });

    it('survives a stored state with junk in it', () => {
        const restored = readActiveModeState({ buckets: ['Combo sales', '', 'Combo sales', UNSORTED] });
        expect(restored.buckets).toEqual([UNSORTED, 'Combo sales']);
    });

    it('treats an unlabelled sale as Unsorted rather than losing it', () => {
        const sale = saleFrom(SALE_A);
        expect(bucketOf(sale)).toBe(UNSORTED);
        expect(bucketOf(fileInto(sale, 'Combo sales'))).toBe('Combo sales');
        // Filing into Unsorted clears the label rather than storing the word.
        expect(fileInto(sale, UNSORTED).bucketLabel).toBeNull();
    });
});

describe('tallies', () => {
    const state = addBucket(addBucket(emptyActiveModeState(), 'Combo sales').state, 'Dessert sales').state;
    const filed = [
        fileInto(saleFrom(SALE_A), 'Combo sales'),
        fileInto(saleFrom(SALE_B), 'Combo sales'),
        saleFrom(SALE_A),
    ];

    it('counts and totals per bucket', () => {
        const tallies = bucketTallies(state, filed);
        expect(tallies.map(t => [t.name, t.count, t.total])).toEqual([
            [UNSORTED, 1, 350],
            ['Combo sales', 2, 1550],
            ['Dessert sales', 0, 0],
        ]);
    });

    it('lists an empty bucket, since the chip is how you file into it', () => {
        expect(bucketTallies(state, []).map(t => t.name)).toEqual([UNSORTED, 'Combo sales', 'Dessert sales']);
    });

    it('has bucket subtotals that sum to the day total', () => {
        const tallies = bucketTallies(state, filed);
        expect(tallies.reduce((s, t) => s + t.total, 0)).toBe(dayTotal(filed));
        expect(tallies.reduce((s, t) => s + t.count, 0)).toBe(filed.length);
    });
});

describe('capture', () => {
    it('reads a pasted M-Pesa message through the ordinary pipeline', () => {
        const t = saleFrom(SALE_A);
        expect(t.amount).toBe(350);
        expect(t.type).toBe('received');
        expect(t.dataSource).toBe('sms_verified');
        // Resolved by the message itself, so nothing was assumed.
        expect(t.directionAssumed).toBe(false);
    });

    it('reads typed shorthand without asking anything', () => {
        const { transaction } = captureFromTyped('combo 350');
        expect(transaction?.amount).toBe(350);
        expect(transaction?.type).toBe('received');
        // A typed line has no message for the oracle, so the mode supplies the
        // direction — and says so.
        expect(transaction?.directionAssumed).toBe(true);
        expect(transaction?.directionUnresolved).toBe(false);
    });

    it('declines only when there is no amount to record', () => {
        expect(captureFromTyped('some sweets').error).toBe('no-amount');
        expect(capture('').error).toBe('empty');
    });

    it('prefers the SMS pipeline when the text is a real message', () => {
        expect(capture(SALE_A).transaction?.dataSource).toBe('sms_verified');
        expect(capture('combo 350').transaction?.dataSource).toBe('self_reported');
    });
});

describe('duplicate warnings', () => {
    it('spots the same message pasted twice, by transaction code', () => {
        const first = saleFrom(SALE_A);
        const again = saleFrom(SALE_A);
        const warning = findDuplicate(again, [first]);
        expect(warning?.kind).toBe('exact');
        expect(warning?.saleNumber).toBe(1);
    });

    it('reuses the existing near-duplicate detection for two similar sales', () => {
        const first = saleFrom(SALE_A);
        // Same party, same amount, a few minutes later — the shape
        // detectNearDuplicates already looks for.
        const similar: ParsedTransaction = {
            ...saleFrom(SALE_A),
            transactionCode: 'DIFFERENT1',
            date: new Date(first.date.getTime() + 4 * 60_000),
        };
        const warning = findDuplicate(similar, [first]);
        expect(warning?.kind).toBe('near');
        expect(warning?.minutesApart).toBe(4);
    });

    it('says nothing about two genuinely different sales', () => {
        expect(findDuplicate(saleFrom(SALE_B), [saleFrom(SALE_A)])).toBeNull();
    });

    it('is advisory — it reports, it does not withhold the capture', () => {
        const first = saleFrom(SALE_A);
        const again = saleFrom(SALE_A);
        expect(findDuplicate(again, [first])).not.toBeNull();
        // The capture itself is unaffected and can still be filed.
        expect(fileInto(again, 'Combo sales').bucketLabel).toBe('Combo sales');
    });
});

describe('the session as a draft document', () => {
    it('round-trips buckets and filed sales through buildDraft', () => {
        const state = addBucket(emptyActiveModeState(), 'Combo sales').state;
        const transactions = [fileInto(saleFrom(SALE_A), 'Combo sales'), saleFrom(SALE_B)];

        const doc = buildDraft({
            sessionId: 'active-1',
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions,
            capturedViaActiveMode: true,
            activeMode: state,
        });

        expect(doc.status).toBe('draft');
        expect(doc.capturedViaActiveMode).toBe(true);
        expect(doc.activeMode?.buckets).toEqual([UNSORTED, 'Combo sales']);

        // What a reopen reads back.
        const restored = readActiveModeState(doc.activeMode);
        const tallies = bucketTallies(restored, doc.transactions);
        expect(tallies.map(t => [t.name, t.count, t.total])).toEqual([
            [UNSORTED, 1, 1200],
            ['Combo sales', 1, 350],
        ]);
    });

    it('keeps an empty bucket across a save, which the transactions alone could not', () => {
        const state = addBucket(emptyActiveModeState(), 'Dessert sales').state;
        const doc = buildDraft({
            sessionId: 'active-2',
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions: [],
            capturedViaActiveMode: true,
            activeMode: state,
        });
        expect(readActiveModeState(doc.activeMode).buckets).toContain('Dessert sales');
    });

    it('leaves an ordinary chat document untouched by any of this', () => {
        const doc = buildDraft({
            sessionId: 'chat-1',
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions: [],
        });
        expect(doc.capturedViaActiveMode).toBe(false);
        expect(doc.activeMode).toBeNull();
    });
});

describe('surviving a backgrounded reload', () => {
    it('carries the pending, unfiled capture through a save and back', () => {
        // Everything already filed is safe as a transaction. The one thing that
        // would otherwise exist only in memory is the sale between the paste
        // and the bucket tap — which is exactly when a memory-pressure reload
        // is most painful.
        const pending = saleFrom(SALE_B);
        const state = { ...addBucket(emptyActiveModeState(), 'Combo sales').state, pending };

        const doc = buildDraft({
            sessionId: 'active-3',
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            transactions: [fileInto(saleFrom(SALE_A), 'Combo sales')],
            capturedViaActiveMode: true,
            activeMode: state,
        });

        const restored = readActiveModeState(doc.activeMode);
        expect(restored.pending?.transactionCode).toBe(pending.transactionCode);
        expect(restored.pending?.amount).toBe(pending.amount);
        // Restored ready to file, not already counted.
        expect(restored.pending?.bucketLabel).toBeNull();
        expect(dayTotal(doc.transactions)).toBe(350);
    });

    it('rebuilds the pending capture date, whatever the store handed back', () => {
        const pending = saleFrom(SALE_A);
        const asStored = { ...pending, date: pending.date.toISOString() as unknown as Date };
        const restored = readActiveModeState({ buckets: [], pending: asStored });
        expect(restored.pending?.date).toBeInstanceOf(Date);
        expect(restored.pending?.date.getTime()).toBe(pending.date.getTime());
    });

    it('has no pending capture when there was none', () => {
        expect(emptyActiveModeState().pending).toBeNull();
        expect(readActiveModeState(null).pending).toBeNull();
        expect(readActiveModeState({ buckets: ['Combo sales'] }).pending).toBeNull();
    });
});

describe('renaming a bucket', () => {
    const base = addBucket(addBucket(emptyActiveModeState(), 'Combo sales').state, 'Dessert sales').state;
    const filed = [
        fileInto(saleFrom(SALE_A), 'Combo sales'),
        fileInto(saleFrom(SALE_B), 'Combo sales'),
    ];

    it('carries the subtotal and count across untouched', () => {
        const before = bucketTallies(base, filed).find(t => t.name === 'Combo sales');
        const r = renameBucket(base, filed, 'Combo sales', 'Meal deals');
        expect(r.error).toBeNull();

        const after = bucketTallies(r.state, r.transactions).find(t => t.name === 'Meal deals');
        expect(after?.count).toBe(before?.count);
        expect(after?.total).toBe(before?.total);
        expect(bucketTallies(r.state, r.transactions).map(t => t.name)).not.toContain('Combo sales');
    });

    it('moves every filed sale onto the new label', () => {
        const r = renameBucket(base, filed, 'Combo sales', 'Meal deals');
        expect(r.transactions.every(t => t.bucketLabel === 'Meal deals')).toBe(true);
        // Nothing was dropped or duplicated.
        expect(r.transactions).toHaveLength(filed.length);
        expect(dayTotal(r.transactions)).toBe(dayTotal(filed));
    });

    it('refuses a blank name, a collision, or anything involving Unsorted', () => {
        expect(renameBucket(base, filed, 'Combo sales', '  ').error).toBe('empty');
        expect(renameBucket(base, filed, 'Combo sales', 'Dessert sales').error).toBe('duplicate');
        expect(renameBucket(base, filed, 'Combo sales', UNSORTED).error).toBe('reserved');
        // Unsorted itself is not renameable — rename and delete both depend on
        // it being there.
        expect(renameBucket(base, filed, UNSORTED, 'Leftovers').error).toBe('reserved');
    });

    it('allows a pure capitalisation fix', () => {
        const r = renameBucket(base, filed, 'Combo sales', 'Combo Sales');
        expect(r.error).toBeNull();
        expect(r.state.buckets).toContain('Combo Sales');
    });

    it('leaves the other buckets alone', () => {
        const mixed = [...filed, fileInto(saleFrom(SALE_A), 'Dessert sales')];
        const r = renameBucket(base, mixed, 'Combo sales', 'Meal deals');
        expect(bucketSaleCount(r.transactions, 'Dessert sales')).toBe(1);
    });
});

describe('deleting a bucket', () => {
    const base = addBucket(addBucket(emptyActiveModeState(), 'Combo sales').state, 'Dessert sales').state;

    it('removes an empty one outright', () => {
        const r = deleteBucket(base, [], 'Dessert sales');
        expect(r.moved).toBe(0);
        expect(r.state.buckets).toEqual([UNSORTED, 'Combo sales']);
    });

    it('never destroys a sale — it moves them to Unsorted', () => {
        const filed = [
            fileInto(saleFrom(SALE_A), 'Combo sales'),
            fileInto(saleFrom(SALE_B), 'Combo sales'),
        ];
        const r = deleteBucket(base, filed, 'Combo sales');

        expect(r.moved).toBe(2);
        expect(r.state.buckets).not.toContain('Combo sales');
        // Every sale is still here, and still adds up to the same day.
        expect(r.transactions).toHaveLength(filed.length);
        expect(dayTotal(r.transactions)).toBe(dayTotal(filed));

        const unsorted = bucketTallies(r.state, r.transactions).find(t => t.name === UNSORTED);
        expect(unsorted?.count).toBe(2);
        expect(unsorted?.total).toBe(dayTotal(filed));
    });

    it('adds to whatever was already in Unsorted rather than replacing it', () => {
        const filed = [saleFrom(SALE_A), fileInto(saleFrom(SALE_B), 'Combo sales')];
        const r = deleteBucket(base, filed, 'Combo sales');
        const unsorted = bucketTallies(r.state, r.transactions).find(t => t.name === UNSORTED);
        expect(unsorted?.count).toBe(2);
        expect(unsorted?.total).toBe(dayTotal(filed));
    });

    it('reports how many sales a delete would move, for the confirmation', () => {
        const filed = [fileInto(saleFrom(SALE_A), 'Combo sales')];
        expect(bucketSaleCount(filed, 'Combo sales')).toBe(1);
        expect(bucketSaleCount(filed, 'Dessert sales')).toBe(0);
    });

    it('refuses to remove Unsorted', () => {
        const filed = [saleFrom(SALE_A)];
        const r = deleteBucket(base, filed, UNSORTED);
        expect(r.state.buckets).toContain(UNSORTED);
        expect(r.moved).toBe(0);
        expect(r.transactions).toEqual(filed);
    });
});
