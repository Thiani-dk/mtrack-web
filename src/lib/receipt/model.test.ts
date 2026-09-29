import { describe, expect, it } from 'vitest';
import { buildReceiptData, needsReconciliationPrompt } from './model';
import { captureFromPaste, buildCashSale } from '../activeMode/session';
import type { ParsedTransaction, TrackedDocument } from '../../types';

// The receipt's data model: line building, reconciliation (match / tip /
// discount / unexplained), provenance, and the QR facts payload — each
// against the fixture the design's own table describes.

function mpesaSale(amount: number, opts: Partial<ParsedTransaction> = {}): ParsedTransaction {
    const raw = `QA01XK9P2L Confirmed. You have received Ksh${amount.toFixed(2)} from JOHN KAMAU `
        + `0712345678 on 29/9/26 at 1:05 PM. New M-PESA balance is Ksh20000.00.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error('fixture did not parse');
    return { ...t, ...opts };
}

function doc(transactions: ParsedTransaction[], overrides: Partial<TrackedDocument> = {}): TrackedDocument {
    return {
        id: 'pos-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'approved',
        documentType: 'point_of_sale',
        dataSource: 'sms_verified',
        transactions,
        merchantProfile: { businessName: 'Mama Chapo', contact: '0712345678' },
        onBehalfOf: null,
        coveringFrom: null,
        coveringTo: null,
        capturedViaActiveMode: false,
        activeMode: null,
        receiptNumber: 'MT260929-ABCDE',
        servedBy: null,
        tip: null,
        discount: null,
        ...overrides,
    };
}

describe('a simple receipt with no itemisation', () => {
    const data = buildReceiptData(doc([mpesaSale(350)]));

    it('treats the whole sale as a single line', () => {
        expect(data.lines).toHaveLength(1);
        expect(data.lines[0].amountLabel).toBe('Ksh 350.00');
    });

    it('reconciles as a match — nothing to explain', () => {
        expect(data.reconciliation).toEqual({ kind: 'match' });
    });

    it('prints the exact total and its words', () => {
        expect(data.totalLabel).toBe('Ksh 350.00');
        expect(data.amountWords).toBe('THREE HUNDRED AND FIFTY SHILLINGS ONLY');
    });

    it('carries the business name and the document\'s own stable receipt number', () => {
        expect(data.businessName).toBe('Mama Chapo');
        expect(data.receiptNumber).toBe('MT260929-ABCDE');
    });

    it('states the provenance honestly', () => {
        expect(data.provenanceLine).toBe('Verified from an M-Pesa payment message.');
    });
});

describe('an itemised sale', () => {
    const items = [
        { description: 'Chapati', quantity: 2, unitPrice: 20, amount: 40 },
        { description: 'Soda', quantity: 1, unitPrice: 60, amount: 60 },
    ];
    const data = buildReceiptData(doc([mpesaSale(100, { lineItems: items })]));

    it('lists every item as its own row', () => {
        expect(data.lines).toHaveLength(2);
        expect(data.lines[0]).toEqual({ description: 'Chapati', detail: '2 x Ksh 20.00', amountLabel: 'Ksh 40.00' });
    });

    it('matches when items sum exactly to what was received', () => {
        expect(data.reconciliation).toEqual({ kind: 'match' });
        expect(data.subtotalLabel).toBe('Ksh 100.00');
    });
});

describe('reconciliation: a tip', () => {
    const items = [{ description: 'Haircut', quantity: 1, unitPrice: 300, amount: 300 }];
    const withTip = doc([mpesaSale(350, { lineItems: items })], { tip: 50 });

    it('needs a prompt before the tip is recorded', () => {
        const beforeTip = doc([mpesaSale(350, { lineItems: items })]);
        expect(needsReconciliationPrompt(beforeTip)).toBe(true);
    });

    it('once recorded, explains the gap as a tip, not a mismatch', () => {
        const data = buildReceiptData(withTip);
        expect(data.reconciliation).toEqual({ kind: 'tip', amountLabel: 'Ksh 50.00' });
        expect(needsReconciliationPrompt(withTip)).toBe(false);
    });

    it('the printed total is still the real money received, not the subtotal', () => {
        const data = buildReceiptData(withTip);
        expect(data.totalLabel).toBe('Ksh 350.00');
        expect(data.subtotalLabel).toBe('Ksh 300.00');
    });
});

describe('reconciliation: a discount', () => {
    const items = [{ description: 'Combo', quantity: 1, unitPrice: 500, amount: 500 }];
    const withDiscount = doc([mpesaSale(450, { lineItems: items })], { discount: 50 });

    it('explains the gap as a discount', () => {
        const data = buildReceiptData(withDiscount);
        expect(data.reconciliation).toEqual({ kind: 'discount', amountLabel: 'Ksh 50.00' });
    });
});

describe('reconciliation: unexplained', () => {
    it('is printed plainly rather than hidden when nothing on the document explains it', () => {
        const items = [{ description: 'Combo', quantity: 1, unitPrice: 500, amount: 500 }];
        const data = buildReceiptData(doc([mpesaSale(450, { lineItems: items })]));
        expect(data.reconciliation.kind).toBe('unexplained');
        if (data.reconciliation.kind === 'unexplained') {
            expect(data.reconciliation.amountLabel).toBe('Ksh 50.00');
            expect(data.reconciliation.amount).toBe(-50);
        }
    });

    it('a stored tip that does not actually match the real gap still reports unexplained, honestly', () => {
        const items = [{ description: 'Combo', quantity: 1, unitPrice: 500, amount: 500 }];
        const data = buildReceiptData(doc([mpesaSale(450, { lineItems: items })], { tip: 999 }));
        expect(data.reconciliation.kind).toBe('unexplained');
    });
});

describe('provenance', () => {
    it('reports a cash sale', () => {
        const cash = buildCashSale({ bucket: 'Drinks', amount: 100 });
        const data = buildReceiptData(doc([cash]));
        expect(data.provenanceLine).toBe('Cash, entered by the seller.');
    });

    it('reports a hand-entered, non-cash amount distinctly from cash', () => {
        const typed = { ...mpesaSale(100), dataSource: 'self_reported' as const, method: 'p2p' };
        const data = buildReceiptData(doc([typed]));
        expect(data.provenanceLine).toBe('Entered by the seller, not from a payment message.');
    });

    it('reports a mix honestly rather than picking one', () => {
        const verified = mpesaSale(100);
        const cash = buildCashSale({ bucket: 'Drinks', amount: 50 });
        const data = buildReceiptData(doc([verified, cash]));
        expect(data.provenanceLine).toBe('A mix of verified messages and amounts entered by the seller.');
    });
});

describe('the QR facts payload', () => {
    it('is a pipe-delimited, offline-verifiable summary — no live URL', () => {
        const data = buildReceiptData(doc([mpesaSale(350)]));
        expect(data.qrFacts).not.toMatch(/https?:\/\//);
        expect(data.qrFacts.split('|')).toEqual([
            'MTRACK-RECEIPT-V1', 'MT260929-ABCDE', 'Mama Chapo', '350.00', 'KES', data.dateLabel,
        ]);
    });

    it('never contains a customer name', () => {
        const data = buildReceiptData(doc([mpesaSale(350)]));
        expect(data.qrFacts).not.toMatch(/JOHN KAMAU/i);
    });
});

describe('servedBy', () => {
    it('is null until set, and carried through once it is', () => {
        expect(buildReceiptData(doc([mpesaSale(350)])).servedBy).toBeNull();
        expect(buildReceiptData(doc([mpesaSale(350)], { servedBy: 'Amina' })).servedBy).toBe('Amina');
    });
});
