import { describe, expect, it } from 'vitest';
import { extractDescription } from './conversationalCapture';
import {
    advanceZeroUnderstanding, MAX_ZERO_UNDERSTANDING, NO_ZERO_UNDERSTANDING, understoodNothing,
} from './zeroUnderstanding';

const NOW = new Date('2026-09-12T09:00:00');
const nothingIn = (text: string) => understoodNothing(extractDescription(text, NOW));

describe('telling zero understanding from partial', () => {
    it('fires only when every extractable field came back empty', () => {
        expect(nothingIn('asdkjh qwe zzz')).toBe(true);
        expect(nothingIn('hello there')).toBe(true);
        expect(nothingIn('???')).toBe(true);
    });

    it('does NOT fire on a message that is merely incomplete', () => {
        // The case this must never break: an item with no price still earns
        // the targeted "how much was that?", not "I didn't follow you".
        expect(nothingIn('bought bacon')).toBe(false);
        expect(nothingIn('i paid Kevin')).toBe(false);
        expect(nothingIn('3100')).toBe(false);
        expect(nothingIn('yesterday')).toBe(false);
        expect(nothingIn('it was in USD')).toBe(false);
        expect(nothingIn('bought bacon for 3100')).toBe(false);
    });

    it('does not fire on the message that started all this', () => {
        expect(nothingIn('hi so, i spent quite a lot today. i boought somebacon and pork cuts '
            + 'for 3100, then i bought airtime worth 30')).toBe(false);
    });
});

describe('the fallback response', () => {
    it('says plainly that it did not follow, rather than asking for one field', () => {
        const { response } = advanceZeroUnderstanding(NO_ZERO_UNDERSTANDING, true);
        expect(response?.kind).toBe('ask');
        expect(response && 'text' in response ? response.text : '').toContain("couldn't pick anything out");
        expect(response && 'text' in response ? response.text : '').not.toContain('How much was it?');
    });

    it('varies its wording rather than repeating itself', () => {
        const first = advanceZeroUnderstanding(NO_ZERO_UNDERSTANDING, true);
        const second = advanceZeroUnderstanding(first.state, true);
        const textOf = (r: typeof first.response) => (r && 'text' in r ? r.text : '');
        expect(textOf(second.response)).not.toBe(textOf(first.response));
        expect(second.response?.kind).toBe('ask');
    });

    it('offers a way out on the third, rather than asking a fourth time', () => {
        let state = NO_ZERO_UNDERSTANDING;
        const kinds: Array<string | undefined> = [];
        for (let i = 0; i < 3; i++) {
            const step = advanceZeroUnderstanding(state, true);
            state = step.state;
            kinds.push(step.response?.kind);
        }
        expect(kinds).toEqual(['ask', 'ask', 'escape']);
        expect(kinds.filter(k => k === 'ask')).toHaveLength(MAX_ZERO_UNDERSTANDING);
    });

    it('offers tappable options, including pasting and skipping', () => {
        let state = NO_ZERO_UNDERSTANDING;
        for (let i = 0; i < 2; i++) state = advanceZeroUnderstanding(state, true).state;
        const { response } = advanceZeroUnderstanding(state, true);
        expect(response?.kind).toBe('escape');
        const values = response && response.kind === 'escape' ? response.options.map(o => o.value) : [];
        expect(values).toEqual(['paste', 'skip', 'restart']);
    });

    it('says nothing, and forgets the streak, once a message lands', () => {
        const first = advanceZeroUnderstanding(NO_ZERO_UNDERSTANDING, true);
        expect(first.state.consecutive).toBe(1);
        const understood = advanceZeroUnderstanding(first.state, false);
        expect(understood.response).toBeNull();
        expect(understood.state.consecutive).toBe(0);
        // And the next failure starts from the first wording again.
        expect(advanceZeroUnderstanding(understood.state, true).response)
            .toEqual(advanceZeroUnderstanding(NO_ZERO_UNDERSTANDING, true).response);
    });
});
