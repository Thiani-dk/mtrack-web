// Scroll-position rules for the chat message list. Pure, so the thresholds are
// testable without a layout engine, and shared by any scrolling message
// surface rather than re-derived per screen.

// How close to the bottom (px) counts as "already there" — below this the list
// keeps auto-scrolling on new messages; above it the user is reading history
// and their scroll position is left alone.
export const NEAR_BOTTOM_THRESHOLD = 120;

// Further from the bottom than the auto-scroll cutoff, so the jump control
// doesn't flicker in and out around the point where auto-scroll stops.
const JUMP_VISIBLE_THRESHOLD = 240;

// Below this there is nothing worth jumping to, so the control never appears.
const MIN_SCROLLABLE = 40;

export function isNearBottom(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
    return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;
}

// Whether the jump-to-latest control belongs on screen for a given geometry.
export function shouldShowJumpToLatest(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
    if (scrollHeight - clientHeight <= MIN_SCROLLABLE) return false;
    return scrollHeight - scrollTop - clientHeight > JUMP_VISIBLE_THRESHOLD;
}
