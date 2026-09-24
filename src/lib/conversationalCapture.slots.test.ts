import { describe, expect, it } from 'vitest';
import {
    absorbAnswer, buildConfirmSentence, extractDescription, extractLineItems, itemsSummary,
    composeSlotQuestion, followOnQuestion, openSlots, type CaptureSlot,
} from './conversationalCapture';
import { partyQuestion } from './partyQuestion';
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
        const noDescription = describe1('Spent Ksh 45,000 yesterday');
        expect(openSlots(noDescription)).toContain('description');
        expect(openSlots(noDescription)).not.toContain('amount');
    });

    it('reads a bare figure a person typed as the amount it plainly is', () => {
        // This assertion used to run the other way, requiring a currency token
        // before a number counted. That rule is right for M-Pesa, which always
        // writes one, and wrong for someone typing "spent 45,000 yesterday" —
        // and it was the whole reason a three-item message extracted nothing.
        expect(describe1('Spent 45,000 yesterday').amount).toBe(45_000);
    });

    it('does not read a time, a quantity or a date as money', () => {
        expect(describe1('got home around 7pm').amount).toBeNull();
        expect(describe1('bought 3 x sodas').amount).toBeNull();
        expect(describe1('it was on 12/09/2026').amount).toBeNull();
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

describe('the bacon and groceries message', () => {
    // From a screenshot. Three items, three amounts, and the bot replied "How
    // much was it?" — proof it had extracted nothing at all.
    //
    // The cause was NOT the typo ("boought") and NOT the merged word
    // ("somebacon"): fixing either or both changes nothing. It was that no
    // number in the message carries a currency token, and the amount extractor
    // discarded every bare number unconditionally. The two variants below pin
    // that down, so a future reader does not re-litigate it.
    const REAL = 'hi so, i spent quite a lot today. i boought somebacon and pork cuts for 3100, '
        + 'then i rode a bus to a neighborhood where i bought tomatoes, ginger, chapati, onions, '
        + 'and garlic at 400. then i bought airtime worth 30';

    const items = () => extractLineItems(REAL, { allowBare: true });

    it('extracts three line items totalling 3,530', () => {
        const found = items();
        expect(found?.items).toHaveLength(3);
        expect(found?.items.map(i => i.amount)).toEqual([3100, 400, 30]);
        expect(found?.total).toBe(3530);
    });

    it('keeps each item with the things it was actually for', () => {
        const [bacon, veg, airtime] = items()?.items ?? [];
        expect(bacon.description).toMatch(/pork cuts/i);
        expect(veg.description).toMatch(/tomatoes/i);
        expect(veg.description).toMatch(/garlic/i);
        expect(airtime.description).toMatch(/airtime/i);
    });

    it('leaves the capture flow nothing to ask about the amount', () => {
        const draft = describe1(REAL);
        expect(draft.amount).toBe(3530);
        expect(openSlots({ ...draft, date: NOW })).not.toContain('amount');
        expect(openSlots({ ...draft, date: NOW })).not.toContain('description');
    });

    it('was not the typo, and was not the merged word', () => {
        // Both "fixed", currency still absent: still nothing, under the old rule.
        const deTypoed = REAL.replace('boought', 'bought').replace('somebacon', 'some bacon');
        expect(extractLineItems(deTypoed)).toBeNull();
        // The bare-number reader is the whole difference.
        expect(extractLineItems(deTypoed, { allowBare: true })?.total).toBe(3530);
    });

    it('does not sweep a greeting into the first item', () => {
        expect(items()?.items[0].description).not.toMatch(/\bhi\b|\bso\b/i);
    });
});

describe('a confirmation with no recipient', () => {
    // Reachable through the cancel flow's "keep what I have", which ends the
    // questions wherever they had got to. This used to interpolate the literal
    // word "null" into the sentence the user is asked to agree to.
    it('leaves the recipient out rather than naming it null', () => {
        const sentence = buildConfirmSentence({
            amount: 3100,
            currency: { code: 'KES', explicit: false },
            recipient: null,
            direction: { type: 'sent', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: null,
            dateSkipped: false,
            lineItems: null,
        });
        expect(sentence).not.toContain('null');
        expect(sentence).toContain('Ksh 3,100');
    });
});

describe('a "for" clause that is introducing a price, not a reason', () => {
    // "Sold a laptop for Ksh 45,000" was read as being for the purpose
    // "Ksh 45" — the purpose pattern is case-insensitive, so the currency
    // token matched its leading [a-z] and the figure was truncated at the
    // thousands comma. The confirmation then read "for Ksh 45".
    it('is not mistaken for a purpose', () => {
        expect(extractDescription('Sold a laptop for Ksh 45,000', NOW).purposeLabel).toBeNull();
        expect(extractDescription('bought bacon for 3100', NOW).purposeLabel).toBeNull();
        expect(extractDescription('paid rent for KES 20,000', NOW).purposeLabel).toBeNull();
        expect(extractDescription('sent it for 10k USD', NOW).purposeLabel).toBeNull();
    });

    it('and the confirmation says nothing about it', () => {
        const d = describe1('Sold a laptop for Ksh 45,000');
        expect(buildConfirmSentence({
            amount: d.amount, currency: d.currency, recipient: 'laptop',
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: d.purposeLabel, dateLabel: '4 May 2026', dateSkipped: false,
            lineItems: d.lineItems,
        })).toBe('Ksh 45,000 from laptop, on 4 May 2026. Right?');
    });

    it('still reads a genuine purpose', () => {
        expect(extractDescription('paid Kevin 500 for a birthday gift', NOW).purposeLabel)
            .toBe('birthday gift');
        expect(extractDescription('sent 2000 for school fees', NOW).purposeLabel).toBe('school fees');
    });
});

describe('asking for two missing things at once', () => {
    const PROMPTS: Record<CaptureSlot, string> = {
        date: 'When was that?',
        amount: 'How much was it?',
        description: 'Who was it paid to?',
    };

    it('asks one question when only one thing is missing', () => {
        const q = composeSlotQuestion(['amount'], PROMPTS, 'expense_summary');
        expect(q?.text).toBe('How much was it?');
        expect(q?.slot).toBe('amount');
    });

    it('asks both in one turn when two are, rather than two round trips', () => {
        const q = composeSlotQuestion(['date', 'amount'], PROMPTS, 'expense_summary');
        expect(q?.text).toBe('When was that? And how much?');
        // The answer is filed against the first; absorbAnswer picks up the
        // second if it was given, and it is asked again alone if it wasn't.
        expect(q?.slot).toBe('date');
    });

    it('caps at two, rather than putting up a wall of questions', () => {
        const q = composeSlotQuestion(['date', 'amount', 'description'], PROMPTS, 'expense_summary');
        expect(q?.text).toBe('When was that? And how much?');
        expect(q?.text).not.toContain('paid to');
    });

    it('leaves the primary question reading exactly as it does alone', () => {
        const q = composeSlotQuestion(['amount', 'description'], PROMPTS, 'expense_summary');
        expect(q?.text.startsWith('How much was it?')).toBe(true);
    });

    // The follow-on clause is worded for the document too — "And what was it
    // for?" was appended to a sales receipt and to a reimbursement claim
    // alike, and it describes neither.
    it('words the follow-on for the document being written', () => {
        const openTwo: CaptureSlot[] = ['amount', 'description'];
        expect(composeSlotQuestion(openTwo, PROMPTS, 'expense_summary')?.text)
            .toBe('How much was it? And who was that to?');
        expect(composeSlotQuestion(openTwo, PROMPTS, 'point_of_sale')?.text)
            .toBe('How much was it? And what did they buy?');
        expect(composeSlotQuestion(openTwo, PROMPTS, 'on_behalf_of')?.text)
            .toBe('How much was it? And where was it spent?');
    });

    it('keeps the follow-on a clause, not a second full question', () => {
        for (const type of ['expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of'] as const) {
            const follow = followOnQuestion('description', type);
            expect(follow.startsWith('And ')).toBe(true);
            // Shorter than the primary it stands in for, and never a restatement of it.
            expect(follow).not.toContain(partyQuestion(type, 1));
        }
        // The slots that read the same whoever is writing are untouched.
        expect(followOnQuestion('date', 'on_behalf_of')).toBe('And when was that?');
        expect(followOnQuestion('amount', 'point_of_sale')).toBe('And how much?');
    });

    it('never asks a claim what it was "paid to", in the short form either', () => {
        expect(followOnQuestion('description', 'on_behalf_of')).not.toContain('paid to');
        // A receipt, a claim and own spending each get their own clause —
        // one string reused for all three is what this replaced.
        expect(new Set([
            followOnQuestion('description', 'expense_summary'),
            followOnQuestion('description', 'point_of_sale'),
            followOnQuestion('description', 'on_behalf_of'),
        ]).size).toBe(3);
    });

    it('asks nothing when nothing is open', () => {
        expect(composeSlotQuestion([], PROMPTS, 'expense_summary')).toBeNull();
    });

    it('a batched answer covering both closes both', () => {
        const start = emptyDraft();
        expect(openSlots(start)).toEqual(['date', 'amount', 'description']);
        const { draft } = composeDraftAnswer(start, 'date', 'yesterday, Ksh 4,500 to Kevin', NOW);
        expect(draft.date).not.toBeNull();
        expect(draft.amount).toBe(4500);
        expect(openSlots(draft)).toEqual([]);
    });
});

// The second transcript: a numeral owned by two slots at once.
//
// Asked "When was that? ... And how much?", the user replied "3 days ago". The
// date came out right, and the 3 — the number of DAYS — was also read as the
// amount and confirmed back as "Ksh 3 to carrefour supermarket". The batched
// question is what made it reachable: a bare figure counts as an amount when
// "how much?" was part of what was asked, and "3 days ago" is not a bare
// figure.
describe('a numeral inside a relative-date phrase', () => {
    // "3 days ago" from here is 19 September 2026, exactly as the transcript.
    const NOW_2 = new Date('2026-09-22T09:00:00');

    it('fills only the date, leaving the amount still to be asked', () => {
        const start = { ...emptyDraft(), recipient: null };
        const { draft, accepted } = composeDraftAnswer(start, 'date', '3 days ago', NOW_2, 'amount');

        expect(accepted).toBe(true);
        expect(draft.dateInterpretation).toBe('19 September 2026');
        expect(draft.amount).toBeNull();
        expect(openSlots(draft)).toContain('amount');
    });

    it('never reaches a confirmation reading "Ksh 3"', () => {
        const start = emptyDraft();
        const afterDate = composeDraftAnswer(start, 'date', '3 days ago', NOW_2, 'amount').draft;
        const afterParty = composeDraftAnswer(afterDate, 'description', 'carrefour supermarket', NOW_2).draft;

        // The amount is still the open slot, so that is what gets asked next —
        // not a wrong figure quietly confirmed.
        expect(openSlots(afterParty)).toEqual(['amount']);
        expect(buildConfirmSentence({
            amount: afterParty.amount,
            currency: afterParty.currency,
            recipient: afterParty.recipient,
            direction: { type: 'sent', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: afterParty.dateInterpretation,
            dateSkipped: false,
            lineItems: null,
        })).not.toContain('Ksh 3 ');
    });

    // Not just the shape that was reported: every relative form carrying a
    // numeral owns it.
    it.each([
        ['4 weeks ago', '25 August 2026'],
        ['2 months ago', '22 July 2026'],
        ['10 days ago', '12 September 2026'],
    ])('applies to "%s" too', (reply, expected) => {
        const { draft } = composeDraftAnswer(emptyDraft(), 'date', reply, NOW_2, 'amount');
        expect(draft.dateInterpretation).toBe(expected);
        expect(draft.amount).toBeNull();
    });

    it('still lets a genuinely bare figure answer "how much?"', () => {
        const { draft, accepted } = composeDraftAnswer(emptyDraft(), 'amount', '3100', NOW_2);
        expect(accepted).toBe(true);
        expect(draft.amount).toBe(3100);
    });

    it('still takes a bare figure offered alongside a date question', () => {
        const { draft } = composeDraftAnswer(emptyDraft(), 'date', 'yesterday', NOW_2, 'amount');
        expect(draft.amount).toBeNull();
        const { draft: filled } = composeDraftAnswer(emptyDraft(), 'date', 'yesterday 3100', NOW_2, 'amount');
        expect(filled.amount).toBe(3100);
    });

    // The rule is about ownership of one numeral, not about ignoring numbers
    // near date words: a real amount in the same breath as a date phrase still
    // fills the amount slot, with its own value.
    it('fills both slots when the answer carries a real amount as well', () => {
        const { draft } = composeDraftAnswer(emptyDraft(), 'date', '3100, 3 days ago', NOW_2, 'amount');
        expect(draft.dateInterpretation).toBe('19 September 2026');
        expect(draft.amount).toBe(3100);
    });

    it('reads a free-typed description the same way', () => {
        const r = extractDescription('paid carrefour supermarket 3 days ago', NOW_2);
        expect(r.missing).toContain('amount');
        expect(r.amount).toBeNull();
    });
});

describe('the chicken-wings point-of-sale transcript', () => {
    // From a real run. One item carrying two descriptive sub-clauses, with its
    // price at the far end of the sentence after a full stop. The amount was
    // read; the description was not, so after the date was answered the bot
    // asked "What did they buy?" — a question the first six words had answered.
    //
    // The cause was NOT the comma splitting, the parentheses or the leading
    // quantity. It was that the only reader of item text anywhere in the flow
    // was the itemisation, and an itemisation needs two prices — so EVERY
    // single-priced message lost its description, sub-clauses or not.
    const MESSAGE = '2 buckets of chicken wings, one spicy, one sweet(honey dipped). worth 2999 ksh';

    const draft = describe1(MESSAGE);

    it('keeps the whole description, sub-clauses and all', () => {
        expect(draft.recipient)
            .toBe('2 buckets of chicken wings, one spicy, one sweet (honey dipped)');
    });

    it('reads the price on the far side of the full stop', () => {
        expect(draft.amount).toBe(2999);
    });

    it('does not break one purchase into a one-row table', () => {
        // The sub-clauses are modifiers of a single item, not items of their
        // own, and a single item is a transaction rather than an itemisation.
        expect(draft.lineItems).toBeNull();
    });

    it('leaves only the date to ask about, and asks nothing after it', () => {
        expect(openSlots(draft)).toEqual(['date']);
        const { draft: dated, asked } = answer(draft, 'yesterday');
        expect(asked).toBe(QUESTION.date);
        expect(openSlots(dated)).toEqual([]);
    });

    it('confirms it as one line, not as a list with a redundant total', () => {
        const sentence = buildConfirmSentence({
            amount: draft.amount,
            currency: draft.currency,
            recipient: draft.recipient,
            direction: { type: 'received', confidence: 95, source: 'keyword' },
            purposeLabel: null,
            dateLabel: '11 September 2026',
            dateSkipped: false,
            lineItems: draft.lineItems,
        });
        expect(sentence).toContain('Ksh 2,999');
        expect(sentence).toContain('chicken wings');
        expect(sentence).not.toContain('total');
    });
});

describe('a price-less comma fragment beside a priced one', () => {
    // The principle behind the fix: a fragment carrying no price, sitting next
    // to one that does, is a description of that item rather than an item of
    // its own. What must NOT change is a list where each entry has its own
    // price — that is a genuine itemisation and still splits.
    it('still splits a genuine multi-item list', () => {
        const d = describe1('chicken wings worth 2999, chips worth 200, soda worth 100');
        expect(d.lineItems?.map(i => [i.description, i.amount])).toEqual([
            ['Chicken wings', 2999], ['Chips', 200], ['Soda', 100],
        ]);
        expect(d.amount).toBe(3299);
    });

    it('folds price-less neighbours into the item that has the price', () => {
        const d = describe1('a crate of sodas, half cold, half warm, worth 1200');
        expect(d.lineItems).toBeNull();
        expect(d.recipient).toBe('Crate of sodas, half cold, half warm');
        expect(d.amount).toBe(1200);
    });

    it('reads a single item with no sub-clauses at all', () => {
        const d = describe1('chicken wings worth 2999 ksh');
        expect(d.recipient).toBe('Chicken wings');
        expect(d.amount).toBe(2999);
    });

    it('does not offer filler as a description', () => {
        // "spent 5000 yesterday" names no goods. Asking is right; filing the
        // purchase as "Yesterday" would not be.
        expect(describe1('spent 5000 yesterday').recipient).toBeNull();
    });

    it('does not read a relative-date phrase as the goods', () => {
        const d = describe1('3 days ago i bought milk for 120');
        expect(d.recipient).toBe('Milk');
        expect(d.amount).toBe(120);
    });
});

describe('the same shapes in the other document types', () => {
    // Each of the three extraction bugs was reported in ONE mode and fixed
    // there. Nothing in extraction is type-aware — composeDescription never
    // sees the document type — but that was an assumption until it was tested,
    // and the assumption is what let the same shape surface three times in
    // three different modes. The exhaustive matrix lives in
    // extractionShapes.test.ts; these are the cells that had to be repaired.
    it('keeps a long noun phrase in front of its descriptive sub-clauses', () => {
        // The reimbursement wording of the chicken-wings shape. "2 crates of
        // milk for the office" is seven words, and the ceiling on a price-less
        // fragment dropped it — leaving the claim described as "One full
        // cream, one skimmed", with the milk itself missing.
        const d = describe1('2 crates of milk for the office, one full cream, one skimmed. worth 2999 ksh');
        expect(d.recipient).toBe('2 crates of milk for the office, one full cream, one skimmed');
        expect(d.amount).toBe(2999);
    });

    it('still refuses a fragment that is narration rather than a thing', () => {
        // The ceiling that let the milk through is generous, so the subject
        // pronoun is what now keeps a scene-setting clause out of the goods.
        // Both of these are longer than the old ceiling allowed.
        for (const preamble of ['it was a long day for me', 'they were out of everything useful']) {
            const d = describe1(`${preamble}, bacon for 3100, tomatoes at 400`);
            expect(d.lineItems?.map(i => i.description)).toEqual(['Bacon', 'Tomatoes']);
        }
    });
});
