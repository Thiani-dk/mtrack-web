import { describe, expect, it } from 'vitest';
import { buildDayCardData, computeBalanceNote, dayCardDateLabel } from './model';
import { buildCashSale, buildLumpSum, captureFromPaste } from '../activeMode/session';
import type { ParsedTransaction } from '../../types';

// The day card's data model: every adaptive rule in Phase 3.1-3.5 as a pure
// function of the transactions, checked against the exact fixture each row of
// the design's own table describes.

const NOW = new Date('2026-09-26T18:00:00');

function mpesaSale(amount: number, hhmm: string, minute: number, balance?: number): ParsedTransaction {
    const raw = `QA${String(minute).padStart(2, '0')}XK9P2L Confirmed. You have received `
        + `Ksh${amount.toFixed(2)} from JOHN KAMAU 0712345678 on 26/9/26 at ${hhmm}. `
        + `New M-PESA balance is Ksh${(balance ?? 20000 + amount).toFixed(2)}.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error(`fixture did not parse: ${raw}`);
    return t;
}

function withBucket(t: ParsedTransaction, bucket: string): ParsedTransaction {
    return { ...t, bucketLabel: bucket === 'Unsorted' ? null : bucket };
}

describe('a rich M-Pesa-only day', () => {
    const txns = [
        withBucket(mpesaSale(350, '1:05 PM', 1), 'Combo sales'),
        withBucket(mpesaSale(350, '1:11 PM', 2), 'Combo sales'),
        withBucket(mpesaSale(700, '1:19 PM', 3), 'Combo sales'),
        withBucket(mpesaSale(150, '2:24 PM', 4), 'Dessert sales'),
        withBucket(mpesaSale(200, '2:31 PM', 5), 'Dessert sales'),
    ];
    const data = buildDayCardData(txns, { stallName: 'Mama Chapo', now: NOW });

    it('has no cash split and the M-Pesa-only hero label', () => {
        expect(data.hasCash).toBe(false);
        expect(data.heroLabel).toBe('M-PESA SALES TODAY');
        expect(data.paymentSplitLine).toBeNull();
    });

    it('totals exactly, never rounded', () => {
        expect(data.heroAmount).toBe('Ksh 1,750');
        expect(data.totalAmount).toBe(1750);
    });

    it('counts every sale', () => {
        expect(data.saleCount).toBe(5);
        expect(data.saleCountLabel).toBe('5');
    });

    it('computes the average in whole shillings', () => {
        expect(data.averageLabel).toBe('Ksh 350');
        expect(data.averageExcludesNote).toBeNull();
    });

    it('picks the peak hour — most sales landed 1-2 PM', () => {
        expect(data.primaryTile).toEqual({ kind: 'peakHour', label: '1 to 2 PM' });
    });

    it('ranks buckets by amount, and states the top-bucket sentence', () => {
        expect(data.buckets).toEqual([
            { label: 'Combo sales', amount: 'Ksh 1,400', share: 1400 / 1750 },
            { label: 'Dessert sales', amount: 'Ksh 350', share: 350 / 1750 },
        ]);
        expect(data.topBucketSentence).toBe('Combo sales were 80% of the day.');
    });

    it('the footer names M-Pesa only', () => {
        expect(data.footerLine).toContain('M-Pesa sales only');
        expect(data.footerLine).toContain('Made with M-Track');
    });

    it('carries the stall name through untouched', () => {
        expect(data.stallName).toBe('Mama Chapo');
    });
});

describe('a day with live cash entries', () => {
    const txns = [
        withBucket(mpesaSale(500, '1:00 PM', 1), 'Combo sales'),
        withBucket(buildCashSale({ bucket: 'Combo sales', amount: 100, now: new Date('2026-09-26T13:10:00') }), 'Combo sales'),
    ];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('shows the payment split line, and the cash-aware hero label', () => {
        expect(data.hasCash).toBe(true);
        expect(data.heroLabel).toBe('SALES TODAY');
        expect(data.paymentSplitLine).toBe('M-Pesa Ksh 500  ·  Cash Ksh 100');
    });

    it('sums M-Pesa and cash to the hero total exactly', () => {
        expect(data.heroAmount).toBe('Ksh 600');
    });

    it('the footer mentions cash', () => {
        expect(data.footerLine).toContain('Includes cash entered by the seller');
    });

    it('with no stall name set, the header falls back in the layout, not here', () => {
        expect(data.stallName).toBeNull();
    });
});

describe('a lump-sum cash entry', () => {
    const txns = [
        withBucket(mpesaSale(500, '1:00 PM', 1), 'Combo sales'),
        withBucket(mpesaSale(700, '1:30 PM', 2), 'Combo sales'),
        buildLumpSum({ bucket: 'Drinks', amount: 4040, count: null, now: new Date('2026-09-26T20:00:00') }),
    ];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('is included in the hero total in full', () => {
        expect(data.totalAmount).toBe(500 + 700 + 4040);
    });

    it('is excluded from the sale count, since no count was given', () => {
        expect(data.saleCount).toBe(2);
    });

    it('states on the card that the average excludes it', () => {
        expect(data.averageExcludesNote).toBe('Average excludes cash entered as a lump sum.');
        expect(data.averageLabel).toBe('Ksh 600'); // (500+700)/2, not /3
    });
});

describe('a lump sum WITH a count', () => {
    const txns = [
        withBucket(mpesaSale(500, '1:00 PM', 1), 'Combo sales'),
        buildLumpSum({ bucket: 'Combo sales', amount: 1200, count: 3, now: new Date('2026-09-26T20:00:00') }),
    ];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('is included in both the total and the sale count', () => {
        expect(data.totalAmount).toBe(1700);
        expect(data.saleCount).toBe(4);
    });

    it('the average note does not fire — nothing here was left uncounted', () => {
        expect(data.averageExcludesNote).toBeNull();
        expect(data.averageLabel).toBe('Ksh 425'); // 1700 / 4
    });
});

describe('a sparse day (one sale)', () => {
    const txns = [withBucket(mpesaSale(350, '1:00 PM', 1), 'Combo sales')];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('collapses to the single-bucket line', () => {
        expect(data.buckets).toBeNull();
        expect(data.singleBucketLine).toBe('All in Combo sales.');
        expect(data.topBucketSentence).toBeNull();
    });
});

describe('everything in Unsorted', () => {
    const txns = [
        withBucket(mpesaSale(350, '1:00 PM', 1), 'Unsorted'),
        withBucket(mpesaSale(150, '1:05 PM', 2), 'Unsorted'),
    ];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('still collapses to a single-bucket line naming Unsorted', () => {
        expect(data.buckets).toBeNull();
        expect(data.singleBucketLine).toBe('All in Unsorted.');
    });

    it('surfaces the private Unsorted note', () => {
        expect(data.unsortedNote).toEqual({ count: 2, amountLabel: 'Ksh 500' });
    });
});

describe('more than four named buckets', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const txns = names.map((n, i) => withBucket(mpesaSale((6 - i) * 100, `1:0${i} PM`, i + 1), n));
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('shows the top four, then one combined "N other buckets" row', () => {
        expect(data.buckets).toHaveLength(5);
        expect(data.buckets!.slice(0, 4).map(b => b.label)).toEqual(['A', 'B', 'C', 'D']);
        expect(data.buckets![4]).toEqual({ label: '2 other buckets', amount: 'Ksh 300', share: 300 / 2100 });
        expect(data.otherBucketsLabel).toBe('2 other buckets');
    });
});

describe('Unsorted alongside more than four named buckets', () => {
    const named = ['A', 'B', 'C', 'D', 'E'];
    const txns = [
        ...named.map((n, i) => withBucket(mpesaSale((5 - i) * 100, `1:0${i} PM`, i + 1), n)),
        withBucket(mpesaSale(50, '3:00 PM', 9), 'Unsorted'),
    ];
    const data = buildDayCardData(txns, { stallName: null, now: NOW });

    it('lists Unsorted on its own, last, even though it is not in the top four', () => {
        const labels = data.buckets!.map(b => b.label);
        expect(labels[labels.length - 1]).toBe('Unsorted');
    });

    it('Unsorted is never folded into the "other buckets" row', () => {
        expect(data.buckets!.find(b => b.label === 'Unsorted')?.amount).toBe('Ksh 50');
    });
});

describe('no clock times stored (30%+ rule)', () => {
    it('swaps to Biggest sale when every sale lacks a time', () => {
        const txns = [
            buildLumpSum({ bucket: 'Combo sales', amount: 350, count: 1, now: NOW }),
            buildLumpSum({ bucket: 'Combo sales', amount: 900, count: 1, now: NOW }),
        ];
        const data = buildDayCardData(txns, { stallName: null, now: NOW });
        expect(data.primaryTile).toEqual({ kind: 'biggestSale', label: 'Ksh 900' });
    });

    it('keeps Peak hour when under 30% are missing a time', () => {
        const txns = [
            mpesaSale(100, '1:00 PM', 1), mpesaSale(100, '1:05 PM', 2), mpesaSale(100, '1:10 PM', 3),
            mpesaSale(100, '2:00 PM', 4),
        ];
        const data = buildDayCardData(txns, { stallName: null, now: NOW });
        expect(data.primaryTile.kind).toBe('peakHour');
    });
});

describe('huge numbers', () => {
    it('the hero keeps every digit, comma-grouped, never rounded', () => {
        const txns = [withBucket(mpesaSale(1_234_567, '1:00 PM', 1), 'Combo sales')];
        const data = buildDayCardData(txns, { stallName: null, now: NOW });
        expect(data.heroAmount).toBe('Ksh 1,234,567');
    });
});

describe('dayCardDateLabel', () => {
    it('reads a single-day session as one short date', () => {
        const txns = [withBucket(mpesaSale(350, '1:00 PM', 1), 'Combo sales')];
        expect(dayCardDateLabel(txns, NOW)).toBe('Sat 26 Sep');
    });

    it('reads a session crossing midnight as a range', () => {
        const t1 = withBucket(mpesaSale(350, '11:50 PM', 1), 'Combo sales');
        const t2: ParsedTransaction = { ...withBucket(mpesaSale(100, '12:10 AM', 2), 'Combo sales'), date: new Date('2026-09-27T00:10:00') };
        expect(dayCardDateLabel([t1, t2], NOW)).toBe('Sat 26 Sep to Sun 27 Sep');
    });

    it('falls back to "now" when nothing has a usable date (should not happen, but never breaks)', () => {
        expect(dayCardDateLabel([], NOW)).toBe('Sat 26 Sep');
    });
});

describe('computeBalanceNote', () => {
    function balancedSale(amount: number, minute: number, balanceAfter: number): ParsedTransaction {
        return mpesaSale(amount, `1:0${minute} PM`, minute, balanceAfter);
    }

    it('is null (no note) when the balance movement matches what was logged', () => {
        const a = balancedSale(500, 1, 20500);
        const b = balancedSale(300, 2, 20800);
        expect(computeBalanceNote([a, b], 'KES')).toEqual({ kind: 'match' });
    });

    it('reports a surplus when the balance rose more than what was logged', () => {
        const a = balancedSale(500, 1, 20500);
        const b = balancedSale(300, 2, 21100); // +600 actual, only 300 logged after the first
        expect(computeBalanceNote([a, b], 'KES')).toEqual({ kind: 'surplus', amountLabel: 'Ksh 300' });
    });

    it('reports a shortfall when the balance rose less than what was logged', () => {
        const a = balancedSale(500, 1, 20500);
        const b = balancedSale(300, 2, 20600); // +100 actual, 300 logged
        expect(computeBalanceNote([a, b], 'KES')).toEqual({ kind: 'shortfall', amountLabel: 'Ksh 200' });
    });

    it('is null when any sale is missing a stored balance', () => {
        const a = balancedSale(500, 1, 20500);
        const b = { ...balancedSale(300, 2, 20800), balance: null };
        expect(computeBalanceNote([a, b], 'KES')).toBeNull();
    });

    it('is null with fewer than two M-Pesa sales — nothing to compare', () => {
        expect(computeBalanceNote([balancedSale(500, 1, 20500)], 'KES')).toBeNull();
        expect(computeBalanceNote([], 'KES')).toBeNull();
    });
});

describe('zero sales', () => {
    it('still produces a complete, non-throwing DayCardData', () => {
        expect(() => buildDayCardData([], { stallName: null, now: NOW })).not.toThrow();
        const data = buildDayCardData([], { stallName: null, now: NOW });
        expect(data.saleCount).toBe(0);
        expect(data.totalAmount).toBe(0);
    });
});
