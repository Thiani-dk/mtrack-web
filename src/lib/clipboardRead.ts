// Reading the clipboard, feature-detected the same way everything else in this
// app that touches a patchy browser API is.
//
// This exists to shave the long-press-into-the-field-then-Paste motion down to
// one tap. It matters most on iOS, which cannot register as a native share
// target the way Android can — that is a platform limitation rather than
// something to engineer around, and a Paste button is the closest thing that
// works on both.
//
// readText() must be called inside a user gesture on both platforms, which is
// why this is only ever reached from an onClick.

export interface ClipboardNavigatorLike {
    clipboard?: { readText?: () => Promise<string> };
}

function globalNavigator(): ClipboardNavigatorLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as ClipboardNavigatorLike);
}

// Whether a Paste button should exist at all. Where this is false the button is
// not rendered, and long-press-and-paste into the field works exactly as it
// always has — an always-failing button would be worse than no button.
export function isClipboardReadSupported(
    nav: ClipboardNavigatorLike | undefined = globalNavigator(),
): boolean {
    return !!nav?.clipboard && typeof nav.clipboard.readText === 'function';
}

export type ClipboardReadFailure = 'unsupported' | 'denied' | 'empty';

export type ClipboardReadResult =
    | { text: string; failure: null }
    | { text: null; failure: ClipboardReadFailure };

// Every way this can go wrong — no API, permission refused, nothing on the
// clipboard — comes back as a value rather than a thrown error, because the
// manual fallback is sitting right there and none of these deserve to
// interrupt anyone.
export async function readClipboardText(
    nav: ClipboardNavigatorLike | undefined = globalNavigator(),
): Promise<ClipboardReadResult> {
    if (!isClipboardReadSupported(nav)) return { text: null, failure: 'unsupported' };
    try {
        const text = await nav!.clipboard!.readText!();
        if (!text || !text.trim()) return { text: null, failure: 'empty' };
        return { text, failure: null };
    } catch {
        // A refused permission and a browser that throws on principle are the
        // same thing from here: we did not get any text.
        return { text: null, failure: 'denied' };
    }
}

// One low-key line, never a dialog. It names the fallback because the fallback
// is what the person should do next.
export const CLIPBOARD_FAILURE_MESSAGE =
    "Couldn't read the clipboard — try pasting into the field instead.";

// ── First-appearance tip ─────────────────────────────────────────────────────

// The chat composer's Paste button is not covered by Active Mode's
// walkthrough, so it gets one small, dismissible line the first time it is
// seen. Once dismissed it never returns — a tip that keeps coming back is
// noise, and this one sits next to a conversation it must never interrupt.
const PASTE_TIP_KEY = 'mtrack-paste-tip-dismissed';

export const PASTE_TIP_MESSAGE = 'Tip: tap here to paste a copied message directly.';

export function hasSeenPasteTip(): boolean {
    try {
        return localStorage.getItem(PASTE_TIP_KEY) === '1';
    } catch {
        // Storage unavailable. Treat it as seen: a tip is a nicety, and one
        // that reappears every session is worse than one nobody ever gets.
        return true;
    }
}

export function dismissPasteTip(): void {
    try {
        localStorage.setItem(PASTE_TIP_KEY, '1');
    } catch {
        // Nothing to do.
    }
}
