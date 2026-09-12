import { describe, expect, it } from 'vitest';
import {
    advanceDateRetry, isProductiveDateAnswer, NO_DATE_RETRIES,
    parseConversationalDate, DATE_REASON_TOO_OLD,
} from './conversationalDate';

// The retry cap on the "when was that?" question.
//
// It exists to stop an infinite loop when someone keeps typing things no parser
// can read. It was never meant to discard a fresh, valid date just because it
// was the second thing they typed — which is what it did in a real run:
//
//   Bot:  When was that?
//   User: 4/5/2025
//   Bot:  That's more than a year back. I can only track the last 12 months.
//   User: 4/5/2026
//   Bot:  Let's leave the date off this one rather than guess.
//
// 4/5/2026 is a real date, in range, and ambiguous exactly the way 9/2/2026 is
// — it should have been asked about, not thrown away.

const MAX = 2;
const NOW = new Date('2026-09-12T09:00:00');

// One turn of the exchange: parse the answer, fold it into the retry state,
// and report what the bot would say back.
function turn(state: typeof NO_DATE_RETRIES, answer: string) {
    const result = parseConversationalDate(answer, NOW);
    const { state: next, giveUp } = advanceDateRetry(state, answer, result, MAX);
    return { result, state: next, giveUp, says: giveUp ? 'GIVE_UP' : result.reason ?? 'ACCEPTED' };
}

describe('the exact transcript', () => {
    it('rejects 4/5/2025 for being too old', () => {
        const first = turn(NO_DATE_RETRIES, '4/5/2025');
        expect(first.result.confidence).toBe('invalid');
        expect(first.says).toBe(DATE_REASON_TOO_OLD);
        // A genuine failure, so it counts against the cap.
        expect(first.state.attempts).toBe(1);
        expect(first.giveUp).toBe(false);
    });

    it('then asks about 4/5/2026 instead of discarding it', () => {
        const first = turn(NO_DATE_RETRIES, '4/5/2025');
        const second = turn(first.state, '4/5/2026');

        // This is the bug. Before the fix the second answer tripped the cap
        // and the date was abandoned.
        expect(second.giveUp).toBe(false);
        expect(second.result.confidence).toBe('needs_clarification');
        expect(second.says).toBe('Is that 4 May 2026 or 5 April 2026?');
        // A real reading exists, so the failure count resets.
        expect(second.state.attempts).toBe(0);
    });

    it('settles on the answer to that question', () => {
        const first = turn(NO_DATE_RETRIES, '4/5/2025');
        const second = turn(first.state, '4/5/2026');
        const third = turn(second.state, '4 May 2026');

        expect(third.result.confidence).toBe('exact');
        expect(third.result.interpretation).toBe('4 May 2026');
        expect(third.giveUp).toBe(false);
    });
});

describe('what counts as progress', () => {
    it('a date that only needs disambiguating does', () => {
        // Both readings real and in range — the same shape as 9/2/2026.
        expect(isProductiveDateAnswer(parseConversationalDate('4/5/2026', NOW))).toBe(true);
        expect(isProductiveDateAnswer(parseConversationalDate('9/2/2026', NOW))).toBe(true);
    });

    it('an accepted date does', () => {
        expect(isProductiveDateAnswer(parseConversationalDate('yesterday', NOW))).toBe(true);
    });

    it('unreadable text does not', () => {
        expect(isProductiveDateAnswer(parseConversationalDate('sometime probably', NOW))).toBe(false);
    });

    it('a date resolved and then rejected by the bounds does not', () => {
        // It parsed, but we are left with no usable date either way.
        expect(isProductiveDateAnswer(parseConversationalDate('4/5/2025', NOW))).toBe(false);
        expect(isProductiveDateAnswer(parseConversationalDate('4/5/2027', NOW))).toBe(false);
    });
});

describe('9/2/2026, unchanged', () => {
    it('still asks which way to read it', () => {
        const only = turn(NO_DATE_RETRIES, '9/2/2026');
        expect(only.says).toBe('Is that 9 February 2026 or 2 September 2026?');
        expect(only.giveUp).toBe(false);
    });

    it('and still does so when it is not the first thing typed', () => {
        const first = turn(NO_DATE_RETRIES, 'no idea really');
        expect(first.state.attempts).toBe(1);
        const second = turn(first.state, '9/2/2026');
        expect(second.giveUp).toBe(false);
        expect(second.says).toBe('Is that 9 February 2026 or 2 September 2026?');
    });
});

describe('the cap still guards against a real loop', () => {
    it('gives up after two consecutive unreadable answers', () => {
        const first = turn(NO_DATE_RETRIES, 'dunno');
        expect(first.giveUp).toBe(false);
        const second = turn(first.state, 'cant remember');
        expect(second.giveUp).toBe(true);
    });

    it('gives up after two out-of-range dates in a row', () => {
        const first = turn(NO_DATE_RETRIES, '4/5/2025');
        const second = turn(first.state, '1/1/2020');
        expect(second.giveUp).toBe(true);
    });

    it('does not let the same ambiguous answer loop forever', () => {
        // Answering "is that 4 May or 5 April?" with the identical string is
        // not a fresh attempt, however well it parses.
        const first = turn(NO_DATE_RETRIES, '4/5/2026');
        expect(first.giveUp).toBe(false);
        const second = turn(first.state, '4/5/2026');
        expect(second.state.attempts).toBe(1);
        const third = turn(second.state, ' 4/5/2026 ');
        expect(third.giveUp).toBe(true);
    });

    it('counts consecutively, so one good answer clears the slate', () => {
        const first = turn(NO_DATE_RETRIES, 'dunno');
        const second = turn(first.state, '4/5/2026');
        expect(second.state.attempts).toBe(0);
        // A later failure starts from scratch rather than tripping the cap.
        const third = turn(second.state, 'no clue');
        expect(third.giveUp).toBe(false);
        expect(third.state.attempts).toBe(1);
    });
});
