import { buildDemoPasteMessage } from '../demoFlow';
import { isClipboardReadSupported } from '../clipboardRead';
import { isWakeLockSupported } from '../wakeLock';

// The first-run walkthrough's content and its one piece of persisted state.
//
// Nobody should have to guess how Active Mode works, and nobody should be
// walled out of the explanation either — this is shown automatically once, and
// is reachable from the help icon forever after.

const SEEN_KEY = 'mtrack-active-mode-walkthrough-seen';

export function hasSeenWalkthrough(): boolean {
    try {
        return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        // Storage unavailable: show it. A repeated explanation is a much
        // smaller problem than a screen nobody can work out.
        return false;
    }
}

export function markWalkthroughSeen(): void {
    try {
        localStorage.setItem(SEEN_KEY, '1');
    } catch {
        // Nothing to do — it will offer itself again next time.
    }
}

// Seeds, so a vendor can set up in seconds instead of typing from scratch.
// Suggestions only: the walkthrough shows "add your own" just as prominently,
// because these names are a guess about someone else's business.
export const SUGGESTED_BUCKETS = ['Combo sales', 'Single item sales', 'Dessert sales'];

// Instructions for getting messages across, written for someone who does not
// use the words "split screen" or "recents" about their own device.
//
// Ordered by what device testing actually found: the floating window looks
// meaningfully better and behaves the most consistently across browsers, so it
// leads as the recommendation. Split screen is second.
//
// Note what is NOT claimed. Simultaneous split screen is an Android feature;
// iPads have their own Split View and iPhones have neither. Widening this to
// "most smartphones" would read as broader but be wrong, and would send iPhone
// users hunting for a setting that does not exist — so the platforms are named,
// and swapping between apps stays the method presented as always working.
export interface HowToStep {
    heading: string;
    body: string;
}

export const SCREEN_SHARING_STEPS: HowToStep[] = [
    {
        heading: 'Use a floating window (recommended)',
        body: 'Most Chromium-based browsers (Chrome, Brave, and others) let you pop a tab out '
            + "into a small floating window. Look for it in your browser's menu, then drag it "
            + 'over your messages app.',
    },
    {
        heading: 'Or try split screen',
        body: 'On Android, open your recent apps, press and hold M-Track, and choose Split screen '
            + "— then open your messages app in the other half. (iPhones don't support this; "
            + 'iPads have a similar Split View.)',
    },
    {
        // Unchanged wording — it was already accurate and well-written. Only
        // its position moved, from second to last.
        heading: 'If not, no problem — just swap between apps',
        body: 'Leave M-Track open, go to your messages app, copy the payment message, '
            + 'then come back to M-Track and paste. It only takes a couple of seconds either way, '
            + 'and it works on any phone.',
    },
];

export const PRACTICE_SENDER = 'JOHN KAMAU';
export const PRACTICE_AMOUNT = 350;

// A realistic fake M-Pesa sale for the practice round, built by the same
// generator the main demo's paste lesson uses — same transaction code shape,
// same date format, same balance line — so what the parser pulls out of it is
// the same thing it will pull out of a real one.
export function buildPracticeSaleMessage(now: Date = new Date()): string {
    return buildDemoPasteMessage({
        recipient: PRACTICE_SENDER,
        amount: PRACTICE_AMOUNT,
        date: now,
        category: null,
        direction: 'received',
    });
}

// ── What this device can actually do ──────────────────────────────────────────

// Two short lines about conveniences that only exist on some devices, so they
// are assembled from what the current one actually supports. Describing a
// screen-awake feature to someone whose browser has no Wake Lock, or pointing
// at a Paste button that was never rendered, is worse than staying quiet: it
// sends them looking for something that is not there.
export interface DeviceCapabilities {
    wakeLock: boolean;
    clipboardRead: boolean;
}

export function detectCapabilities(): DeviceCapabilities {
    return { wakeLock: isWakeLockSupported(), clipboardRead: isClipboardReadSupported() };
}

export const WAKE_LOCK_LINE =
    "Your screen stays on by itself while this is open, so it won't dim on you mid-rush.";

export const PASTE_BUTTON_LINE =
    'The Paste button next to the message box pulls in a copied message in one tap — '
    + 'no long-press needed.';

// The lines worth showing on this device, in order. Empty when it supports
// neither, in which case the walkthrough step is skipped entirely.
export function capabilityLines(caps: DeviceCapabilities): string[] {
    const lines: string[] = [];
    if (caps.wakeLock) lines.push(WAKE_LOCK_LINE);
    if (caps.clipboardRead) lines.push(PASTE_BUTTON_LINE);
    return lines;
}
