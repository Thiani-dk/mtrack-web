import { describe, expect, it } from 'vitest';
import {
    buildCashSale, buildLumpSum, buildLumpSumBatch, CASH_METHOD, captureFromPaste, isCashSale,
    lastCashSale, presetAmounts, recentEntries, removeByCode, repeatCashSale,
} from './session';
import type { ParsedTransaction } from '../../types';

// Cash sales in Active Mode: no message, just the vendor's word — built the
// same honest way as any other self-reported transaction, with its own
// payment method and its own provenance, never invented data.

const NOW = new Date('2026-09-29T13:05:00');

function mpesaSale(amount: number, minute: number): ParsedTransaction {
    const raw = `QA${String(minute).padStart(2, '0')}XK9P2L Confirmed. You have received `
        + `Ksh${amount.toFixed(2)} from JOHN KAMAU 0712345678 on 29/9/26 at 1:${String(minute).padStart(2, '0')} PM. `
        + `New M-PESA balance is Ksh${(20000 + amount).toFixed(2)}.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error(`fixture did not parse: ${raw}`);
    return t;
}

describe('buildCashSale', () => {
    const sale = buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW });

    it('records the amount and bucket exactly', () => {
        expect(sale.amount).toBe(350);
        expect(sale.bucketLabel).toBe('Combo sales');
    });

    it('is tagged as cash, with an honest provider', () => {
        expect(sale.method).toBe(CASH_METHOD);
        expect(sale.provider).toBe('Cash');
        expect(isCashSale(sale)).toBe(true);
    });

    it('is money in, at full confidence — the vendor said so directly', () => {
        expect(sale.type).toBe('received');
        expect(sale.directionUnresolved).toBe(false);
    });

    it('is self-reported, not sms_verified — there was no message', () => {
        expect(sale.dataSource).toBe('self_reported');
    });

    it('carries a real clock time — it was logged as it happened', () => {
        expect(sale.time).not.toBe('');
    });

    it('is not a lump sum', () => {
        expect(sale.isLumpSum).toBe(false);
        expect(sale.lumpSumCount).toBeNull();
    });

    it('gets a synthetic reference, since there is no real one to carry', () => {
        expect(sale.codeIsSynthetic).toBe(true);
    });

    it('filing into Unsorted by name leaves bucketLabel null, exactly like any other capture', () => {
        const unsorted = buildCashSale({ bucket: 'Unsorted', amount: 100, now: NOW });
        expect(unsorted.bucketLabel).toBeNull();
    });
});

describe('buildLumpSum', () => {
    it('carries the total and, when given, the count', () => {
        const lump = buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: 12, now: NOW });
        expect(lump.amount).toBe(4040);
        expect(lump.lumpSumCount).toBe(12);
        expect(lump.bucketLabel).toBe('Combo sales');
    });

    it('is marked as a lump sum', () => {
        const lump = buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: 12, now: NOW });
        expect(lump.isLumpSum).toBe(true);
    });

    it('carries no clock time, even though it carries a date — it was never logged at a moment', () => {
        const lump = buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: 12, now: NOW });
        expect(lump.time).toBe('');
        expect(lump.date.toDateString()).toBe(NOW.toDateString());
    });

    it('accepts no count, honestly, rather than guessing one', () => {
        const lump = buildLumpSum({ bucket: 'Drinks', amount: 900, count: null, now: NOW });
        expect(lump.lumpSumCount).toBeNull();
    });

    it('files as Unsorted when no bucket is given — "one overall" total', () => {
        const overall = buildLumpSum({ bucket: null, amount: 2000, count: null, now: NOW });
        expect(overall.bucketLabel).toBeNull();
    });

    it('is still tagged cash and self-reported', () => {
        const lump = buildLumpSum({ bucket: 'Drinks', amount: 900, count: null, now: NOW });
        expect(lump.method).toBe(CASH_METHOD);
        expect(lump.dataSource).toBe('self_reported');
    });

    it('two lump sums built in the very same instant, unbatched, WOULD collide — this is the bug buildLumpSumBatch exists to prevent', () => {
        const a = buildLumpSum({ bucket: 'Combo sales', amount: 500, count: null, now: NOW });
        const b = buildLumpSum({ bucket: 'Drinks', amount: 500, count: null, now: NOW });
        // Documenting the failure mode, not asserting it is desirable: the
        // synthetic code is seeded from amount + exact timestamp only, so two
        // different buckets' rows submitted in one synchronous batch, sharing
        // both the amount and the millisecond, produce the same code here.
        expect(a.transactionCode).toBe(b.transactionCode);
    });

    it('two lump sums a moment apart get distinct references', () => {
        // The synthetic reference is seeded from amount + exact timestamp (see
        // extractCode), so two calls need to land in different milliseconds to
        // prove anything — two real taps always do; this pins that the second
        // millisecond is enough, without pretending two truly simultaneous
        // calls (which no human tap sequence produces) must also differ.
        const a = buildLumpSum({ bucket: 'Combo sales', amount: 500, count: null, now: NOW });
        const b = buildLumpSum({ bucket: 'Combo sales', amount: 500, count: null, now: new Date(NOW.getTime() + 1) });
        expect(a.transactionCode).not.toBe(b.transactionCode);
    });
});

describe('presetAmounts', () => {
    it('offers the most frequent amounts in that bucket first', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildCashSale({ bucket: 'Combo sales', amount: 700, now: NOW }),
            mpesaSale(350, 5),
        ];
        expect(presetAmounts(txns, 'Combo sales')).toEqual([350, 700]);
    });

    it('counts M-Pesa and cash sales together — both are real sales at that price', () => {
        const txns = [
            mpesaSale(350, 5),
            mpesaSale(350, 11),
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
        ];
        const filed = txns.map(t => ({ ...t, bucketLabel: 'Combo sales' }));
        expect(presetAmounts(filed, 'Combo sales')).toEqual([350]);
    });

    it('excludes a lump sum entirely — its total is not a price anyone charged', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: 12, now: NOW }),
        ];
        expect(presetAmounts(txns, 'Combo sales')).toEqual([350]);
    });

    it('ignores sales filed under a different bucket', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildCashSale({ bucket: 'Drinks', amount: 100, now: NOW }),
        ];
        expect(presetAmounts(txns, 'Drinks')).toEqual([100]);
    });

    it('caps at four, most frequent first, ties broken by amount descending', () => {
        const many = [500, 500, 500, 400, 400, 300, 200, 100];
        const txns = many.map(amount => buildCashSale({ bucket: 'Combo sales', amount, now: NOW }));
        expect(presetAmounts(txns, 'Combo sales')).toEqual([500, 400, 300, 200]);
    });

    it('is empty with no history yet — "Other" is the only option', () => {
        expect(presetAmounts([], 'Combo sales')).toEqual([]);
    });
});

describe('lastCashSale and repeatCashSale', () => {
    it('finds the most recently filed cash sale', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildCashSale({ bucket: 'Drinks', amount: 100, now: NOW }),
        ];
        expect(lastCashSale(txns)?.amount).toBe(100);
        expect(lastCashSale(txns)?.bucketLabel).toBe('Drinks');
    });

    it('skips an M-Pesa sale even if it is the most recent transaction', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            mpesaSale(700, 5),
        ];
        expect(lastCashSale(txns)?.amount).toBe(350);
    });

    it('skips a lump sum — "same again" repeats an actual sale, not an aggregate', () => {
        const txns = [
            buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW }),
            buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: null, now: NOW }),
        ];
        expect(lastCashSale(txns)?.amount).toBe(350);
    });

    it('is null with no cash sale yet', () => {
        expect(lastCashSale([mpesaSale(350, 5)])).toBeNull();
    });

    it('repeats the same bucket and amount as a fresh sale', () => {
        const original = buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW });
        const again = repeatCashSale(original, new Date(NOW.getTime() + 60000));
        expect(again.amount).toBe(350);
        expect(again.bucketLabel).toBe('Combo sales');
        expect(again.transactionCode).not.toBe(original.transactionCode);
    });
});

describe('removeByCode', () => {
    it('removes exactly the matching entry and nothing else', () => {
        const a = buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW });
        const b = buildCashSale({ bucket: 'Drinks', amount: 100, now: new Date(NOW.getTime() + 1000) });
        const result = removeByCode([a, b], a.transactionCode);
        expect(result).toEqual([b]);
    });

    it('is a no-op if the code is not found', () => {
        const a = buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW });
        expect(removeByCode([a], 'NOT-A-REAL-CODE')).toEqual([a]);
    });
});

describe('recentEntries', () => {
    it('lists filed entries most-recent-first', () => {
        const a = buildCashSale({ bucket: 'Combo sales', amount: 350, now: NOW });
        const b = buildCashSale({ bucket: 'Drinks', amount: 100, now: new Date(NOW.getTime() + 1000) });
        expect(recentEntries([a, b]).map(t => t.amount)).toEqual([100, 350]);
    });

    it('caps at the given limit', () => {
        const txns = Array.from({ length: 5 }, (_, i) =>
            buildCashSale({ bucket: 'Combo sales', amount: 100 + i, now: new Date(NOW.getTime() + i * 1000) }));
        expect(recentEntries(txns, 2).map(t => t.amount)).toEqual([104, 103]);
    });

    it('includes both cash and M-Pesa entries', () => {
        const txns = [mpesaSale(350, 5), buildCashSale({ bucket: 'Combo sales', amount: 100, now: NOW })];
        expect(recentEntries(txns)).toHaveLength(2);
    });
});

describe('buildLumpSumBatch', () => {
    it('builds one transaction per row', () => {
        const batch = buildLumpSumBatch([
            { bucket: 'Combo sales', amount: 4040, count: 12 },
            { bucket: 'Drinks', amount: 900, count: null },
            { bucket: null, amount: 2000, count: null },
        ], NOW);
        expect(batch).toHaveLength(3);
        expect(batch.map(t => t.bucketLabel)).toEqual(['Combo sales', 'Drinks', null]);
        expect(batch.map(t => t.amount)).toEqual([4040, 900, 2000]);
        expect(batch[0].lumpSumCount).toBe(12);
    });

    it('never produces two rows with the same reference, even same amount and bucket-less rows', () => {
        const batch = buildLumpSumBatch([
            { bucket: 'Combo sales', amount: 500, count: null },
            { bucket: 'Drinks', amount: 500, count: null },
            { bucket: null, amount: 500, count: null },
        ], NOW);
        const codes = new Set(batch.map(t => t.transactionCode));
        expect(codes.size).toBe(batch.length);
    });

    it('is empty for an empty submission', () => {
        expect(buildLumpSumBatch([], NOW)).toEqual([]);
    });
});
