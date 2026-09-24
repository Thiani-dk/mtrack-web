import { describe, expect, it } from 'vitest';
import { parseAmountReply } from './conversationalCapture';
import { composeDraftAnswer, emptyCaptureDraft } from './captureDraft';

// A Swahili numeral, given as the answer to "How much was it?".
//
// From the flow sweep. parseAmountReply was the one entry point that skipped
// the shared normalisation, and parseNumeric's shorthand table was the one
// shorthand table without the Swahili multipliers in it — the amount extractor
// has carried them since the Swahili work went in. Between them, "elfu tatu"
// read as three thousand in free text and as nothing at all the moment it was
// the reply to a direct question. The flow understood the user's Swahili right
// up until it asked them something.

const NOW = new Date('2026-09-12T09:00:00');

describe('a Swahili amount as an answer', () => {
    it.each([
        ['elfu tatu', 3000],
        ['elfu mbili', 2000],
        ['mia tano', 500],
        ['elfu 3', 3000],
    ])('reads "%s"', (text, expected) => {
        expect(parseAmountReply(text).amount).toBe(expected);
    });

    it('fills the slot through the production reducer', () => {
        const c = composeDraftAnswer(emptyCaptureDraft(), 'amount', 'elfu tatu', NOW);
        expect(c.accepted).toBe(true);
        expect(c.draft.amount).toBe(3000);
    });

    it('agrees with what free text already read', () => {
        // The two paths disagreeing is the whole defect, so they are asserted
        // against each other rather than against a literal.
        expect(parseAmountReply('elfu tatu').amount).toBe(3000);
    });
});

describe('what the shared normalisation must not disturb', () => {
    it.each([
        ['3100', 3100],
        ['100k USD', 100_000],
        ['Ksh 45,000', 45_000],
        ['about 5.5k', 5500],
        ['free', 0],
    ])('still reads "%s"', (text, expected) => {
        expect(parseAmountReply(text).amount).toBe(expected);
    });

    it('still refuses a numeral owned by a date phrase', () => {
        expect(parseAmountReply('3 days ago').amount).toBeNull();
    });

    it('still keeps a currency stated in the answer', () => {
        expect(parseAmountReply('100k USD').detectedCurrency).toBe('USD');
    });
});
