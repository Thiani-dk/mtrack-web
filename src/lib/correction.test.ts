import { describe, expect, it } from 'vitest';
import { emptyCaptureDraft, composeDescription, type CaptureDraft } from './captureDraft';
import { resolveCorrection } from './correction';

const NOW = new Date('2026-09-12T09:00:00');

// A draft built the way production builds one, so these tests cannot pass
// against a shape the app never produces.
function draftFrom(text: string): CaptureDraft {
    return composeDescription(emptyCaptureDraft(), text, NOW).draft;
}

const THREE_ITEMS = draftFrom('i bought bacon and pork cuts for 3100, tomatoes and garlic at 400, '
    + 'then i bought airtime worth 30');

describe('resolving which fact a correction is about', () => {
    it('follows an explicit reference to a captured item', () => {
        const out = resolveCorrection(THREE_ITEMS, 'the pork cuts one was actually 3500', NOW);
        expect(out.kind).toBe('applied');
        if (out.kind !== 'applied') return;
        expect(out.target).toEqual({ kind: 'line-item', index: 0 });
        expect(out.draft.lineItems?.[0].amount).toBe(3500);
        // The other items are untouched, and the total moves with the change.
        expect(out.draft.lineItems?.map(i => i.amount)).toEqual([3500, 400, 30]);
        expect(out.draft.amount).toBe(3930);
    });

    it('matches on a single word of the item description', () => {
        const out = resolveCorrection(THREE_ITEMS, 'oh the airtime was actually 50', NOW);
        expect(out.kind === 'applied' && out.target).toEqual({ kind: 'line-item', index: 2 });
    });

    it('asks which one, rather than guessing, when nothing is named', () => {
        const out = resolveCorrection(THREE_ITEMS, 'actually it was 3500', NOW);
        expect(out.kind).toBe('ambiguous');
        if (out.kind !== 'ambiguous') return;
        expect(out.options).toHaveLength(3);
        expect(out.text).toContain('Which one');
        // A silent edit of the wrong line is the one failure the user cannot
        // see, so guessing is not an option here.
    });

    it('needs no question when there is only one item it could mean', () => {
        const one = draftFrom('bought bacon for 3100');
        const out = resolveCorrection(one, 'actually it was 3500', NOW);
        expect(out.kind).toBe('applied');
        if (out.kind !== 'applied') return;
        expect(out.draft.amount).toBe(3500);
    });
});

describe('what a correction shows the user', () => {
    it('names the change, rather than applying it silently', () => {
        const out = resolveCorrection(THREE_ITEMS, 'the bacon was actually 3500', NOW);
        expect(out.kind === 'applied' && out.echo).toContain('3,100');
        expect(out.kind === 'applied' && out.echo).toContain('3,500');
        expect(out.kind === 'applied' && out.echo).toContain('→');
    });

    it('states the new total, since a line change moves it', () => {
        const out = resolveCorrection(THREE_ITEMS, 'the bacon was actually 3500', NOW);
        expect(out.kind === 'applied' && out.echo).toContain('3,930');
    });
});

describe('corrections to fields other than an item amount', () => {
    const single = draftFrom('paid Kevin 500 yesterday');

    it('corrects a plain amount', () => {
        const out = resolveCorrection(single, 'sorry, it was 800', NOW);
        expect(out.kind === 'applied' && out.target).toEqual({ kind: 'amount' });
        expect(out.kind === 'applied' && out.draft.amount).toBe(800);
    });

    it('corrects a date', () => {
        const out = resolveCorrection(single, 'actually it was on 4 May 2026', NOW);
        expect(out.kind === 'applied' && out.target).toEqual({ kind: 'date' });
        expect(out.kind === 'applied' && out.draft.date).toEqual(new Date('2026-05-04T12:00:00'));
    });

    it('corrects a currency', () => {
        const out = resolveCorrection(single, 'sorry, that was USD', NOW);
        expect(out.kind === 'applied' && out.target).toEqual({ kind: 'currency' });
        expect(out.kind === 'applied' && out.draft.currency.code).toBe('USD');
    });

    it('corrects a recipient', () => {
        const out = resolveCorrection(single, 'I meant Kevo', NOW);
        expect(out.kind === 'applied' && out.target).toEqual({ kind: 'recipient' });
        expect(out.kind === 'applied' && out.draft.recipient).toBe('Kevo');
    });

    it('recalculates a unit price that was derived from a quantity', () => {
        const qty = draftFrom('bought 3 x sodas for Ksh 300, bread for Ksh 60');
        expect(qty.lineItems?.[0].quantity).toBe(3);
        const out = resolveCorrection(qty, 'the sodas were actually 360', NOW);
        expect(out.kind === 'applied' && out.draft.lineItems?.[0].unitPrice).toBe(120);
    });
});

describe('a correction with nothing to apply', () => {
    it('asks what it should be, rather than changing something at random', () => {
        const out = resolveCorrection(THREE_ITEMS, 'actually, hmm', NOW);
        expect(out.kind).toBe('unresolved');
    });
});
