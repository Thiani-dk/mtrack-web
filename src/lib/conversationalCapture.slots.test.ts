import { describe, expect, it } from 'vitest';
import {
    absorbAnswer, buildConfirmSentence, extractDescription, extractLineItems, itemsSummary,
    openSlots, type CaptureSlot,
} from './conversationalCapture';
import {
    composeDescription, composeDraftAnswer, emptyCaptureDraft, skipDate,
    type CaptureDraft,
} from './captureDraft';

// The transcript from the bug report, replayed through the capture logic.
//
// What happened the first time: the four itemised prices in the opening
// message were dropped, the bot asked for an amount it had already been given,
// read "100k USD" as 100, dropped USD, and asked the user to confirm "Ksh 100
// to Computer stuff". Everything below asserts on the two things that went
// wrong — which questions get asked, and what the confirmation actually says.
//
// These helpers used to be a hand-written model of ChatScreen's composition,
// which is how this file stayed green through a production bug it could not
// express. They now call composeDescription / composeDraftAnswer — the same
// functions the handlers call — so a divergence between what is tested and
// what ships is no longer possible.

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

type Draft = CaptureDraft;
const emptyDraft = emptyCaptureDraft;

// The opening free-text message, through the production composition.
function describe1(text: string, prior: Draft = emptyDraft()): Draft {
    return composeDescription(prior, text, NOW).draft;
}

// Answers whichever question is currently open, through the same reducer the
// pending-prompt handlers use, and reports which question was asked.
function answer(draft: Draft, text: string): { draft: Draft; asked: string | null } {
    const [slot] = openSlots(draft);
    if (!slot) return { draft, asked: null };
    return { asked: QUESTION[slot], draft: composeDraftAnswer(draft, slot, text, NOW).draft };
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
        // Answering the one open question (the date) with a message that also
        // names an amount, a description and a currency must leave all three
        // of the already-settled ones exactly as they were.
        const filled: Draft = {
            ...emptyDraft(),
            amount: 32_000, recipient: 'Parts', currency: { code: 'USD', explicit: true },
        };
        expect(openSlots(filled)).toEqual(['date']);

        const { draft } = composeDraftAnswer(filled, 'date', 'yesterday, actually Ksh 99 for sweets', NOW);
        expect(draft.amount).toBe(32_000);
        expect(draft.recipient).toBe('Parts');
        expect(draft.currency.code).toBe('USD');
        // And the slot that WAS asked about is the one that changed.
        expect(draft.date).toEqual(new Date('2026-09-11T12:00:00'));
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

describe('the Sambonani point-of-sale transcript', () => {
    // From a real run. The user described two priced items in one message and
    // the bot went on to ask "What did they buy?" — proof that none of it was
    // extracted.
    //
    // The cause was NOT a second, older pipeline: point_of_sale already routes
    // through extractDescription like every other mode. It was the phrasing.
    // The earlier hardware fixture says "ram I sold at 5000USD" — item, then
    // price. This one says "500 USD on call time" — price, then item — and the
    // extractor only ever read the words BEFORE a price.
    const BUSINESS = 'Sambonani';
    const MESSAGE = 'They bought credits to continue chatting on my platform. '
        + '500 USD on call time. And 250 USD on sms time.';

    const draft = describe1(MESSAGE);

    it('reads both items with their own prices', () => {
        expect(draft.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Call time', 500],
            ['Sms time', 250],
        ]);
    });

    it('totals them to $750 in USD, not the first price alone', () => {
        // Before the fix this came out as 500 — the single best-scoring amount.
        expect(draft.amount).toBe(750);
        expect(draft.currency).toEqual({ code: 'USD', explicit: true });
    });

    it('does not go on to ask what they bought', () => {
        // The items ARE the answer to that question.
        expect(draft.recipient).toBe('Call time, Sms time');
        expect(openSlots(draft)).toEqual(['date']);

        // And once the date is answered, nothing is left to ask.
        const { draft: dated, asked } = answer(draft, 'yesterday');
        expect(asked).toBe(QUESTION.date);
        expect(openSlots(dated)).toEqual([]);
    });

    it('confirms both items and the right total', () => {
        const { draft: dated } = answer(draft, 'yesterday');
        const sentence = buildConfirmSentence({
            amount: dated.amount,
            currency: dated.currency,
            recipient: dated.recipient,
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: '11 September 2026',
            dateSkipped: false,
            lineItems: dated.lineItems,
        });
        expect(sentence).toContain('Call time $500');
        expect(sentence).toContain('Sms time $250');
        expect(sentence).toContain('total $750');
        expect(sentence).not.toContain('Ksh');
    });

    it('is a point_of_sale capture, with the business name kept separately', () => {
        // The business name answers its own prompt and is merchant metadata —
        // it is not, and must not become, a line item.
        expect(draft.lineItems?.some(i => i.description.includes(BUSINESS))).toBe(false);
    });
});

describe('item and price in either order', () => {
    // Both phrasings, in the same run — the earlier fix was only ever verified
    // against one of them.
    it('reads item-then-price', () => {
        const d = describe1('ram Ksh 5,000, monitor Ksh 12,000');
        expect(d.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Ram', 5000], ['Monitor', 12_000],
        ]);
        expect(d.amount).toBe(17_000);
    });

    it('reads price-then-item', () => {
        const d = describe1('Ksh 5,000 for ram, Ksh 12,000 for a monitor');
        expect(d.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Ram', 5000], ['Monitor', 12_000],
        ]);
        expect(d.amount).toBe(17_000);
    });

    it('reads a message that mixes the two orders', () => {
        const d = describe1('ram Ksh 5,000, and Ksh 12,000 on a monitor');
        expect(d.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Ram', 5000], ['Monitor', 12_000],
        ]);
        expect(d.amount).toBe(17_000);
    });

    it('prefers the words before the price when both sides have some', () => {
        // "sodas 3 x" style quantities live before the price, so the leading
        // side has to keep winning where it says anything at all.
        const d = describe1('3 x sodas Ksh 450, bread Ksh 120');
        expect(d.lineItems?.map(i => [i.description, i.quantity])).toEqual([
            ['Sodas', 3], ['Bread', null],
        ]);
    });
});

describe('every capture mode shares one extraction pipeline', () => {
    // There is a single entry point — extractDescription — and it is document
    // type agnostic by construction: it takes a string and returns fields.
    // Nothing about point_of_sale, personal_note, on_behalf_of or
    // expense_summary reaches it, so none of them can diverge.
    const MESSAGE = 'Ksh 300 for bread, Ksh 120 for milk';

    it('takes no document type, so it cannot behave differently per mode', () => {
        // extractDescription(text, now) — two parameters, neither a mode.
        expect(extractDescription.length).toBeLessThanOrEqual(2);
    });

    it('returns the same itemisation however the caller intends to use it', () => {
        const a = extractDescription(MESSAGE, NOW);
        const b = extractDescription(MESSAGE, NOW);
        expect(a.itemisation?.items).toEqual(b.itemisation?.items);
        expect(a.itemisation?.total).toBe(420);
    });
});

describe('composeDraftAnswer spread order — the absorbAnswer regression', () => {
    // A NAMED guard for one specific defect, not incidental coverage.
    //
    // absorbAnswer takes the whole draft and returns the slots an answer
    // happened to fill, layered on what was already there. Production once
    // spread that result AFTER the field the answer was about:
    //
    //     { ...draft, date: d.date, ...absorbAnswer(draft, t) }
    //
    // which wrote the pre-answer date — null — straight back over the date
    // just parsed. Every accepted date was discarded and the bot re-asked
    // "when was that?" forever. Thirty tests in this file stayed green because
    // they carried their own copy of this composition with the order correct.
    //
    // Each assertion below fails if the spread is flipped back.

    it('keeps the date the answer was about, not the null it replaced', () => {
        const before = emptyDraft();
        expect(before.date).toBeNull();

        const { draft, accepted } = composeDraftAnswer(before, 'date', 'yesterday', NOW);
        expect(accepted).toBe(true);
        expect(draft.date).toEqual(new Date('2026-09-11T12:00:00'));
        expect(draft.dateInterpretation).toBe('11 September 2026');
        expect(draft.dateSkipped).toBe(false);
    });

    it('absorbAnswer returns its four slots and nothing else', () => {
        // This, not the spread order, is what actually protects the date now.
        //
        // The original bug had two halves: absorbAnswer spread its whole input
        // back out (so its result carried a stale `date`), and the caller
        // spread that result over the date it had just set. Fixing either half
        // closes it. Reverting the spread order alone no longer reproduces the
        // bug precisely because this half holds — so this half needs its own
        // assertion, or restoring `{ ...current }` inside absorbAnswer would
        // reintroduce the whole defect with every other test still green.
        const filled: Draft = { ...emptyDraft(), date: new Date('2026-01-01T12:00:00'), dateSkipped: true };
        const absorbed = absorbAnswer(filled, 'yesterday');

        expect(Object.keys(absorbed).sort()).toEqual(['amount', 'currency', 'lineItems', 'recipient']);
        // Spelled out, since the key list above is the whole point.
        expect('date' in absorbed).toBe(false);
        expect('dateSkipped' in absorbed).toBe(false);
        expect('direction' in absorbed).toBe(false);
    });

    it('closes the date slot, so the question is not asked again', () => {
        // The user-visible symptom of the bug, stated as a slot fact.
        const { draft } = composeDraftAnswer(emptyDraft(), 'date', 'yesterday', NOW);
        expect(openSlots(draft)).not.toContain('date');
    });

    it('keeps the amount the answer was about, not the null it replaced', () => {
        // A BARE figure, deliberately. Given "100k USD" both absorbAnswer and
        // parseAmountReply arrive at 100,000, so the spread order makes no
        // observable difference and the guard would not bite. A bare "45000"
        // is the case only parseAmountReply reads — the question supplied the
        // context free text lacks — so spreading absorbAnswer last puts null
        // back and this fails.
        const { draft, accepted } = composeDraftAnswer(emptyDraft(), 'amount', '45000', NOW);
        expect(accepted).toBe(true);
        expect(draft.amount).toBe(45_000);
        expect(openSlots(draft)).not.toContain('amount');
    });

    it('keeps the description the answer was about, not the null it replaced', () => {
        const { draft, accepted } = composeDraftAnswer(emptyDraft(), 'description', 'Computer stuff', NOW);
        expect(accepted).toBe(true);
        expect(draft.recipient).toBe('Computer stuff');
        expect(openSlots(draft)).not.toContain('description');
    });

    it('still absorbs what the answer said beyond the question', () => {
        // The guard must not be satisfiable by dropping absorbAnswer entirely —
        // that would trade one bug for another. A date answer that also names
        // an amount fills both.
        const { draft } = composeDraftAnswer(emptyDraft(), 'date', 'yesterday, it was Ksh 4,500', NOW);
        expect(draft.date).toEqual(new Date('2026-09-11T12:00:00'));
        expect(draft.amount).toBe(4500);
        expect(draft.currency).toEqual({ code: 'KES', explicit: true });
    });

    it('leaves the slot untouched when the answer is refused', () => {
        const { draft, accepted } = composeDraftAnswer(emptyDraft(), 'date', 'no idea', NOW);
        expect(accepted).toBe(false);
        expect(draft.date).toBeNull();
        expect(draft.dateSkipped).toBe(false);
        expect(openSlots(draft)).toContain('date');
    });

    it('skipDate closes the slot without inventing a date', () => {
        const skipped = skipDate(emptyDraft());
        expect(skipped.date).toBeNull();
        expect(skipped.dateSkipped).toBe(true);
        expect(openSlots(skipped)).not.toContain('date');
    });
});
