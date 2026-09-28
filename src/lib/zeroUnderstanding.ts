import type { DescriptionResult } from './conversationalCapture';
import { DATE_REASON_UNREADABLE } from './parsers/conversationalDate';

// Telling "I understood part of that" apart from "I understood none of it".
//
// These are different facts and they deserve different sentences. When the
// extraction came back empty, the flow used to fall through to the same
// next-question-in-sequence it would ask having understood everything but one
// field — so a message it made nothing at all of was answered with "How much
// was it?". That question implies the rest landed. It didn't, and saying so is
// the only way the user learns to rephrase rather than answer a question that
// was never really about their message.

// Whether a single message yielded literally nothing.
//
// Deliberately strict: ANY signal at all means partial understanding and the
// ordinary targeted question is right. "Bought bacon" names a thing and a verb
// and is merely missing a price — the existing "how much was that?" is exactly
// the correct response to it, and this must never fire there.
export function understoodNothing(r: DescriptionResult): boolean {
    if (r.amount != null && r.amount > 0) return false;
    if (r.itemisation) return false;
    if (r.recipient) return false;
    if (r.date) return false;
    if (r.detectedCurrency) return false;
    if (r.purposeLabel) return false;
    // A message shaped like a transaction — a verb and something to spend on —
    // was understood in outline even if no field came out of it.
    if (r.hasTransactionShape) return false;
    // A bare number is not an amount without a cue word around it, but it is
    // unmistakably an attempt at one.
    if (r.hasNumber) return false;
    // A date they plainly attempted and we could not pin down is still a date
    // they mentioned; the date flow has its own question and its own retry cap.
    if (r.dateResult.reason != null && r.dateResult.reason !== DATE_REASON_UNREADABLE) return false;
    return true;
}

// ── The response, and the cap on it ──────────────────────────────────────────

export interface ZeroUnderstandingState {
    // Consecutive messages this flow made nothing of. Reset by any message it
    // did understand, so two failures either side of a good turn are not a
    // streak.
    consecutive: number;
}

export const NO_ZERO_UNDERSTANDING: ZeroUnderstandingState = { consecutive: 0 };

// What to say, if anything — named, not worded. The wordings live in the copy
// registry (zero.ask1, zero.ask2, zero.escape) with every other bot-facing
// sentence; this module owns the RULE, which is the part worth testing.
//
// 'ask'    — the honest fallback, worded differently the second time, because
//            hearing the identical sentence twice reads as a system that isn't
//            listening, which is precisely the impression to avoid here
// 'escape' — the cap is reached; offer a way out instead of asking again
// null     — the message was understood; nothing to say here
export type ZeroUnderstandingResponse =
    | { kind: 'ask'; copyId: 'zero.ask1' | 'zero.ask2' }
    | { kind: 'escape'; copyId: 'zero.escape'; optionValues: readonly string[] }
    | null;

const ASK_COPY = ['zero.ask1', 'zero.ask2'] as const;

// The ways out offered once asking has twice failed. Values only: their labels
// are registry entries (zero.option.*), read where the options are built.
export const ZERO_ESCAPE_VALUES = ['paste', 'skip', 'restart'] as const;

// Capped at two consecutive asks, matching advanceDateRetry's discipline: a
// question that has twice failed to get a usable answer will not get one on
// the third try either, and asking again in the same shape is just a loop with
// extra steps.
export const MAX_ZERO_UNDERSTANDING = 2;

export function advanceZeroUnderstanding(
    state: ZeroUnderstandingState,
    nothingUnderstood: boolean,
): { state: ZeroUnderstandingState; response: ZeroUnderstandingResponse } {
    if (!nothingUnderstood) return { state: NO_ZERO_UNDERSTANDING, response: null };

    const consecutive = state.consecutive + 1;
    const next = { consecutive };

    if (consecutive > MAX_ZERO_UNDERSTANDING) {
        return {
            state: next,
            response: { kind: 'escape', copyId: 'zero.escape', optionValues: ZERO_ESCAPE_VALUES },
        };
    }

    return { state: next, response: { kind: 'ask', copyId: ASK_COPY[consecutive - 1] } };
}
