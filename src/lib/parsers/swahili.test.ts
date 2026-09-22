import { describe, expect, it } from 'vitest';
import { normalizeSwahiliNumerals, swahiliVerbDirection } from './swahili';
import { classifyMessage } from './classify';
import { parseConversationalDate } from './conversationalDate';
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

describe('Swahili relative dates', () => {
    // Through parseConversationalDate, not a parallel reader, so the bounds
    // rules and the rest of that parser's discipline apply unchanged.
    const on = (text: string) => parseConversationalDate(text, NOW);

    it('reads leo as today and jana as yesterday', () => {
        expect(on('leo').date).toEqual(new Date('2026-09-12T12:00:00'));
        expect(on('jana').date).toEqual(new Date('2026-09-11T12:00:00'));
        expect(on('leo').confidence).toBe('exact');
        expect(on('jana').confidence).toBe('exact');
    });

    it('reads juzi as the day before yesterday, not as jana', () => {
        expect(on('juzi').date).toEqual(new Date('2026-09-10T12:00:00'));
    });

    it('reads them mid-sentence, with no language detection', () => {
        expect(on('nilinunua bacon kwa elfu tatu leo').date)
            .toEqual(new Date('2026-09-12T12:00:00'));
        expect(on('bought bacon for 3100 jana').date)
            .toEqual(new Date('2026-09-11T12:00:00'));
    });

    it('does not fire on those letters inside a longer word', () => {
        // A word boundary, not a substring, exactly as the English words are
        // matched. "chameleon" contains "leo"; "Leonard" starts with it.
        expect(on('bought a chameleon').confidence).not.toBe('exact');
        expect(on('paid Leonard').confidence).not.toBe('exact');
    });

    it('reads a capitalised "Jana" mid-sentence as a name, not as yesterday', () => {
        // "paid Jana 500" dated the record to yesterday — a wrong date applied
        // silently, which is the worst shape this can take. Capitalisation is
        // the signal, the same one extractFreeformName already relies on.
        expect(on('paid Jana 500').confidence).not.toBe('exact');
        expect(on('sent Jana 200').date).toBeNull();
        // And the name still reaches the draft as the recipient.
        expect(extractDescription('paid Jana 500', NOW).recipient).toBe('Jana');
    });

    it('still reads it at the start of a message, where a capital says nothing', () => {
        // Sentence-initial capitalisation is not evidence of a name.
        expect(on('Jana nilinunua bacon').date).toEqual(new Date('2026-09-11T12:00:00'));
        expect(on('Leo nilinunua bacon').date).toEqual(new Date('2026-09-12T12:00:00'));
    });

    it('still reads a lowercase one mid-sentence', () => {
        expect(on('nilinunua bacon jana').date).toEqual(new Date('2026-09-11T12:00:00'));
    });

    it('reaches the capture flow, so the date slot closes', () => {
        const r = extractDescription('nilinunua bacon kwa elfu tatu leo', NOW);
        expect(r.amount).toBe(3000);
        expect(r.date).toEqual(new Date('2026-09-12T12:00:00'));
        expect(r.missing).not.toContain('date');
    });
});

describe('"day before yesterday", which was unreachable', () => {
    it('is no longer swallowed by the plain "yesterday" test', () => {
        // The longer phrase contains the shorter one, and sat AFTER it, so it
        // resolved to one day ago rather than two for as long as it existed.
        expect(parseConversationalDate('day before yesterday', NOW).date)
            .toEqual(new Date('2026-09-10T12:00:00'));
    });
});
