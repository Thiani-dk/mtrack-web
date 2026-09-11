import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPracticeSaleMessage, hasSeenWalkthrough, markWalkthroughSeen,
    PRACTICE_AMOUNT, PRACTICE_SENDER, SCREEN_SHARING_STEPS, SUGGESTED_BUCKETS,
} from './walkthrough';
import { captureFromPaste } from './session';

// A tiny localStorage for the seen-once flag.
function stubStorage(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
    });
}

describe('showing it once, then on demand', () => {
    beforeEach(stubStorage);
    afterEach(() => vi.unstubAllGlobals());

    it('offers itself on a first ever open, and not on the next one', () => {
        expect(hasSeenWalkthrough()).toBe(false);
        markWalkthroughSeen();
        expect(hasSeenWalkthrough()).toBe(true);
    });

    it('shows rather than hides when storage is unavailable', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        // A repeated explanation is a far smaller problem than a screen nobody
        // can work out, and markWalkthroughSeen must not throw either.
        expect(hasSeenWalkthrough()).toBe(false);
        expect(() => markWalkthroughSeen()).not.toThrow();
    });
});

describe('the practice sale', () => {
    it('is a realistic message the real parser reads as a sale', () => {
        const message = buildPracticeSaleMessage(new Date('2026-09-12T13:05:00'));
        const { transaction } = captureFromPaste(message);

        expect(transaction).not.toBeNull();
        expect(transaction!.amount).toBe(PRACTICE_AMOUNT);
        expect(transaction!.type).toBe('received');
        expect(transaction!.recipient.toUpperCase()).toContain(PRACTICE_SENDER);
        // It goes through the ordinary SMS pipeline, like a real paste.
        expect(transaction!.dataSource).toBe('sms_verified');
        expect(transaction!.codeIsSynthetic).toBe(false);
    });

    it('comes from the demo generator, so it has a real code, date and balance', () => {
        const message = buildPracticeSaleMessage(new Date('2026-09-12T13:05:00'));
        expect(message).toMatch(/^[A-Z0-9]{10} Confirmed\./);
        expect(message).toContain('New M-PESA balance is');
        expect(message).toContain('12/9/26 at 1:05 PM');
    });

    it('is a different message each time, like real ones are', () => {
        const a = buildPracticeSaleMessage();
        const b = buildPracticeSaleMessage();
        expect(a.slice(0, 10)).not.toBe(b.slice(0, 10));
    });
});

describe('the walkthrough copy', () => {
    it('gives both ways of getting messages across', () => {
        expect(SCREEN_SHARING_STEPS).toHaveLength(2);
        const [split, swap] = SCREEN_SHARING_STEPS;
        expect(split.heading.toLowerCase()).toContain('split screen');
        expect(split.body.toLowerCase()).toContain('recent apps');
        // The second path is the one that needs no feature at all.
        expect(swap.body.toLowerCase()).toContain('copy');
        expect(swap.body.toLowerCase()).toContain('paste');
    });

    it('does not promise iPhone users split screen, and presents swapping as universal', () => {
        const all = SCREEN_SHARING_STEPS.map(s => `${s.heading} ${s.body}`).join(' ').toLowerCase();
        // Split View is iPad-only; claiming it for a phone sends someone
        // hunting for a setting that isn't there.
        expect(all).not.toContain('iphone');
        expect(all).not.toContain('split view');
        expect(all).toContain('most android phones');
        expect(SCREEN_SHARING_STEPS[1].body.toLowerCase()).toContain('works on any phone');
    });

    it('suggests a few buckets without pretending to know the business', () => {
        expect(SUGGESTED_BUCKETS).toEqual(['Combo sales', 'Single item sales', 'Dessert sales']);
    });
});
