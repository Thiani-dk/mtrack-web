import { describe, expect, it } from 'vitest';
import { amountInWords } from './amountInWords';

describe('amountInWords', () => {
    it('spells out a plain whole amount', () => {
        expect(amountInWords(1250)).toBe('ONE THOUSAND TWO HUNDRED AND FIFTY SHILLINGS ONLY');
    });

    it('spells out cents when present', () => {
        expect(amountInWords(1250.5)).toBe('ONE THOUSAND TWO HUNDRED AND FIFTY SHILLINGS AND FIFTY CENTS ONLY');
    });

    it('handles zero', () => {
        expect(amountInWords(0)).toBe('ZERO SHILLINGS ONLY');
    });

    it('handles a single shilling and a single cent, singular', () => {
        expect(amountInWords(1.01)).toBe('ONE SHILLING AND ONE CENT ONLY');
    });

    it('handles teens correctly (not "TEN-THREE")', () => {
        expect(amountInWords(13)).toBe('THIRTEEN SHILLINGS ONLY');
        expect(amountInWords(19)).toBe('NINETEEN SHILLINGS ONLY');
    });

    it('handles a two-digit number with both tens and ones', () => {
        expect(amountInWords(45)).toBe('FORTY-FIVE SHILLINGS ONLY');
    });

    it('handles an exact hundred with nothing left over', () => {
        expect(amountInWords(100)).toBe('ONE HUNDRED SHILLINGS ONLY');
    });

    it('handles hundreds plus a remainder', () => {
        expect(amountInWords(105)).toBe('ONE HUNDRED AND FIVE SHILLINGS ONLY');
    });

    it('handles a value spanning thousands, hundreds and tens together', () => {
        expect(amountInWords(234567)).toBe('TWO HUNDRED AND THIRTY-FOUR THOUSAND FIVE HUNDRED AND SIXTY-SEVEN SHILLINGS ONLY');
    });

    it('handles millions', () => {
        expect(amountInWords(1_000_000)).toBe('ONE MILLION SHILLINGS ONLY');
    });

    it('skips a zero thousands group without printing "ZERO THOUSAND"', () => {
        expect(amountInWords(1_000_050)).toBe('ONE MILLION FIFTY SHILLINGS ONLY');
    });

    it('rounds a sub-cent float rather than printing a repeating decimal artifact', () => {
        expect(amountInWords(10.1 + 0.2)).toBe('TEN SHILLINGS AND THIRTY CENTS ONLY');
    });

    it('always prints a positive amount even if given a negative number', () => {
        expect(amountInWords(-50)).toBe('FIFTY SHILLINGS ONLY');
    });

    it('honours a different currency\'s unit and subunit names', () => {
        expect(amountInWords(5.5, { unit: 'DOLLARS', subunit: 'CENTS' })).toBe('FIVE DOLLARS AND FIFTY CENTS ONLY');
    });
});
