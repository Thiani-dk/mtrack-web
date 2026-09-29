import { describe, expect, it } from 'vitest';
import { salesLogTransactions } from './salesLog';
import { getRecipientShort } from '../receiptGenerator';
import { buildCashSale, captureFromPaste } from '../activeMode/session';

// The sales log reshape: proves the one property that matters for privacy —
// getRecipientShort(), the function every document surface actually prints,
// never returns a customer's name for a reshaped row.

function mpesaSale(name: string): import('../../types').ParsedTransaction {
    const raw = `QA01XK9P2L Confirmed. You have received Ksh350.00 from ${name} `
        + `0712345678 on 26/9/26 at 1:05 PM. New M-PESA balance is Ksh20350.00.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error('fixture did not parse');
    return { ...t, bucketLabel: 'Combo sales' };
}

describe('salesLogTransactions', () => {
    it('replaces an M-Pesa customer name with the bucket and time', () => {
        const [reshaped] = salesLogTransactions([mpesaSale('JOHN KAMAU')]);
        expect(getRecipientShort(reshaped)).not.toMatch(/JOHN KAMAU/);
        expect(getRecipientShort(reshaped)).toBe('COMBO SALES · 01:05 PM');
    });

    it('replaces a cash sale\'s description with just the bucket when there is no time', () => {
        const cash = { ...buildCashSale({ bucket: 'Drinks', amount: 100 }), time: '' };
        const [reshaped] = salesLogTransactions([cash]);
        expect(getRecipientShort(reshaped)).toBe('DRINKS');
    });

    it('never leaves a real name reachable through recipient either', () => {
        const [reshaped] = salesLogTransactions([mpesaSale('MARY WANJIKU')]);
        expect(reshaped.recipient).toBe('');
    });

    it('leaves the amount, date and currency untouched', () => {
        const original = mpesaSale('JOHN KAMAU');
        const [reshaped] = salesLogTransactions([original]);
        expect(reshaped.amount).toBe(original.amount);
        expect(reshaped.date).toEqual(original.date);
        expect(reshaped.currency).toBe(original.currency);
    });
});
