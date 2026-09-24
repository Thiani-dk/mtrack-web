import { describe, expect, it } from 'vitest';
import { composeDraftAnswer, emptyCaptureDraft } from './captureDraft';
import { buildConfirmSentence, openSlots } from './conversationalCapture';
import { parseAmountAnswer } from './parsers/extractors/numeric';

// "It was free."
//
// From the flow sweep, and the only finding that was a flat dead end. Zero
// counted as no amount at all, so every way of saying it — "0", "free",
// "nothing", "it was free", "0 ksh" — was rejected, the question came back
// unchanged, and cancelling the whole capture was the only way out. A gift, a
// sample or a zero-rated line could not be recorded.

const NOW = new Date('2026-09-12T09:00:00');
const answer = (text: string) => composeDraftAnswer(emptyCaptureDraft(), 'amount', text, NOW);

describe('zero as an answer to "how much was it?"', () => {
    it.each(['0', '0 ksh', 'free', 'nothing', 'it was free', 'a gift', 'zero', 'no charge'])(
        'accepts "%s"', text => {
            const c = answer(text);
            expect(c.accepted).toBe(true);
            expect(c.draft.amount).toBe(0);
        });

    it('closes the amount slot rather than asking again', () => {
        expect(openSlots(answer('free').draft)).not.toContain('amount');
    });

    it('confirms it as a figure, not as a blank', () => {
        expect(buildConfirmSentence({
            amount: 0, currency: { code: 'KES', explicit: false }, recipient: 'Sample',
            direction: { type: 'sent', confidence: 95, source: 'keyword' },
            purposeLabel: null, dateLabel: '11 September 2026', dateSkipped: false, lineItems: null,
        })).toContain('Ksh 0 to Sample');
    });
});

describe('what zero must not swallow', () => {
    it('still rejects an answer with no figure in it', () => {
        const c = answer('blah');
        expect(c.accepted).toBe(false);
        expect(c.draft.amount).toBeNull();
    });

    it('does not read "free" inside an ordinary phrase as a total', () => {
        expect(parseAmountAnswer('free delivery on orders over 2000')).toBe(2000);
    });

    it('still reads a real figure', () => {
        expect(answer('3100').draft.amount).toBe(3100);
        expect(answer('100k USD').draft.amount).toBe(100_000);
    });
});
