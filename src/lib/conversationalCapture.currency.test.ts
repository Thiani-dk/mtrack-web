import { describe, expect, it } from 'vitest';
import { extractAmount, extractAmountCandidates } from './parsers/extractors/amount';
import { detectCurrencies, detectCurrency } from './parsers/extractors/currency';
import { parseNumeric, parseNumericTokens } from './parsers/extractors/numeric';
import {
    buildConfirmSentence, currencyFromConversation, lockCurrency, parseAmountReply,
    UNSTATED_CURRENCY, type ConfirmFields,
} from './conversationalCapture';
import { fmtAmountProse } from './transactionDisplay';

// The conversation this is built from, verbatim. A user described four
// itemised hardware sales in US Dollars; none of it was read, the bot asked
// again for what it had already been told, parsed the answer "100k USD" as the
// number 100, dropped the currency, and asked them to confirm "Ksh 100". They
// said yes. Every assertion below exists because some part of that chain was
// silent about a fact it had.
export const FIXTURE = {
    first: 'They bought hardware. Computer components. Some ram I sold at 5000USD, '
        + 'AI chip 10k USD, CPU 10k USD, motherboard 7000usd,',
    date: 'Yesterday, around 7pm',
    amount: 'In total? 100k USD',
    what: 'Computer stuff',
};

describe('numeric shorthand', () => {
    it('reads k and m as thousands and millions, attached or spaced', () => {
        expect(parseNumeric('100k')).toBe(100_000);
        expect(parseNumeric('100K')).toBe(100_000);
        expect(parseNumeric('100 k')).toBe(100_000);
        expect(parseNumeric('5.5k')).toBe(5_500);
        expect(parseNumeric('1.2m')).toBe(1_200_000);
        expect(parseNumeric('1.2M')).toBe(1_200_000);
        expect(parseNumeric('100 thousand')).toBe(100_000);
        expect(parseNumeric('3 million')).toBe(3_000_000);
    });

    it('leaves a plain number alone', () => {
        expect(parseNumeric('5000')).toBe(5000);
        expect(parseNumeric('45,000')).toBe(45_000);
        expect(parseNumeric('1,250.50')).toBe(1250.5);
    });

    it('does not misfire on a k or an m elsewhere in the sentence', () => {
        // The multiplier has to be adjacent to the number, not merely present.
        expect(parseNumeric('5000 for the kiosk')).toBe(5000);
        expect(parseNumeric('paid 5000 in Mombasa')).toBe(5000);
        expect(parseNumeric('2000 for milk')).toBe(2000);
        expect(parseNumeric('sent 800 to Kevin')).toBe(800);
    });

    it('reports where the number ends, so a currency code after it stays readable', () => {
        const [tok] = parseNumericTokens('5000USD');
        expect(tok.value).toBe(5000);
        expect('5000USD'.slice(tok.end)).toBe('USD');
    });
});

describe('currency detection', () => {
    it('reads a code before, after, or hard against the number', () => {
        expect(detectCurrency('USD 5,000')).toBe('USD');
        expect(detectCurrency('5000USD')).toBe('USD');
        expect(detectCurrency('10k USD')).toBe('USD');
        expect(detectCurrency('7000usd')).toBe('USD');
        expect(detectCurrency('$5,000')).toBe('USD');
        expect(detectCurrency('Ksh 45,000')).toBe('KES');
        expect(detectCurrency('paid 40 euros')).toBe('EUR');
        expect(detectCurrency('£200')).toBe('GBP');
    });

    it('says nothing when nothing was said, rather than defaulting', () => {
        expect(detectCurrency('Sold a laptop for 45,000')).toBeNull();
        expect(detectCurrency('paid Kevin 500 yesterday')).toBeNull();
    });

    it('does not read a currency out of an ordinary word', () => {
        expect(detectCurrency('I pounded the dough')).toBeNull();
        expect(detectCurrency('bought it in Kshana')).toBeNull();
        expect(detectCurrency('the usdollar thing')).toBeNull();
    });

    it('notices when one message mixes currencies', () => {
        expect(detectCurrencies('5000 USD and 200 GBP')).toEqual(['USD', 'GBP']);
    });
});

describe('amounts, currency-tagged', () => {
    it('parses every item in the first message of the fixture', () => {
        const found = extractAmountCandidates(FIXTURE.first);
        expect(found.map(c => c.amount)).toEqual([5000, 10_000, 10_000, 7000]);
        expect(found.map(c => c.currency)).toEqual(['USD', 'USD', 'USD', 'USD']);
        expect(found.reduce((s, c) => s + c.amount, 0)).toBe(32_000);
    });

    it('parses "100k USD" as 100,000 US Dollars', () => {
        // The exact answer that became "Ksh 100".
        expect(extractAmount('100k USD')).toEqual({ amount: 100_000, currency: 'USD', confidence: 80 });
        expect(parseAmountReply(FIXTURE.amount)).toEqual({ amount: 100_000, detectedCurrency: 'USD' });
    });

    it('still reads an ordinary Shilling amount', () => {
        expect(extractAmount('Sold a laptop for Ksh 45,000')).toMatchObject({ amount: 45_000, currency: 'KES' });
        expect(parseAmountReply('45000')).toEqual({ amount: 45_000, detectedCurrency: null });
    });

    it('refuses a reply with no number in it', () => {
        expect(parseAmountReply('quite a lot').amount).toBeNull();
    });
});

describe('the currency lock', () => {
    it('locks onto the currency stated in the first message', () => {
        const lock = lockCurrency(UNSTATED_CURRENCY, FIXTURE.first);
        expect(lock).toEqual({ code: 'USD', explicit: true });
    });

    it('holds that currency through later messages that never mention one', () => {
        // The failure was the opposite: each turn re-derived the currency from
        // one message in isolation and fell back to KES.
        const lock = currencyFromConversation([FIXTURE.first, FIXTURE.date, FIXTURE.amount, FIXTURE.what]);
        expect(lock).toEqual({ code: 'USD', explicit: true });

        const stepwise = [FIXTURE.date, FIXTURE.what].reduce(lockCurrency, lockCurrency(UNSTATED_CURRENCY, FIXTURE.first));
        expect(stepwise.code).toBe('USD');
    });

    it('picks up a currency first mentioned in a later answer', () => {
        const lock = currencyFromConversation(['Sold some parts', 'yesterday', '100k USD']);
        expect(lock).toEqual({ code: 'USD', explicit: true });
    });

    it('marks KES as an assumption when the conversation never named a currency', () => {
        const lock = currencyFromConversation(['Sold a laptop for 45,000', 'yesterday', 'to Kevin']);
        expect(lock).toEqual({ code: 'KES', explicit: false });
    });

    it('does not let a later message overwrite the locked currency', () => {
        const usd = lockCurrency(UNSTATED_CURRENCY, '10k USD');
        expect(lockCurrency(usd, 'Ksh actually no').code).toBe('USD');
    });
});

describe('amounts written back to the user', () => {
    it('names the currency, exactly, whichever one it is', () => {
        expect(fmtAmountProse(32_000, 'USD')).toBe('$32,000');
        expect(fmtAmountProse(100_000, 'USD')).toBe('$100,000');
        expect(fmtAmountProse(45_000, 'KES')).toBe('Ksh 45,000');
        expect(fmtAmountProse(200, 'GBP')).toBe('£200');
        expect(fmtAmountProse(5000, 'TZS')).toBe('TZS 5,000');
    });

    it('does not round the figure the user is being asked to agree to', () => {
        expect(fmtAmountProse(45_678, 'KES')).toBe('Ksh 45,678');
        expect(fmtAmountProse(1_250.5, 'KES')).toBe('Ksh 1,250.50');
    });
});

describe('the confirmation sentence', () => {
    const base: ConfirmFields = {
        amount: 32_000,
        currency: { code: 'USD', explicit: true },
        recipient: 'Computer components',
        direction: { type: 'received', confidence: 95, source: 'keyword' },
        purposeLabel: null,
        dateLabel: '11 September 2026',
        dateSkipped: false,
    };

    it('names a stated currency', () => {
        expect(buildConfirmSentence(base))
            .toBe('$32,000 from Computer components, on 11 September 2026. Right?');
    });

    it('never presents a USD amount as Shillings', () => {
        const sentence = buildConfirmSentence(base);
        expect(sentence).not.toContain('Ksh');
        expect(sentence).toContain('$32,000');
    });

    it('says out loud that KES was an assumption when nobody mentioned a currency', () => {
        const sentence = buildConfirmSentence({
            ...base, amount: 45_000, currency: UNSTATED_CURRENCY, recipient: 'Kevin',
        });
        expect(sentence).toBe(
            "Ksh 45,000 from Kevin, on 11 September 2026 — I've assumed Kenyan Shillings, "
            + 'since none was mentioned. Right?',
        );
    });

    it('does not claim an assumption when the user stated Shillings themselves', () => {
        const sentence = buildConfirmSentence({
            ...base, amount: 45_000, currency: { code: 'KES', explicit: true }, recipient: 'Kevin',
        });
        expect(sentence).toBe('Ksh 45,000 from Kevin, on 11 September 2026. Right?');
        expect(sentence).not.toContain('assumed');
    });

    it('leaves the direction out of it until the direction is known', () => {
        const sentence = buildConfirmSentence({
            ...base, direction: { type: 'sent', confidence: 30, source: 'unresolved' },
        });
        expect(sentence).toBe('$32,000, Computer components, on 11 September 2026. Right?');
    });

    it('reproduces the bug from the transcript, and no longer produces it', () => {
        // What the user was shown: "Ksh 100 to Computer stuff, on 10 September
        // 2026. Right?" — wrong by five orders of magnitude and in the wrong
        // currency. Same inputs, read correctly this time.
        const lock = currencyFromConversation([FIXTURE.first, FIXTURE.date, FIXTURE.amount, FIXTURE.what]);
        const amount = parseAmountReply(FIXTURE.amount).amount;
        const sentence = buildConfirmSentence({
            ...base, amount, currency: lock, recipient: 'Computer stuff',
        });
        expect(sentence).toContain('$100,000');
        expect(sentence).not.toContain('Ksh 100');
        expect(sentence).not.toContain('Ksh');
    });
});
