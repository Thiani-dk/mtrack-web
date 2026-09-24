import { describe, expect, it } from 'vitest';
import type { DocRenderMeta } from './documentRender';
import { buildSelfReportedTransaction, buildConfirmSentence } from './conversationalCapture';
import { composeDescription, emptyCaptureDraft } from './captureDraft';
import { buildDocModel, measureDrawnStrings, renderDocHTML } from './documentLayout';

// Quantity, from a typed message to the document a person is handed.
//
// The LineItem type has carried `quantity` and `unitPrice` since it was
// written, the extractor populated them, and the PDF and HTML rendered them —
// but nothing tested the path end to end, and two of its three stages were
// broken. A single item's quantity was extracted and then dropped on the way
// into the draft, and the chat card, which is the only surface anyone sees
// BEFORE pressing Save, rendered no itemisation at all.
//
// It matters most for point_of_sale, where the customer is holding the thing:
// "Sodas (3 x Ksh 150.00)  Ksh 450.00" is a materially different receipt from
// "Sodas  Ksh 450.00".

const NOW = new Date('2026-09-12T09:00:00');

const META = {
    documentType: 'point_of_sale',
    coveringFrom: null,
    coveringTo: null,
    merchantProfile: { businessName: 'Kibanda', phone: null, location: null },
} as unknown as DocRenderMeta;

// The whole path: typed message -> extraction -> draft -> transaction ->
// document model -> the strings the HTML and the PDF actually draw.
function throughTheDocument(message: string) {
    const { draft } = composeDescription(emptyCaptureDraft(), message, NOW);
    const tx = buildSelfReportedTransaction({
        amount: draft.amount ?? 0,
        currency: draft.currency.code,
        recipient: draft.recipient ?? 'Unknown',
        date: NOW,
        lineItems: draft.lineItems,
    });
    const model = buildDocModel([tx], META, false);
    return {
        draft,
        lineItems: draft.lineItems,
        // What the shared document model says each itemisation row reads.
        rows: model.lines.flatMap(l => l.items.map(i => `${i.text}  ${i.amount}`.trim())),
        html: renderDocHTML(model, ''),
        pdf: measureDrawnStrings(model).map(s => s.text),
    };
}

describe('a quantity the user actually stated', () => {
    const EXPECTED = 'Sodas (3 x Ksh 150.00)';

    it('survives extraction into the draft', () => {
        const { lineItems } = throughTheDocument('3 x sodas Ksh 450');
        expect(lineItems?.map(i => [i.description, i.quantity, i.unitPrice, i.amount]))
            .toEqual([['Sodas', 3, 150, 450]]);
    });

    it('reaches the shared document model', () => {
        expect(throughTheDocument('3 x sodas Ksh 450').rows).toEqual([`${EXPECTED}  Ksh 450.00`]);
    });

    it('reaches the exported HTML', () => {
        expect(throughTheDocument('3 x sodas Ksh 450').html).toContain(EXPECTED);
    });

    it('reaches the PDF', () => {
        expect(throughTheDocument('3 x sodas Ksh 450').pdf.some(s => s.includes(EXPECTED))).toBe(true);
    });

    it('is put back in the confirmation, before anything is saved', () => {
        const { draft } = throughTheDocument('3 x sodas Ksh 450');
        const sentence = buildConfirmSentence({
            amount: draft.amount, currency: draft.currency, recipient: draft.recipient,
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: null, dateLabel: '11 September 2026', dateSkipped: false,
            lineItems: draft.lineItems,
        });
        // The chat voice drops the trailing zeroes the document keeps.
        expect(sentence).toContain('Sodas (3 x Ksh 150) Ksh 450');
        // One line is not a list, so it is not given a total of itself.
        expect(sentence).not.toContain('total');
    });
});

describe('a price stated per item rather than as a line total', () => {
    // "at 50 each" is the price of ONE soda. The amount extractor finds 50, and
    // 50 on a receipt for three sodas is a wrong figure, not a vague one.
    it('multiplies out to the line total', () => {
        const { draft, lineItems } = throughTheDocument('3 sodas at 50 each');
        expect(lineItems?.map(i => [i.description, i.quantity, i.unitPrice, i.amount]))
            .toEqual([['Sodas', 3, 50, 150]]);
        expect(draft.amount).toBe(150);
    });

    it('renders the unit price the user gave, not one derived backwards', () => {
        expect(throughTheDocument('3 sodas at 50 each').rows).toEqual(['Sodas (3 x Ksh 50.00)  Ksh 150.00']);
    });

    it('reads the other ways of saying it', () => {
        for (const message of ['3 sodas at 50 a piece', '3 sodas @ 50 each', '4 chapati at 20 each']) {
            const { lineItems } = throughTheDocument(message);
            const [item] = lineItems ?? [];
            expect(item?.amount).toBe((item?.quantity ?? 0) * (item?.unitPrice ?? 0));
        }
    });
});

describe('a bare count, which is how people actually write it', () => {
    it('counts the thing itself', () => {
        const { lineItems } = throughTheDocument('3 sodas for 150');
        expect(lineItems?.map(i => [i.description, i.quantity, i.unitPrice])).toEqual([['Sodas', 3, 50]]);
    });

    it('does not count containers as though they were the goods', () => {
        // The judgement from the previous pass, kept: 2 is a count of buckets,
        // the wings are not two of anything, and a derived Ksh 1,499.50 unit
        // price would be worse than none at all.
        const { draft, lineItems } = throughTheDocument(
            '2 buckets of chicken wings, one spicy, one sweet(honey dipped). worth 2999 ksh');
        expect(lineItems).toBeNull();
        expect(draft.recipient).toBe('2 buckets of chicken wings, one spicy, one sweet (honey dipped)');
        expect(draft.amount).toBe(2999);
    });

    it('does not read a sum of money as a count of things', () => {
        const { draft, lineItems } = throughTheDocument('500 shillings for airtime');
        expect(lineItems).toBeNull();
        expect(draft.amount).toBe(500);
    });
});

describe('an item with no quantity', () => {
    it('stays one plain line, with no stray multiplication sign', () => {
        const { rows, lineItems } = throughTheDocument('chicken wings worth 2999 ksh');
        // No itemisation row at all: a single unquantified purchase says
        // everything in its own total, and a one-row table under it is noise.
        expect(lineItems).toBeNull();
        expect(rows).toEqual([]);
    });

    it('renders no quantity column for the unquantified item in a list', () => {
        const { rows } = throughTheDocument('3 x sodas Ksh 450, bread Ksh 120');
        expect(rows).toEqual(['Sodas (3 x Ksh 150.00)  Ksh 450.00', 'Bread  Ksh 120.00']);
        expect(rows[1]).not.toContain('x ');
    });
});

describe('a count is not a price', () => {
    // From the flow sweep. "sold 3 chapati for 150" was read as three shillings:
    // the cue-word rule cannot tell a count from a sum, "sold" sits right before
    // the 3, and the 3 then scored as well as the 150 and won on position.
    it('reads the price, not the count, and puts the count where it belongs', () => {
        const { draft, lineItems, rows } = throughTheDocument('sold 3 chapati for 150');
        expect(draft.amount).toBe(150);
        expect(lineItems?.map(i => [i.description, i.quantity, i.unitPrice, i.amount]))
            .toEqual([['Chapati', 3, 50, 150]]);
        expect(rows).toEqual(['Chapati (3 x Ksh 50.00)  Ksh 150.00']);
    });

    it('still reads a small figure that IS the price', () => {
        // Nothing else in the message can carry a price, so the count reading
        // must not win — "spent 50 yesterday" really is fifty.
        expect(throughTheDocument('spent 50 yesterday').draft.amount).toBe(50);
        expect(throughTheDocument('spent 12 on parking').draft.amount).toBe(12);
        expect(throughTheDocument('worth 30 today').draft.amount).toBe(30);
        // The one that rests on the second condition alone: "rent" is a noun
        // like "chapati", so only the absence of any other figure to be the
        // price keeps this reading as fifty shillings rather than as a count.
        expect(throughTheDocument('paid 50 rent').draft.amount).toBe(50);
        expect(throughTheDocument('spent 20 airtime').draft.amount).toBe(20);
    });

    it('does not mistake the word joining a figure to what follows for a counted thing', () => {
        // "20 for 3 sodas" — "for" is what attaches the price to the goods, so
        // the 20 is the price and the 3 is not competing with it.
        expect(throughTheDocument('paid 20 for 3 sodas').draft.amount).toBe(20);
        expect(throughTheDocument('paid 12 for parking and 30 for a soda').draft.amount).toBe(12);
    });

    it('leaves a genuine multi-item list alone', () => {
        expect(throughTheDocument('bought bread for 60, milk for 120').draft.amount).toBe(180);
    });
});
