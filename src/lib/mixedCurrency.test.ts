import { describe, expect, it } from 'vitest';
import { extractDescription, mixedCurrencyQuestion, openSlots } from './conversationalCapture';
import { composeDescription, composeDraftAnswer, emptyCaptureDraft } from './captureDraft';

// Two currencies in one typed message.
//
// From the flow sweep. Refusing to total them across an exchange rate was
// always the rule, and the itemisation was correctly thrown away — but the
// amount then fell back to whichever single figure scored highest. "a chip for
// 200 USD and lunch for 500 bob" was confirmed as "$200. Right?", with the
// other purchase never mentioned. mixedCurrency had exactly one reader in the
// whole codebase, and all it did was discard the itemisation.

const NOW = new Date('2026-09-12T09:00:00');
const MESSAGE = 'a chip for 200 USD and lunch for 500 bob';

describe('a message priced in two currencies', () => {
    it('does not pick one of the figures as the total', () => {
        expect(extractDescription(MESSAGE, NOW).amount).toBeNull();
    });

    it('reports which currencies it found', () => {
        expect(extractDescription(MESSAGE, NOW).mixedCurrencies).toEqual(['USD', 'KES']);
    });

    it('still knows what was bought, so it does not ask that as well', () => {
        expect(extractDescription(MESSAGE, NOW).recipient).toBe('Chip, Lunch');
    });

    it('leaves only the amount and the date to ask about', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), MESSAGE, NOW);
        expect(openSlots(draft)).toEqual(['date', 'amount']);
    });

    it('says which two currencies, rather than a bare "how much?"', () => {
        const q = mixedCurrencyQuestion(['USD', 'KES']);
        expect(q).toContain('USD and KES');
        expect(q).toContain('exchange rate');
    });

    it('takes the total the user then gives', () => {
        const { draft } = composeDescription(emptyCaptureDraft(), MESSAGE, NOW);
        const answered = composeDraftAnswer(draft, 'amount', '65000', NOW).draft;
        expect(answered.amount).toBe(65_000);
    });

    it('applies to the hardware case the rule was written for', () => {
        const d = extractDescription('ram 5000 USD, monitor 200 GBP', NOW);
        expect(d.amount).toBeNull();
        expect(d.mixedCurrencies).toEqual(['USD', 'GBP']);
    });

    it('leaves a single-currency message exactly as it was', () => {
        const d = extractDescription('ram 5000 USD, monitor 12000 USD', NOW);
        expect(d.mixedCurrencies).toBeNull();
        expect(d.amount).toBe(17_000);
    });
});
