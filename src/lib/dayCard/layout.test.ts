import { describe, expect, it } from 'vitest';
import { buildDayCardPrimitives, CARD_WIDTH } from './layout';
import { dayCardCompactHourLabel, type DayCardData } from './model';
import { estimateTextWidth } from './primitives';
import type { TextRun, Primitive, Rect } from './primitives';

// Geometry, arithmetic-identity and determinism tests for the day card's
// positioned-primitives layout. Uses the deterministic estimator rather than
// a real font, so these prove the LAYOUT's own rules — nothing runs off the
// card, nothing overlaps, nothing sits under the design's 28px floor — with
// no dependency on which real typeface is loaded when this runs. See
// primitives.ts for why the estimator exists.

const MIN_TEXT = 28;

function base(overrides: Partial<DayCardData> = {}): DayCardData {
    return {
        stallName: 'Mama Chapo',
        dateLabel: 'Sat 26 Sep',
        hasCash: false,
        heroLabel: 'M-PESA SALES TODAY',
        heroAmount: 'Ksh 1,750',
        paymentSplitLine: null,
        saleCountLabel: '5',
        averageLabel: 'Ksh 350',
        averageExcludesNote: null,
        primaryTile: { kind: 'peakHour', label: '1 to 2 PM' },
        buckets: [
            { label: 'Combo sales', amount: 'Ksh 1,400', share: 0.8 },
            { label: 'Dessert sales', amount: 'Ksh 350', share: 0.2 },
        ],
        otherBucketsLabel: null,
        singleBucketLine: null,
        topBucketSentence: 'Combo sales were 80% of the day.',
        footerLine: 'M-Pesa sales only  ·  Made with M-Track',
        unsortedNote: null,
        missingTimesNote: null,
        duplicatesNote: null,
        balanceNote: null,
        currency: 'KES',
        saleCount: 5,
        totalAmount: 1750,
        ...overrides,
    };
}

function isTextRun(p: Primitive): p is TextRun {
    return p.kind === 'text';
}
function isRect(p: Primitive): p is Rect {
    return p.kind === 'rect';
}

// A conservative bounding box for a text run, from the estimator — enough to
// catch a real collision, not a promise of pixel-exact typography.
function textBox(t: TextRun): { left: number; right: number; top: number; bottom: number } {
    const w = estimateTextWidth(t.text, t.font, t.size, t.weight);
    const left = t.align === 'left' ? t.x : t.align === 'center' ? t.x - w / 2 : t.x - w;
    return { left, right: left + w, top: t.y, bottom: t.y + t.size * 1.25 };
}

function rectsOverlap(a: { left: number; right: number; top: number; bottom: number }, b: typeof a): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('day card layout: geometry', () => {
    const result = buildDayCardPrimitives(base(), { theme: 'dark', measure: estimateTextWidth });

    it('produces a card at the export width, with a positive height', () => {
        expect(result.width).toBe(CARD_WIDTH);
        expect(result.height).toBeGreaterThan(0);
    });

    it('keeps every primitive fully inside the card bounds', () => {
        for (const p of result.primitives) {
            if (isRect(p)) {
                expect(p.x).toBeGreaterThanOrEqual(0);
                expect(p.y).toBeGreaterThanOrEqual(0);
                expect(p.x + p.width).toBeLessThanOrEqual(result.width + 0.5);
                expect(p.y + p.height).toBeLessThanOrEqual(result.height + 0.5);
            } else {
                const box = textBox(p);
                expect(box.left).toBeGreaterThanOrEqual(-1);
                expect(box.right).toBeLessThanOrEqual(result.width + 1);
                expect(box.top).toBeGreaterThanOrEqual(0);
                expect(box.bottom).toBeLessThanOrEqual(result.height + 1);
            }
        }
    });

    it('never sets text below the design\'s 28px floor', () => {
        for (const p of result.primitives.filter(isTextRun)) {
            expect(p.size).toBeGreaterThanOrEqual(MIN_TEXT);
        }
    });

    it('never overlaps two text runs that land on the same row', () => {
        const texts = result.primitives.filter(isTextRun);
        for (let i = 0; i < texts.length; i++) {
            for (let j = i + 1; j < texts.length; j++) {
                expect(rectsOverlap(textBox(texts[i]), textBox(texts[j]))).toBe(false);
            }
        }
    });

    it('renders exactly three tiles, none of which have their value clipped by fitWidth', () => {
        const tileRects = result.primitives.filter(isRect).filter(r => r.height === 184);
        expect(tileRects).toHaveLength(3);
        const fitted = result.primitives.filter(isTextRun).filter(t => t.fitWidth != null);
        for (const t of fitted) {
            expect(estimateTextWidth(t.text, t.font, t.size, t.weight)).toBeLessThanOrEqual(t.fitWidth! + 0.5);
        }
    });
});

describe('day card layout: never wraps a tile value, falls back to the compact hour form instead', () => {
    it('uses the compact peak-hour label when the full one will not fit even at the floor size', () => {
        const data = base({ primaryTile: { kind: 'peakHour', label: '11 AM to 12 PM' } });
        // A narrower-than-export card leaves each tile just enough room for
        // the compact form but not the full one.
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth, width: 912 });
        const compact = dayCardCompactHourLabel('11 AM to 12 PM');
        const values = result.primitives.filter(isTextRun).map(t => t.text);
        expect(values).toContain(compact);
        expect(values).not.toContain('11 AM to 12 PM');
    });
});

describe('day card layout: long free text never collides with a fixed neighbour', () => {
    it('truncates a very long stall name rather than overlapping the date', () => {
        const data = base({ stallName: 'The Absolutely Best Chapati and Mandazi Stall In All Of Nairobi County' });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const texts = result.primitives.filter(isTextRun);
        const name = texts.find(t => t.align === 'left' && t.y === texts.find(x => x.align === 'right')!.y);
        expect(name).toBeTruthy();
        expect(name!.text.endsWith('…')).toBe(true);
        for (let i = 0; i < texts.length; i++) {
            for (let j = i + 1; j < texts.length; j++) {
                expect(rectsOverlap(textBox(texts[i]), textBox(texts[j]))).toBe(false);
            }
        }
    });

    it('truncates a very long bucket name rather than overlapping its own amount', () => {
        const data = base({
            buckets: [
                { label: 'Combo sales with extra cheese and a side of fries and a free drink included', amount: 'Ksh 1,400', share: 0.8 },
                { label: 'Dessert sales', amount: 'Ksh 350', share: 0.2 },
            ],
        });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const bucketName = result.primitives.filter(isTextRun).find(t => t.text.startsWith('Combo sales with'));
        expect(bucketName!.text.endsWith('…')).toBe(true);
    });

    it('renders every bucket amount exactly as given, never truncating or reformatting the figure', () => {
        const data = base({
            buckets: [
                { label: 'Combo sales', amount: 'Ksh 999,999,999', share: 0.8 },
                { label: 'Dessert sales', amount: 'Ksh 350', share: 0.2 },
            ],
        });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts).toContain('Ksh 999,999,999');
        expect(texts).toContain('Ksh 350');
    });
});

describe('day card layout: the hero auto-fits at any length', () => {
    it('shrinks a nine-digit hero figure to stay on the card, never wrapping it', () => {
        const data = base({ heroAmount: 'Ksh 123,456,789' });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const heroRuns = result.primitives.filter(isTextRun).filter(t => t.text === 'Ksh 123,456,789');
        expect(heroRuns).toHaveLength(1);
        expect(heroRuns[0].size).toBeGreaterThanOrEqual(MIN_TEXT);
    });
});

describe('day card layout: adaptive collapse', () => {
    it('draws the single-bucket sentence, and no bucket rows, when buckets is null', () => {
        const data = base({ buckets: null, singleBucketLine: 'All in Combo sales.', topBucketSentence: null });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts.join(' ')).toContain('All in Combo sales.');
    });

    it('draws the average-excludes-lump-sum note when present, and omits it when absent', () => {
        const withNote = buildDayCardPrimitives(
            base({ averageExcludesNote: 'Average excludes cash entered as a lump sum.' }),
            { theme: 'dark', measure: estimateTextWidth },
        );
        const withoutNote = buildDayCardPrimitives(base(), { theme: 'dark', measure: estimateTextWidth });
        expect(withNote.primitives.filter(isTextRun).some(t => t.text.includes('lump sum'))).toBe(true);
        expect(withoutNote.primitives.filter(isTextRun).some(t => t.text.includes('lump sum'))).toBe(false);
    });

    it('draws the payment split line only when the day has cash', () => {
        const withCash = buildDayCardPrimitives(
            base({ hasCash: true, paymentSplitLine: 'M-Pesa Ksh 1,000  ·  Cash Ksh 750' }),
            { theme: 'dark', measure: estimateTextWidth },
        );
        expect(withCash.primitives.filter(isTextRun).some(t => t.text.includes('Cash Ksh 750'))).toBe(true);
    });
});

describe('day card layout: private notes never reach the exported primitives', () => {
    it('never draws unsortedNote, missingTimesNote, duplicatesNote or balanceNote text', () => {
        const data = base({
            unsortedNote: { count: 3, amountLabel: 'Ksh 450' },
            missingTimesNote: { count: 2 },
            duplicatesNote: { count: 1 },
            balanceNote: { kind: 'shortfall', amountLabel: 'Ksh 99' },
        });
        const result = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const joined = result.primitives.filter(isTextRun).map(t => t.text).join(' | ');
        expect(joined).not.toMatch(/shortfall|Ksh 99|Ksh 450/);
    });
});

describe('day card layout: determinism', () => {
    it('produces identical primitives for the same input, every time', () => {
        const data = base();
        const a = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const b = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        expect(a).toEqual(b);
    });

    it('the two themes produce the same text and positions, only different colours', () => {
        const data = base();
        const dark = buildDayCardPrimitives(data, { theme: 'dark', measure: estimateTextWidth });
        const light = buildDayCardPrimitives(data, { theme: 'light', measure: estimateTextWidth });
        expect(dark.primitives.map(p => (p.kind === 'text' ? p.text : `${p.x},${p.y},${p.width},${p.height}`)))
            .toEqual(light.primitives.map(p => (p.kind === 'text' ? p.text : `${p.x},${p.y},${p.width},${p.height}`)));
        expect(dark.background).not.toBe(light.background);
    });
});
