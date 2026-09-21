import { describe, expect, it } from 'vitest';
import { fuzzyCanonical, normalizeForKeywords, splitMergedWord, TRANSACTION_VERBS } from './fuzzy';
import { classifyMessage, hasTransactionVerb } from './classify';
import { extractDescription, extractLineItems } from '../conversationalCapture';

describe('fuzzy keyword matching', () => {
    it('reads real misspellings of transaction verbs as the verb', () => {
        expect(fuzzyCanonical('boought', TRANSACTION_VERBS)).toBe('bought');
        expect(fuzzyCanonical('recieved', TRANSACTION_VERBS)).toBe('received');
        expect(fuzzyCanonical('bougth', TRANSACTION_VERBS)).toBe('bought');
        expect(fuzzyCanonical('purchsed', TRANSACTION_VERBS)).toBe('purchased');
        expect(fuzzyCanonical('witdraw', TRANSACTION_VERBS)).toBe('withdraw');
    });

    it('leaves free text alone, however close to a keyword it lands', () => {
        // The failure this bound exists to prevent: a real word silently
        // becoming a different real word, with nothing said about it.
        expect(fuzzyCanonical('gold', TRANSACTION_VERBS)).toBeNull();
        expect(fuzzyCanonical('cold', TRANSACTION_VERBS)).toBeNull();
        expect(fuzzyCanonical('sand', TRANSACTION_VERBS)).toBeNull();
        // Item and merchant names, including deliberately odd ones.
        for (const name of ['bacon', 'chapati', 'garlic', 'Sambonani', 'Naivas', 'Quickmart', 'Zuchu']) {
            expect(fuzzyCanonical(name, TRANSACTION_VERBS)).toBeNull();
        }
    });

    it('never rewrites an item name inside a whole message', () => {
        const before = 'i boought gold and a chapati from Sambonani';
        const after = normalizeForKeywords(before);
        expect(after).toContain('bought');
        expect(after).toContain('gold');
        expect(after).toContain('chapati');
        expect(after).toContain('Sambonani');
    });

    it('does not run at all when the message spells a verb correctly', () => {
        // "gold" is one edit from "sold" and must survive — which it does
        // because an exactly-spelled verb switches the fuzzy pass off.
        expect(normalizeForKeywords("i sold gold for 5000")).toBe('i sold gold for 5000');
    });

    it('is applied by the SMS classifier as well as the typed path', () => {
        expect(hasTransactionVerb('You recieved Ksh500 from ALEX')).toBe(true);
        expect(classifyMessage('You recieved Ksh500 from ALEX')).toBe('transaction');
        expect(extractDescription('i boought bacon for 3100').amount).toBe(3100);
    });
});

describe('merged-word recovery', () => {
    it('recovers a quantity word run into its noun', () => {
        expect(splitMergedWord('somebacon')).toEqual(['some', 'bacon']);
        expect(splitMergedWord('afewtomatoes')).toEqual(['a', 'few', 'tomatoes']);
        expect(splitMergedWord('threesodas')).toEqual(['three', 'sodas']);
    });

    it('declines to touch genuine long words', () => {
        for (const word of [
            'motherboard', 'accommodation', 'refrigerator', 'electricity',
            'thermometer', 'somersaults', 'fourteen', 'tendencies', 'another',
        ]) {
            expect(splitMergedWord(word)).toBeNull();
        }
    });

    it('leaves transaction codes and anything with a digit alone', () => {
        expect(splitMergedWord('TFJ8K2L9M1')).toBeNull();
        expect(splitMergedWord('AB12CD34EF')).toBeNull();
    });

    it('feeds the recovered words into the item description', () => {
        const found = extractLineItems('i boought somebacon and pork cuts for 3100, milk for 80', { allowBare: true });
        expect(found?.items[0].description.toLowerCase()).toContain('bacon');
        expect(found?.items[0].description.toLowerCase()).not.toContain('somebacon');
        expect(found?.items[0].description.toLowerCase()).not.toContain('boought');
    });

    it('does not split a long merchant name in a real message', () => {
        expect(normalizeForKeywords("paid accommodation at Serena for 12000"))
            .toBe('paid accommodation at Serena for 12000');
    });
});

describe('the real fixture, through both mechanisms', () => {
    const REAL = 'hi so, i spent quite a lot today. i boought somebacon and pork cuts for 3100, '
        + 'then i rode a bus to a neighborhood where i bought tomatoes, ginger, chapati, onions, '
        + 'and garlic at 400. then i bought airtime worth 30';

    it('reads the typo and the merged word, not just around them', () => {
        const items = extractDescription(REAL).itemisation?.items ?? [];
        expect(items.map(i => i.amount)).toEqual([3100, 400, 30]);
        // The bacon survived the merge, and the typo'd verb did not survive
        // into the description of what was bought.
        expect(items[0].description).toBe('Bacon, pork cuts');
    });

    it('generalises: the same shapes work in other sentences', () => {
        expect(extractDescription('i recieved 2500 from Jane').amount).toBe(2500);
        expect(extractDescription('i bought afewtomatoes for 200, milk for 80')
            .itemisation?.items.map(i => i.description)).toEqual(['Few tomatoes', 'Milk']);
    });

    it('does not mangle genuine long words in the same position', () => {
        expect(extractDescription('paid accommodation for 12000, motherboard for 7000')
            .itemisation?.items.map(i => i.description)).toEqual(['Accommodation', 'Motherboard']);
    });
});
