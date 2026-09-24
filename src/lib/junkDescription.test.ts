import { describe, expect, it } from 'vitest';
import { extractDescription, openSlots } from './conversationalCapture';
import { composeDescription, emptyCaptureDraft } from './captureDraft';

// "got 500 back" was filed with the description "Back".
//
// From the flow sweep. The leftover word from the sentence around the price
// survived tidying and was handed over as the goods, so the document's
// description column read "BACK". Low cost — it is visible and the user can
// correct it — but it is the flow inventing content, which is the one thing
// the description reader is supposed not to do.

const NOW = new Date('2026-09-12T09:00:00');
const read = (m: string) => extractDescription(m, NOW);

describe('leftover words are not a description', () => {
    it.each(['got 500 back', 'paid 500 back'])('gives nothing for "%s"', message => {
        expect(read(message).recipient).toBeNull();
    });

    it('asks for one instead of inventing it', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), 'got 500 back', NOW);
        expect(openSlots(draft)).toContain('description');
    });

    it('reads the party when the sentence names one', () => {
        // "from" was missing from the verbs that introduce a party, so this
        // fell through to the goods reader and came back as "Back from Kevin".
        expect(read('got 500 back from Kevin').recipient).toBe('Kevin');
        expect(read('got 500 back from mum').recipient).toBe('Mum');
    });
});

describe('real descriptions are untouched', () => {
    it.each([
        ['bought bread for 60', 'Bread'],
        ['chicken wings worth 2999 ksh', 'Chicken wings'],
        ['sold 3 chapati for 150', 'Chapati'],
    ])('keeps "%s" reading as %s', (message, expected) => {
        expect(read(message).recipient).toBe(expected);
    });
});
