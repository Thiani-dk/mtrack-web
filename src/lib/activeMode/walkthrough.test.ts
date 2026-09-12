import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildPracticeSaleMessage, capabilityLines, detectCapabilities, hasSeenWalkthrough,
    markWalkthroughSeen, PASTE_BUTTON_LINE, PRACTICE_AMOUNT, PRACTICE_SENDER,
    SCREEN_SHARING_STEPS, SUGGESTED_BUCKETS, WAKE_LOCK_LINE,
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
    it('leads with the floating window, then split screen, then swapping apps', () => {
        // Device testing found the floating window both better-looking and the
        // most consistent across browsers, so it is the recommendation rather
        // than an afterthought.
        expect(SCREEN_SHARING_STEPS).toHaveLength(3);
        const [floating, split, swap] = SCREEN_SHARING_STEPS;

        expect(floating.heading).toBe('Use a floating window (recommended)');
        expect(floating.body).toContain('Chromium-based browsers');
        expect(floating.body).toContain('floating window');

        expect(split.heading).toBe('Or try split screen');
        expect(split.body).toContain('recent apps');

        // The universal fallback is last, and its wording is untouched.
        expect(swap.heading).toBe('If not, no problem — just swap between apps');
        expect(swap.body).toBe(
            'Leave M-Track open, go to your messages app, copy the payment message, '
            + 'then come back to M-Track and paste. It only takes a couple of seconds either way, '
            + 'and it works on any phone.',
        );
    });

    it('scopes split screen to the platforms that actually have it', () => {
        const split = SCREEN_SHARING_STEPS[1];
        // Simultaneous split screen is an Android feature. Naming iPhone and
        // iPad explicitly is the honest fix; "most smartphones" would read as
        // broader and be wrong.
        expect(split.body).toContain('On Android');
        expect(split.body).toContain("iPhones don't support this");
        expect(split.body).toContain('iPads have a similar Split View');
    });

    it('overstates nothing about any platform', () => {
        const all = SCREEN_SHARING_STEPS.map(s => `${s.heading} ${s.body}`).join(' ');

        // No blanket claim that every phone can do this.
        expect(all.toLowerCase()).not.toContain('most smartphones');
        expect(all.toLowerCase()).not.toContain('all phones');
        // Split View is named only as the iPad feature it is, never promised to
        // an iPhone, and never claimed for M-Track itself.
        expect(all).toMatch(/iPads have a similar Split View/);
        expect(all).not.toMatch(/iPhones? (?:have|support|can use) Split View/i);
        // The floating window is scoped to the browsers that have it.
        expect(SCREEN_SHARING_STEPS[0].body).toMatch(/Most Chromium-based browsers/);
        // And one method is still presented as working anywhere.
        expect(all).toContain('it works on any phone');
    });

    it('suggests a few buckets without pretending to know the business', () => {
        expect(SUGGESTED_BUCKETS).toEqual(['Combo sales', 'Single item sales', 'Dessert sales']);
    });
});

describe('the device-capability lines', () => {
    it('mentions the screen staying on only where Wake Lock exists', () => {
        expect(capabilityLines({ wakeLock: true, clipboardRead: false })).toEqual([WAKE_LOCK_LINE]);
        expect(capabilityLines({ wakeLock: false, clipboardRead: false })).toEqual([]);
    });

    it('mentions the Paste button only where clipboard reading exists', () => {
        // The button is not rendered without it, and pointing at a control
        // that is not on screen sends someone hunting for nothing.
        expect(capabilityLines({ wakeLock: false, clipboardRead: true })).toEqual([PASTE_BUTTON_LINE]);
    });

    it('shows both where both exist, screen first', () => {
        expect(capabilityLines({ wakeLock: true, clipboardRead: true }))
            .toEqual([WAKE_LOCK_LINE, PASTE_BUTTON_LINE]);
    });

    it('says nothing at all on a device with neither', () => {
        // The walkthrough step is then skipped entirely rather than rendering
        // an empty heading.
        expect(capabilityLines({ wakeLock: false, clipboardRead: false })).toHaveLength(0);
    });

    it('keeps both lines to a sentence', () => {
        // The walkthrough gains two useful lines, not a chapter.
        for (const line of [WAKE_LOCK_LINE, PASTE_BUTTON_LINE]) {
            expect(line.length).toBeLessThan(130);
            expect(line.split('. ').filter(Boolean).length).toBeLessThanOrEqual(2);
        }
    });

    it('reads the real APIs when asked about this device', () => {
        const caps = detectCapabilities();
        expect(typeof caps.wakeLock).toBe('boolean');
        expect(typeof caps.clipboardRead).toBe('boolean');
        // In a plain Node test environment neither API exists, so nothing
        // would be claimed.
        expect(capabilityLines(caps)).toEqual([]);
    });
});
