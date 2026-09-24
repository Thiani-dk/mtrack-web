import { describe, expect, it } from 'vitest';
import type { DocRenderMeta } from './documentRender';
import { buildSelfReportedTransaction, extractDescription } from './conversationalCapture';
import { composeDescription, emptyCaptureDraft } from './captureDraft';
import { buildDocModel } from './documentLayout';

// Which way the money went, on a sales receipt.
//
// From the flow sweep. The conversational direction verbs are read from the
// user's point of view — "bought" means the user bought, so the money left. On
// a receipt the merchant is issuing, "they bought 3 chapati for 150" is the
// exact opposite, and it came back as money OUT at confidence 95: high enough
// that nothing was asked, so the receipt carried the sign inverted with no
// question and no note.
//
// "sold" and "sell" were missing from the list altogether, so every sale
// phrased the obvious way came back unresolved and the flow stopped to ask
// "money in or out?" about a sales receipt.

const NOW = new Date('2026-09-12T09:00:00');
const dir = (m: string) => extractDescription(m, NOW).direction;

const META = {
    documentType: 'point_of_sale', coveringFrom: null, coveringTo: null,
    merchantProfile: { businessName: 'Kibanda', phone: null, location: null },
} as unknown as DocRenderMeta;

describe('a sale reads as money coming in', () => {
    it.each(['sold chapati for 150', 'sold 3 chapati for 150', 'i sold them bread for 60'])(
        'reads "%s" from the verb, with no question asked', message => {
            expect(dir(message)).toMatchObject({ type: 'received', source: 'keyword' });
        });

    it.each([
        'they bought 3 chapati for 150',
        'the customer paid 150 for chapati',
        'she bought bread for 60',
        'They bought credits to continue chatting. 500 USD on call time. And 250 USD on sms time.',
    ])('reads a third-party buyer in "%s" as money in', message => {
        expect(dir(message).type).toBe('received');
    });

    it('puts a plus on the receipt rather than a minus', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), 'they bought 3 chapati for 150', NOW);
        const tx = buildSelfReportedTransaction({
            amount: draft.amount ?? 0, currency: draft.currency.code,
            recipient: draft.recipient ?? 'x', date: NOW,
            direction: draft.direction, lineItems: draft.lineItems,
        });
        expect(tx.type).toBe('received');
        expect(buildDocModel([tx], META, false).lines[0].amount).toBe('+Ksh 150.00');
    });
});

describe('what must not flip', () => {
    it.each(['i bought bread for 60', 'bought bread for 60', 'spent 500 on lunch'])(
        'keeps "%s" as money going out', message => {
            expect(dir(message).type).toBe('sent');
        });

    it.each([
        'i bought it for them for 60',
        'they were closed so i bought bread for 60',
        'the customer was late so i bought lunch for 300',
        'he is my landlord and i paid 15000',
    ])('does not flip "%s", where the other party is not the buyer', message => {
        // The subject has to sit directly in front of the verb. Match it
        // anywhere in the sentence instead and every one of these — ordinary
        // spending, with someone else merely mentioned — is recorded as money
        // coming in.
        expect(dir(message).type).toBe('sent');
    });
});
