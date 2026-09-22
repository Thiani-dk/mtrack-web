import { describe, expect, it } from 'vitest';
import { normalizeSwahiliNumerals, swahiliVerbDirection } from './swahili';
import { classifyMessage } from './classify';
import { extractDescription, extractLineItems } from '../conversationalCapture';
import { understoodNothing } from '../zeroUnderstanding';

const NOW = new Date('2026-09-12T09:00:00');

describe('Swahili numerals', () => {
    it('reads the multiplier-first form', () => {
        expect(normalizeSwahiliNumerals('elfu tatu')).toBe('3 elfu');
        expect(normalizeSwahiliNumerals('mia tano')).toBe('5 mia');
        expect(normalizeSwahiliNumerals('elfu kumi')).toBe('10 elfu');
    });

    it('reads the digit form people mix in', () => {
        expect(normalizeSwahiliNumerals('elfu 3')).toBe('3 elfu');
    });

    it('leaves everything else alone', () => {
        expect(normalizeSwahiliNumerals('bought bacon for 3100')).toBe('bought bacon for 3100');
    });

    it('resolves to a real amount, with no currency token anywhere', () => {
        expect(extractDescription('nilinunua bacon kwa elfu tatu', NOW).amount).toBe(3000);
        expect(extractDescription('nilinunua mkate mia tano', NOW).amount).toBe(500);
    });
});

describe('Swahili verbs', () => {
    it('resolves direction from the verb itself', () => {
        expect(swahiliVerbDirection('nilinunua')).toBe('sent');
        expect(swahiliVerbDirection('nimelipa')).toBe('sent');
        expect(swahiliVerbDirection('nilipokea')).toBe('received');
        expect(swahiliVerbDirection('niliuza')).toBe('received');
        expect(swahiliVerbDirection('bacon')).toBeNull();
    });

    it('marks a Swahili message as a transaction', () => {
        expect(classifyMessage('Nilinunua bacon kwa Ksh 3000')).toBe('transaction');
    });

    it('reads direction in a whole sentence', () => {
        expect(extractDescription('nilinunua bacon kwa elfu tatu', NOW).direction.type).toBe('sent');
        expect(extractDescription('nilipokea elfu tano kutoka Kevin', NOW).direction.type).toBe('received');
    });
});

describe('code-switching, which is the normal case', () => {
    it('reads the design doc\'s worked example', () => {
        // Swahili verb, English items, English preposition, Swahili numeral —
        // all in one sentence, with no per-message language detection.
        const r = extractDescription('Nilinunua bacon na pork cuts for elfu tatu', NOW);
        expect(r.amount).toBe(3000);
        expect(r.direction.type).toBe('sent');
    });

    it('itemises across both languages', () => {
        const found = extractLineItems('nilinunua bacon kwa elfu tatu, mkate kwa mia tano',
            { allowBare: true });
        expect(found?.items.map(i => i.amount)).toEqual([3000, 500]);
        expect(found?.total).toBe(3500);
        expect(found?.items[0].description.toLowerCase()).toContain('bacon');
    });

    it('does not leave the Swahili verb in the item description', () => {
        const found = extractLineItems('nilinunua bacon kwa elfu tatu, mkate kwa mia tano',
            { allowBare: true });
        expect(found?.items[0].description.toLowerCase()).not.toContain('nilinunua');
    });
});

describe('what this deliberately does not attempt', () => {
    it('fails honestly on Swahili beyond the vocabulary, rather than half-reading it', () => {
        // No transaction verb, no numeral, nothing extractable — the same
        // honest fallback an unrecognised English sentence would get.
        const r = extractDescription('habari yako rafiki yangu', NOW);
        expect(understoodNothing(r)).toBe(true);
    });
});
