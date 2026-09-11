import { describe, expect, it } from 'vitest';
import {
    absorbAnswer, buildConfirmSentence, extractDescription, extractLineItems,
    itemsSummary, lockCurrency, openSlots, parseAmountReply, parseConversationalDate,
    UNSTATED_CURRENCY, type CaptureSlot, type CurrencyLock,
} from './conversationalCapture';
import type { LineItem } from '../types';

// The transcript from the bug report, replayed through the capture logic.
//
// What happened the first time: the four itemised prices in the opening
// message were dropped, the bot asked for an amount it had already been given,
// read "100k USD" as 100, dropped USD, and asked the user to confirm "Ksh 100
// to Computer stuff". Everything below asserts on the two things that went
// wrong — which questions get asked, and what the confirmation actually says.

const FIRST = 'They bought hardware. Computer components. Some ram I sold at 5000USD, '
    + 'AI chip 10k USD, CPU 10k USD, motherboard 7000usd,';
const DATE_ANSWER = 'Yesterday, around 7pm';

// A fixed "now", so "yesterday" is a fixed day.
const NOW = new Date('2026-09-12T09:00:00');

// The bot's side of the conversation, as the flow would emit it. Mirrors
// askNextField in ChatScreen: one question per still-open slot, in order.
const QUESTION: Record<CaptureSlot, string> = {
    date: 'When was that?',
    amount: 'How much was it?',
    description: 'What did they buy?',
};

interface Draft {
    amount: number | null;
    lineItems: LineItem[] | null;
    recipient: string | null;
    date: Date | null;
    dateSkipped: boolean;
    currency: CurrencyLock;
}

function emptyDraft(): Draft {
    return { amount: null, lineItems: null, recipient: null, date: null, dateSkipped: false, currency: UNSTATED_CURRENCY };
}

// Runs the opening free-text message through extraction, exactly as
// handleDescription does.
function describe1(text: string, prior: Draft = emptyDraft()): Draft {
    const r = extractDescription(text, NOW);
    return {
        ...prior,
        amount: r.amount ?? prior.amount,
        lineItems: r.itemisation?.items ?? prior.lineItems,
        recipient: r.recipient ?? prior.recipient,
        date: r.date ?? prior.date,
        currency: lockCurrency(prior.currency, text),
    };
}

// Answers whichever question is currently open, the way the pending-prompt
// handlers do, and returns the new draft plus the question that was asked.
function answer(draft: Draft, text: string): { draft: Draft; asked: string | null } {
    const [slot] = openSlots(draft);
    if (!slot) return { draft, asked: null };

    if (slot === 'date') {
        const d = parseConversationalDate(text, NOW);
        return {
            asked: QUESTION.date,
            draft: { ...draft, ...absorbAnswer(draft, text), date: d.date ?? draft.date },
        };
    }
    if (slot === 'amount') {
        const reply = parseAmountReply(text);
        const absorbed = absorbAnswer(draft, text);
        return {
            asked: QUESTION.amount,
            draft: {
                ...draft, ...absorbed,
                amount: absorbed.lineItems?.length ? absorbed.amount : (reply.amount ?? absorbed.amount),
            },
        };
    }
    return { asked: QUESTION.description, draft: { ...draft, ...absorbAnswer(draft, text), recipient: text } };
}

describe('extracting the first message', () => {
    const draft = describe1(FIRST);

    it('reads all four items, with their own prices', () => {
        expect(draft.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Ram', 5000],
            ['AI chip', 10_000],
            ['CPU', 10_000],
            ['Motherboard', 7000],
        ]);
    });

    it('totals them to $32,000 in USD', () => {
        expect(draft.amount).toBe(32_000);
        expect(draft.currency).toEqual({ code: 'USD', explicit: true });
    });

    it('treats the items as the description, rather than asking what was bought', () => {
        expect(draft.recipient).toBe('Ram, AI chip, CPU, Motherboard');
    });

    it('leaves only the date genuinely missing', () => {
        expect(openSlots(draft)).toEqual(['date']);
    });
});

describe('the transcript, replayed end to end', () => {
    // Only the date was ever missing, so that is the only question, and the
    // transcript's "How much was it?" / "What did they buy?" never happen.
    const step1 = describe1(FIRST);
    const step2 = answer(step1, DATE_ANSWER);

    it('asks exactly one question, about the date', () => {
        expect(step2.asked).toBe(QUESTION.date);
        expect(openSlots(step2.draft)).toEqual([]);
    });

    it('never asks for the amount or the description', () => {
        const asked = [step2.asked];
        expect(asked).not.toContain(QUESTION.amount);
        expect(asked).not.toContain(QUESTION.description);
    });

    it('confirms every item, the right total, and USD', () => {
        const d = step2.draft;
        const sentence = buildConfirmSentence({
            amount: d.amount,
            currency: d.currency,
            recipient: d.recipient,
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: '11 September 2026',
            dateSkipped: false,
            lineItems: d.lineItems,
        });

        expect(sentence).toBe(
            'Ram $5,000, AI chip $10,000, CPU $10,000, Motherboard $7,000 — total $32,000, '
            + 'on 11 September 2026. Right?',
        );
        // The sentence the user was actually shown, and everything wrong with it.
        expect(sentence).not.toContain('Ksh');
        expect(sentence).not.toContain('$100');
        expect(sentence).not.toContain('Computer stuff');
    });

    it('keeps USD through an answer that mentions no currency', () => {
        expect(step2.draft.currency).toEqual({ code: 'USD', explicit: true });
    });

    it('reads "around 7pm" as a time, not as an amount of seven', () => {
        expect(step2.draft.amount).toBe(32_000);
    });
});

describe('a single-item transaction', () => {
    // The common case must not be dragged into itemisation by a flow built for
    // the multi-item one.
    const draft = describe1('Sold a laptop for Ksh 45,000');

    it('is not itemised', () => {
        expect(extractLineItems('Sold a laptop for Ksh 45,000')).toBeNull();
        expect(draft.lineItems).toBeNull();
    });

    it('captures the one amount and currency', () => {
        expect(draft.amount).toBe(45_000);
        expect(draft.currency).toEqual({ code: 'KES', explicit: true });
    });

    it('confirms as one plain line, with no itemisation and no total prefix', () => {
        const sentence = buildConfirmSentence({
            amount: draft.amount,
            currency: draft.currency,
            recipient: 'laptop',
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: '11 September 2026',
            dateSkipped: false,
            lineItems: draft.lineItems,
        });
        expect(sentence).toBe('Ksh 45,000 from laptop, on 11 September 2026. Right?');
        expect(sentence).not.toContain('total');
    });

    it('still asks for what it genuinely lacks', () => {
        const bare = describe1('Spent 45,000 yesterday');
        expect(openSlots(bare)).toContain('amount');
    });
});

describe('an answer that says more than was asked', () => {
    it('takes an amount offered while answering the date question', () => {
        const start = { ...emptyDraft(), recipient: 'Kevin' };
        const { draft } = answer(start, 'yesterday, it was Ksh 4,500');
        expect(draft.amount).toBe(4500);
        expect(draft.currency).toEqual({ code: 'KES', explicit: true });
        expect(openSlots(draft)).toEqual([]);
    });

    it('takes an itemisation offered in reply to "how much"', () => {
        const start = { ...emptyDraft(), date: NOW, recipient: 'Shop' };
        const { draft } = answer(start, 'bread Ksh 120, milk Ksh 80 and sugar Ksh 250');
        expect(draft.lineItems?.map(i => i.description)).toEqual(['Bread', 'Milk', 'Sugar']);
        expect(draft.amount).toBe(450);
    });

    it('never overwrites a slot that is already filled', () => {
        const filled = { ...emptyDraft(), amount: 32_000, recipient: 'Parts', currency: { code: 'USD', explicit: true } };
        const absorbed = absorbAnswer(filled, 'actually Ksh 99 for sweets');
        expect(absorbed.amount).toBe(32_000);
        expect(absorbed.recipient).toBe('Parts');
        expect(absorbed.currency.code).toBe('USD');
    });
});

describe('itemsSummary', () => {
    it('joins the item descriptions in order', () => {
        const items = extractLineItems(FIRST)?.items ?? [];
        expect(itemsSummary(items)).toBe('Ram, AI chip, CPU, Motherboard');
    });
});

describe('items in more than one currency', () => {
    it('reports the mix rather than summing across it', () => {
        const found = extractLineItems('ram 5000 USD, monitor 200 GBP');
        expect(found?.mixedCurrency).toBe(true);
    });

    it('is not treated as an itemisation, since there is no honest total', () => {
        const draft = describe1('ram 5000 USD, monitor 200 GBP');
        expect(draft.lineItems).toBeNull();
        // The amount slot stays open, so the flow asks rather than inventing
        // a rate to add dollars to pounds.
        expect(openSlots({ ...draft, date: NOW })).not.toEqual([]);
    });
});
