import { describe, expect, it } from 'vitest';
import { extractAmount } from './parsers/extractors/amount';
import { extractDescription, openSlots } from './conversationalCapture';
import { composeDescription, composeDraftAnswer, emptyCaptureDraft } from './captureDraft';

// "i paid Kevin 500" — a name between the cue word and the figure.
//
// A bare number only counts as money where the sentence marks it as money, and
// the mark has to be a cue word immediately before it. "paid Kevin 500" puts
// the person in between, so the 500 was never claimed and the bot asked how
// much about a message that had just said. This is probably the commonest way
// an English sentence states a payment.
//
// The rule itself is sound and is what keeps reference codes, times, years and
// quantities from being read as money — "paid the 500" fails for exactly the
// same reason, which is what confirmed the cause was distance and nothing
// about names. So the exception is narrow: a run of capitalised words that
// could be a person, and nothing else.

const NOW = new Date('2026-09-12T09:00:00');
const bare = (text: string) => extractAmount(text, { allowBare: true })?.amount ?? null;

describe('a cue word reaching across a name', () => {
    it('claims the figure in the shape that was reported', () => {
        const d = extractDescription('i paid Kevin 500', NOW);
        expect(d.amount).toBe(500);
        expect(d.recipient).toBe('Kevin');
        expect(d.missing).not.toContain('amount');
    });

    it('asks only for the date, and nothing more after it', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), 'i paid Kevin 500', NOW);
        expect(openSlots(draft)).toEqual(['date']);
        expect(openSlots(composeDraftAnswer(draft, 'date', 'yesterday', NOW).draft)).toEqual([]);
    });

    it('reads a multi-word name', () => {
        const d = extractDescription('paid Mama Njeri 1200', NOW);
        expect(d.amount).toBe(1200);
        expect(d.recipient).toBe('Mama Njeri');
    });

    it('reads the other payment verbs the same way', () => {
        for (const text of ['sent Kevin 500', 'gave Kevin 500', 'paid Kevin 500 yesterday']) {
            expect(bare(text)).toBe(500);
        }
    });

    it('does not reach across anything that is not a name', () => {
        // The distance is not what is being allowed — the name is.
        expect(bare('paid the 500')).toBeNull();
        expect(bare('paid a Kevin 500')).toBeNull();
    });
});

describe('where a name ends', () => {
    it('does not take a currency token as part of the payee', () => {
        // "paid Kevin Ksh 500" was filed as a payment to "Kevin Ksh". The run
        // of capitalised words was rejected only when ALL of it was a currency
        // or a month, so one real name in front of it carried the rest through.
        const d = extractDescription('paid Kevin Ksh 500', NOW);
        expect(d.recipient).toBe('Kevin');
        expect(d.amount).toBe(500);
    });

    it('does not take a weekday as part of the payee', () => {
        expect(extractDescription('paid Kevin Tuesday', NOW).recipient).toBe('Kevin');
    });
});

describe('the guards the adjacency rule exists for', () => {
    it.each([
        ['a time', 'paid Kevin around 7pm'],
        ['a reference code', 'paid Kevin Ref QGH4R7TY9P'],
        ['a quantity', 'paid Kevin 3 x sodas'],
        ['a percentage', 'paid Kevin 20%'],
        ['a date', 'sent Kevin on 12/09/2026'],
        ['a clock time', 'paid Kevin at 7:30'],
        ['an ordinal', 'paid Kevin 3rd'],
        ['a weekday, not a figure', 'paid Kevin on Tuesday'],
        ['a capitalised word run into a figure', 'paid Kevin Tuesday 500'],
    ])('still refuses to read %s as an amount', (_what, text) => {
        expect(bare(text)).toBeNull();
    });

    it('reads a four-digit figure after a name as money, as it always has', () => {
        // Not a year guard, deliberately. "paid Kevin 2000" is two thousand
        // shillings, and there is nothing in "paid Kevin 2026" to tell it
        // apart — the same is true of "paid 2026", which has read as an amount
        // since bare numbers were first allowed. Noted rather than "fixed",
        // because a guard here would break the far commoner reading.
        expect(bare('paid 2026')).toBe(2026);
        expect(bare('paid Kevin 2026')).toBe(2026);
    });
});
