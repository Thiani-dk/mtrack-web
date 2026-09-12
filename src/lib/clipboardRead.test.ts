import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CLIPBOARD_FAILURE_MESSAGE, dismissPasteTip, hasSeenPasteTip,
    isClipboardReadSupported, PASTE_TIP_MESSAGE, readClipboardText,
} from './clipboardRead';

// Clipboard reading is patchy and refusable, and the manual fallback —
// long-press into the field and paste — is always right there. So every way
// this can fail comes back as a value, never a throw.

describe('feature detection', () => {
    it('sees a usable clipboard', () => {
        expect(isClipboardReadSupported({ clipboard: { readText: async () => 'x' } })).toBe(true);
    });

    it('says no where there is nothing to use', () => {
        expect(isClipboardReadSupported({})).toBe(false);
        expect(isClipboardReadSupported(undefined)).toBe(false);
        // Present but without readText — a write-only clipboard, which some
        // contexts do expose.
        expect(isClipboardReadSupported({ clipboard: {} })).toBe(false);
    });
});

describe('reading', () => {
    it('returns the text', async () => {
        const nav = { clipboard: { readText: async () => 'QGH7XK9P2L Confirmed. Ksh350.00' } };
        expect(await readClipboardText(nav)).toEqual({
            text: 'QGH7XK9P2L Confirmed. Ksh350.00', failure: null,
        });
    });

    it('reports an empty clipboard rather than pasting nothing', async () => {
        expect(await readClipboardText({ clipboard: { readText: async () => '' } }))
            .toEqual({ text: null, failure: 'empty' });
        expect(await readClipboardText({ clipboard: { readText: async () => '   \n ' } }))
            .toEqual({ text: null, failure: 'empty' });
    });

    it('turns a refused permission into a value, not a throw', async () => {
        const nav = { clipboard: { readText: vi.fn(async () => { throw new Error('NotAllowedError'); }) } };
        await expect(readClipboardText(nav)).resolves.toEqual({ text: null, failure: 'denied' });
    });

    it('does not call the API at all where it is unsupported', async () => {
        expect(await readClipboardText({})).toEqual({ text: null, failure: 'unsupported' });
    });

    it('has one low-key line for the user, naming the fallback', () => {
        // The fallback is what they should do next, so the message says it.
        expect(CLIPBOARD_FAILURE_MESSAGE).toBe(
            "Couldn't read the clipboard — try pasting into the field instead.",
        );
        expect(CLIPBOARD_FAILURE_MESSAGE).toContain('pasting into the field');
    });
});

describe('the composer tip, shown once', () => {
    beforeEach(() => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is unseen at first and seen once dismissed', () => {
        expect(hasSeenPasteTip()).toBe(false);
        dismissPasteTip();
        expect(hasSeenPasteTip()).toBe(true);
    });

    it('never reappears once dismissed', () => {
        dismissPasteTip();
        dismissPasteTip();
        expect(hasSeenPasteTip()).toBe(true);
    });

    it('stays quiet rather than repeating when storage is unavailable', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        // A tip is a nicety; one that reappears every single session is worse
        // than one nobody ever gets. Note this is the opposite call to the
        // Active Mode walkthrough, which shows itself when storage fails —
        // that one explains the whole screen, this one labels a button.
        expect(hasSeenPasteTip()).toBe(true);
        expect(() => dismissPasteTip()).not.toThrow();
    });

    it('is one short line', () => {
        expect(PASTE_TIP_MESSAGE).toBe('Tip: tap here to paste a copied message directly.');
    });
});
