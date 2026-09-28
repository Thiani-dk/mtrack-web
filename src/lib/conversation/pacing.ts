// How long to leave the typing indicator up before a bot reply.
//
// The point is not to pretend someone is typing. It is that a wall of text
// appearing in the same instant as the message that prompted it reads as a
// form submitting, not as a reply, and a user has no chance to see WHICH of
// two or three bubbles is new. A short beat, scaled to how much there is to
// read, makes the order of a multi-bubble turn legible.
//
// Both bounds are deliberately tight. Anything under a quarter of a second is
// not perceptible as a beat; anything over about three quarters is the app
// wasting the user's time to look busy, which is the failure mode this has to
// stay well clear of.

export const PACING_MIN_MS = 250;
export const PACING_MAX_MS = 700;
// Roughly one second per 300 characters, which lands a one-line reply near the
// minimum and a three-sentence one near the maximum.
export const PACING_MS_PER_CHAR = 3.2;

export function pacingDelay(text: string): number {
    const scaled = PACING_MIN_MS + text.length * PACING_MS_PER_CHAR;
    return Math.round(Math.min(PACING_MAX_MS, Math.max(PACING_MIN_MS, scaled)));
}

// Whether to pace at all.
//
// Off when the user has asked for reduced motion: a pulsing indicator is
// exactly the kind of thing that setting exists to stop, and the reply is more
// useful than the beat.
//
// Active Mode does not come through here at all — it has its own screen and
// its own capture path, and a beat before every line would be intolerable
// when the whole point is recording sales as fast as they happen.
export function pacingEnabled(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
