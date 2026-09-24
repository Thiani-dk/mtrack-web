import type { DescriptionResult } from './conversationalCapture';

// What KIND of message this is, decided before anything tries to pull fields
// out of it.
//
// The capture flow's standing assumption has been that whatever the user types
// is an answer to the question just asked. Most of the time it is. When it
// isn't — "actually make that 3500", "never mind", "wait, what currencies do
// you support?" — a slot-filling-first design reads the correction as a new
// amount, the cancel as a description, and the question as an answer, and it
// cannot recover, because by the time extraction has failed the message has
// already been filed as something.
//
// So classification runs against the WHOLE message, every time, regardless of
// what the flow was waiting for. This module is that pass. It decides nothing
// about state; it reports what it sees, and the caller routes on it.

export type MetaIntent =
    | 'cancel'
    | 'correction'
    | 'meta_question'
    | 'multi_intent'
    | 'data'
    | 'unclear';

// Priority order, highest first. Higher categories win ties on purpose: acting
// on a cancel or a correction wrongly costs the user real work, while asking
// one clarifying question costs a turn.

// ── 1. Cancel ────────────────────────────────────────────────────────────────

// Matched against the WHOLE message, near-exactly, and never as a substring.
// "I'll never mind the change" contains "never mind" and is not a cancel; a
// flow that scrapped a half-built document over that would be unforgivable.
const CANCEL_RE =
    /^(?:never\s*mind|nevermind|forget\s+it|forget\s+this|cancel(?:\s+(?:this|that|it))?|stop(?:\s+(?:this|it))?|start\s+over|scrap\s+(?:this|it|that)|quit|abort)[.!]?$/i;

// A cheap whole-message cancel test, for callers that want to route on it
// before paying for a full extraction. Same rule as the classifier's.
export function isCancelMessage(text: string): boolean {
    const t = text.trim();
    return CANCEL_RE.test(t) || /^actually,?\s+(?:cancel|forget|scrap|never\s*mind|stop)\b/i.test(t);
}

// ── 2. Correction ────────────────────────────────────────────────────────────

// Markers anywhere in the message. "actually" is the workhorse; the rest cover
// the phrasings people reach for when they have just realised they misspoke.
const CORRECTION_RE =
    /\bactually\b|\bno\s+wait\b|\bi\s+meant\b|\bi\s+ment\b|\bsorry,?\s+(?:it\s+was|that\s+was|i\s+meant)\b|\bscratch\s+that\b|\bmake\s+(?:that|it)\b|\bnot\s+\d[\d,.]*\s*,?\s*(?:but\s+)?\d/i;

// A cheap whole-message correction test, for callers routing before extraction.
// Cancel wins over it, so "actually cancel this" is not read as a field edit.
export function isCorrectionMessage(text: string): boolean {
    return !isCancelMessage(text) && CORRECTION_RE.test(text.trim());
}

// ── 2b. Agreement ────────────────────────────────────────────────────────────

// "Yes" to the confirmation, however it is said.
//
// Every word needs its own word boundary. Without one, "yes" matched the start
// of "yesterday" — so a user answering the confirmation with a date approved
// the draft instead of correcting it, and a wrong record was saved on a tap
// they never made.
//
// Lives here rather than inline in the handler because the handler is a
// component: a rule this consequential has to be testable without rendering a
// chat, and a copy of it in a test file is the copy that will never ship.
const AFFIRMATIVE_RE =
    /^(?:(?:y|yes|yep|yeah|yup|correct|right|ok|okay|sure|fine|that'?s? right|go ahead)\b|👍)/i;

export function isAffirmative(text: string): boolean {
    return AFFIRMATIVE_RE.test(text.trim());
}

// ── 3. Meta-question ─────────────────────────────────────────────────────────

// A question ABOUT the system rather than data for it. Requires a question
// shape AND no transaction-shaped content, so "did I say 3100? actually it was
// 3500" is never mistaken for one.
const META_QUESTION_RE =
    /\bhow\s+do\s+i\b|\bhow\s+can\s+i\b|\bwhat\s+(?:currencies|currency|else|can\s+you|do\s+you)\b|\bcan\s+you\b|\bdo\s+you\s+(?:support|handle|do|take)\b|\bwhat\s+is\s+this\b|\bhow\s+does\s+(?:this|it)\s+work\b|\bwhere\s+(?:do|is|are)\b/i;

// ── 4. Multi-intent ──────────────────────────────────────────────────────────

// A discourse boundary separating two independently-meaningful clauses.
// Deliberately NOT a bare "and": "bacon and pork cuts for 3100" is one item
// list, and splitting on it would undo the line-item extractor's work.
export const DISCOURSE_BOUNDARY_RE = /\b(?:and\s+also|oh\s+and|also,|by\s+the\s+way|btw)\b|,\s*also\b/i;

// The clauses a multi-intent message divides into, in order.
export function splitDiscourse(text: string): string[] {
    return text.split(DISCOURSE_BOUNDARY_RE).map(s => s.trim()).filter(Boolean);
}

// ── The classifier ───────────────────────────────────────────────────────────

export interface MetaIntentInput {
    text: string;
    // This message's own extraction, for the DATA / UNCLEAR split and for the
    // "is there transaction content here?" test the meta-question gate needs.
    // The caller already has it; recomputing it here would be a second, subtly
    // different reading of the same message.
    extraction: DescriptionResult;
    // Whether extraction came back completely empty. Passed in rather than
    // recomputed so there is exactly one definition of it (zeroUnderstanding).
    nothingExtracted: boolean;
}

export function classifyIntent({ text, extraction, nothingExtracted }: MetaIntentInput): MetaIntent {
    const t = text.trim();

    // 1. Cancel. Includes the one shape that would otherwise be read as a
    //    correction — "actually cancel this, I don't want to log it" is a
    //    cancel, and applying it to a field instead would be a bad miss.
    if (isCancelMessage(t)) return 'cancel';

    // 2. Correction.
    if (CORRECTION_RE.test(t)) return 'correction';

    // 3. Meta-question: question-shaped, and carrying no transaction content
    //    of its own. A message that asks something AND states a purchase is a
    //    multi-intent message, caught next.
    //
    //    "Transaction content" here means an amount, an itemisation or a
    //    transaction verb — NOT merely any extracted field. "Can you handle
    //    USD?" mentions a currency and is still a question about the system,
    //    and answering it with "how much was it?" would be absurd.
    const hasTransactionContent = (extraction.amount != null && extraction.amount > 0)
        || extraction.itemisation != null
        || extraction.hasTransactionShape;
    // An explicit "how do I" / "can you" beats a stray field; a bare trailing
    // "?" is weaker evidence and only counts when nothing was extracted at all.
    const questionShaped = META_QUESTION_RE.test(t) ? !hasTransactionContent : t.endsWith('?') && nothingExtracted;
    if (questionShaped) return 'meta_question';

    // 4. Multi-intent: a discourse boundary with something real on both sides.
    if (DISCOURSE_BOUNDARY_RE.test(t) && splitDiscourse(t).length > 1) return 'multi_intent';

    // 5/6. Data, or nothing at all.
    return nothingExtracted && !extraction.hasTransactionShape ? 'unclear' : 'data';
}

// ── Cancel, once detected ────────────────────────────────────────────────────

// What a cancel should actually do depends on how much work is at stake.
//
// Said with nothing captured, it means "I don't want to do this" and a
// confirmation would be a pointless extra tap. Said mid-flow it is genuinely
// ambiguous between that and "I'm done adding things, stop asking" — and
// guessing wrong either loses work or refuses to stop. So: ask, but only when
// there is something real to lose.
export interface CancelDecision {
    kind: 'immediate' | 'confirm';
    text: string;
    options?: Array<{ id: string; label: string; value: string }>;
}

export function decideCancel(captured: { summary: string | null }): CancelDecision {
    if (!captured.summary) {
        return { kind: 'immediate', text: 'No worries, scrapped. Say the word when you want to start one.' };
    }
    return {
        kind: 'confirm',
        text: `You've got ${captured.summary} down already — scrap the whole thing, or stop here and keep it?`,
        options: [
            { id: 'cancel-discard', label: 'Discard everything', value: 'discard' },
            { id: 'cancel-keep', label: 'Keep what I have', value: 'keep' },
        ],
    };
}

// ── Routing a multi-intent message ───────────────────────────────────────────

export interface Segment {
    text: string;
    intent: MetaIntent;
}

// The clauses of a multi-intent message, each classified on its own.
//
// Order of PROCESSING is not order of appearance: the data clause advances the
// actual task and is handled first, whichever half it sat in, and the question
// is answered after — in one combined reply rather than two bot turns, because
// two turns for one message reads as a system that lost its place.
export function segmentMultiIntent(
    text: string,
    classifySegment: (clause: string) => MetaIntent,
): { data: Segment[]; questions: Segment[] } {
    const data: Segment[] = [];
    const questions: Segment[] = [];

    for (const clause of splitDiscourse(text)) {
        const intent = classifySegment(clause);
        if (intent === 'meta_question') questions.push({ text: clause, intent });
        else if (intent === 'data' || intent === 'correction') data.push({ text: clause, intent });
        // An 'unclear' clause beside a clause that IS clear is not worth a
        // fallback of its own — the user said something usable and that is
        // what to act on.
    }
    return { data, questions };
}
