import { buildDemoPasteMessage } from '../demoFlow';

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

// Phone-app instructions, written for someone who does not use the words
// "split screen" or "recents" about their own phone.
//
// Note what is NOT claimed: iPhones do not have Split View — that is iPad
// only — so switching apps is presented as the method that always works,
// rather than as a lesser fallback.
export interface HowToStep {
    heading: string;
    body: string;
}

export const SCREEN_SHARING_STEPS: HowToStep[] = [
    {
        heading: 'If your phone does split screen (most Android phones do)',
        body: 'Open your recent apps, press and hold on M-Track, and choose Split screen. '
            + 'Then open your messages app in the other half. Both stay on screen at once.',
    },
    {
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
