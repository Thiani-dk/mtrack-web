import { describe, expect, it } from 'vitest';
import { extractDescription, openSlots } from './conversationalCapture';
import { composeDescription, emptyCaptureDraft } from './captureDraft';

// A paragraph describing a whole day's shopping.
//
// From the flow sweep. Segment splitting itself held up — nothing was truncated
// and no cap was hit — but one of the ten prices was lost, so the total came to
// Ksh 2,410 against a stated Ksh 2,660, with nothing to show anything had gone.
//
// The cause was one missing cue phrase. "came to 250" carried no recognised
// amount, so the whole clause fell through as a price-less fragment and was
// carried forward as the DESCRIPTION of the next item, which is why the
// document also read "Lunch at the kibanda came to 250, way home i picked up
// bread" at Ksh 60. The missing price and the mangled description were one
// fault, not two.

const NOW = new Date('2026-09-12T09:00:00');

const LONG = 'ok so today was a big day. i started at the market and bought tomatoes for 200, '
    + 'then onions for 150, then i walked to the butcher and got beef for 900, '
    + 'after that i needed airtime so i bought airtime worth 100, '
    + 'then lunch at the kibanda came to 250, and on the way home i picked up bread for 60, '
    + 'milk for 120, sugar for 180, cooking oil for 400 and finally some fruit for 300';

describe("a paragraph-length day's shopping", () => {
    const d = extractDescription(LONG, NOW);

    it('keeps every one of the ten prices', () => {
        expect(d.itemisation?.items.map(i => i.amount))
            .toEqual([200, 150, 900, 100, 250, 60, 120, 180, 400, 300]);
    });

    it('totals what the user actually said', () => {
        expect(d.amount).toBe(2660);
    });

    it('does not staple the lost clause onto the next item', () => {
        expect(d.itemisation?.items.map(i => i.description)).toEqual([
            'Tomatoes', 'Onions', 'Beef', 'Airtime', 'Lunch at the kibanda',
            'Bread', 'Milk', 'Sugar', 'Cooking oil', 'Finally some fruit',
        ]);
    });

    it('needs nothing further asked — the date is in the message', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), LONG, NOW);
        expect(openSlots(draft)).toEqual([]);
    });
});

describe('the ways people say a bill came to a figure', () => {
    it.each([
        ['lunch came to 250', 250],
        ['the bill comes to 1500', 1500],
        ['it added up to 900', 900],
        ['the shopping amounted to 2300', 2300],
    ])('reads "%s"', (message, expected) => {
        expect(extractDescription(message, NOW).amount).toBe(expected);
    });

    it('does not turn a bare "to" into a money cue', () => {
        // The phrase is what was added, not the preposition — "to" sits in
        // front of a great many numbers that are not prices.
        expect(extractDescription('i went to 5 shops', NOW).amount).toBeNull();
        expect(extractDescription('i walked to 3 markets', NOW).amount).toBeNull();
    });
});
