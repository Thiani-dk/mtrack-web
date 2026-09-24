import { describe, expect, it } from 'vitest';
import { extractDescription } from './conversationalCapture';

// "500/=" — the Kenyan way of writing a price without naming Shillings.
//
// From the flow sweep. The rule for it was written, and never once fired:
// isBareMoney tested the date-separator guard first, and a slash after a
// number matched it, so the branch below was unreachable. "lunch 500/= and
// beer 300/=" extracted no amount at all and the flow asked how much. "1200/-",
// the other common form, was not listed anywhere.

const NOW = new Date('2026-09-12T09:00:00');
const amountOf = (m: string) => extractDescription(m, NOW).amount;

describe('a price written with a trailing slash', () => {
    it('reads the form that was listed but unreachable', () => {
        expect(amountOf('paid 500/=')).toBe(500);
    });

    it('reads the dash form too', () => {
        expect(amountOf('bought maize for 1200/-')).toBe(1200);
    });

    it('itemises a list written that way', () => {
        const d = extractDescription('lunch 500/=, beer 300/=, chips 100/=', NOW);
        expect(d.itemisation?.items.map(i => [i.description, i.amount]))
            .toEqual([['Lunch', 500], ['Beer', 300], ['Chips', 100]]);
        expect(d.amount).toBe(900);
    });

    it('works with no cue word in front of it, which is the point', () => {
        // Nothing marks these as money except the slash itself.
        expect(amountOf('lunch 500/= and beer 300/=')).toBe(800);
    });
});

describe('the date and time guards it now runs ahead of', () => {
    it('still refuses a date', () => {
        expect(extractDescription('bought bread for 60 on 12/09/2026', NOW).amount).toBe(60);
    });

    it('still refuses a clock time', () => {
        expect(amountOf('paid at 7:30')).toBeNull();
    });

    it('still refuses a plain fraction', () => {
        expect(amountOf('ratio was 3/4 today')).toBeNull();
    });
});
