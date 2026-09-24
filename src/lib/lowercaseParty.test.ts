import { describe, expect, it } from 'vitest';
import { extractDescription, openSlots } from './conversationalCapture';
import { composeDescription, emptyCaptureDraft } from './captureDraft';

// "gave mum 2000" — a party named by relationship rather than by name.
//
// From the flow sweep, and the finding most likely to be common in practice.
// Capitalisation is the only signal a name gives, and most people typing on a
// phone give none, so the message lost BOTH fields: no recipient, and no
// amount either, because the cue word could not reach across a span it did not
// recognise as a party.
//
// It cannot be fixed by relaxing the capitalisation rule — that rule is what
// the Phase 2 work rests on and what keeps reference codes and weekdays out.
// So a second, closed signal: a short list of words that can only be a person.

const NOW = new Date('2026-09-12T09:00:00');
const read = (m: string) => extractDescription(m, NOW);

describe('a party named by relationship', () => {
    it.each([
        ['gave mum 2000', 'Mum', 2000],
        ['sent my landlord 15000', 'My landlord', 15_000],
        ['paid the fundi 1200', 'The fundi', 1200],
        ['gave mama mboga 150', 'Mama mboga', 150],
        ['paid my boss 300', 'My boss', 300],
    ])('reads both fields out of "%s"', (message, recipient, amount) => {
        const d = read(message);
        expect(d.recipient).toBe(recipient);
        expect(d.amount).toBe(amount);
    });

    it('leaves only the date to ask about', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), 'gave mum 2000', NOW);
        expect(openSlots(draft)).toEqual(['date']);
    });
});

describe('what a relationship word must not licence', () => {
    it('does not make every lowercase word a party', () => {
        // The list is closed. An ordinary noun in the same position still
        // leaves the figure unclaimed, exactly as before.
        expect(read('paid rent 5000').amount).toBeNull();
        expect(read('gave up 2000').amount).toBeNull();
        expect(read('paid the 500').amount).toBeNull();
    });

    it('does not rescue a lowercase personal name', () => {
        // "kevin" is a name, not a relationship, and nothing here can tell it
        // from an ordinary word. Stated so the limit is known rather than
        // assumed away.
        expect(read('paid kevin 500').amount).toBeNull();
    });

    it('keeps every Phase 2 guard intact', () => {
        for (const text of ['paid Kevin Ref QGH4R7TY9P', 'paid Kevin Tuesday 500',
            'paid Kevin around 7pm', 'paid Kevin 20%', 'sent Kevin on 12/09/2026']) {
            expect(read(text).amount).toBeNull();
        }
    });

    it('does not take "Ref" as part of a payee', () => {
        expect(read('paid Kevin Ref QGH4R7TY9P').recipient).toBe('Kevin');
    });
});
