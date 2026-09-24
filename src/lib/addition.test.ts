import { describe, expect, it } from 'vitest';
import { composeDescription, emptyCaptureDraft, foldAddition } from './captureDraft';
import { isAffirmative } from './metaIntent';

// "Oh and airtime for 30", said at the confirmation.
//
// From the flow sweep. At the confirmation anything that is not "yes" was read
// as "no, start again": the whole draft was cleared and the questions began
// afresh from the date. One forgotten item cost the user everything they had
// already typed, with no warning and no way back.
//
// The sweep diagnosed this as composeDescription's replace-if-present
// semantics. That code is real but is NOT reachable from the chat — a later
// free-text message always arrives as an answer to a pending question, never
// through composeDescription with a populated draft. Driving it through the
// real UI found the reachable, and worse, version.

const NOW = new Date('2026-09-12T09:00:00');
const draftOf = (m: string) => composeDescription(emptyCaptureDraft(), m, NOW).draft;
const THREE = () => draftOf('bacon for 3100 and tomatoes for 400');

describe('one more thing, added at the confirmation', () => {
    it('appends the item and re-totals, rather than clearing the draft', () => {
        const out = foldAddition(THREE(), 'oh and airtime for 30', NOW);
        expect(out?.lineItems?.map(i => [i.description, i.amount]))
            .toEqual([['Bacon', 3100], ['Tomatoes', 400], ['Airtime', 30]]);
        expect(out?.amount).toBe(3530);
    });

    it('does not leave the cue word in the item description', () => {
        expect(foldAddition(THREE(), 'oh and airtime for 30', NOW)?.lineItems?.[2].description)
            .toBe('Airtime');
    });

    it('reads the phrasings people actually use', () => {
        for (const text of ['and airtime for 30', 'also airtime for 30', 'plus airtime for 30',
            'i also bought airtime for 30', 'oh i forgot airtime for 30']) {
            expect(foldAddition(THREE(), text, NOW)?.amount).toBe(3530);
        }
    });

    it('turns a single captured amount into the first line', () => {
        const out = foldAddition(draftOf('bacon for 3100'), 'and tomatoes for 400', NOW);
        expect(out?.lineItems?.map(i => [i.description, i.amount]))
            .toEqual([['Bacon', 3100], ['Tomatoes', 400]]);
        expect(out?.amount).toBe(3500);
    });
});

describe('what must NOT be folded in as an addition', () => {
    it('refuses a correction, which carries a figure too', () => {
        // Adding this would produce a total the user never said — worse than
        // the reset this replaces. The last three carry an addition cue AND a
        // correction marker, which is the only shape the correction guard
        // itself decides — each of them is folded in as a fourth item, for
        // Ksh 4,000, the moment that guard is removed.
        for (const text of ['actually it was 500', 'no wait, 500', 'i meant 500', 'sorry it was 500',
            'also i meant i paid 500', 'and actually i paid 500',
            'also, scratch that, bacon for 500']) {
            expect(foldAddition(THREE(), text, NOW)).toBeNull();
        }
    });

    it('refuses a plain rejection, leaving the existing behaviour alone', () => {
        for (const text of ['no', 'thats wrong', 'nope', '500']) {
            expect(foldAddition(THREE(), text, NOW)).toBeNull();
        }
    });

    it('refuses an addition cue with nothing priced behind it', () => {
        expect(foldAddition(THREE(), 'and that is all', NOW)).toBeNull();
    });

    it('refuses when there is nothing yet to add to', () => {
        expect(foldAddition(emptyCaptureDraft(), 'and airtime for 30', NOW)).toBeNull();
    });

    it('refuses to total across two currencies', () => {
        expect(foldAddition(THREE(), 'and a chip for 200 USD and lunch for 500 bob', NOW)).toBeNull();
    });
});

describe('the yes-words at the confirmation', () => {
    // Found while testing the above. The confirmation matched /^(y\b|yes|...)/,
    // and "yes" is a prefix of "yesterday" — so a user answering the
    // confirmation with a date approved the draft instead of correcting it,
    // and a record they never agreed to was saved.
    it('still accepts every way of saying yes', () => {
        for (const t of ['y', 'yes', 'yep', 'yeah', 'correct', 'right', 'ok', 'okay', 'sure',
            "that's right", 'thats right', '👍', 'Yes please']) {
            expect(isAffirmative(t)).toBe(true);
        }
    });

    it('does not read a date as approval', () => {
        for (const t of ['yesterday', 'yesterday around 7pm', 'rightaway', 'okra for 50']) {
            expect(isAffirmative(t)).toBe(false);
        }
    });
});
