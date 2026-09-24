import type { LineItem } from '../types';
import { isCorrectionMessage } from './metaIntent';
import {
    absorbAnswer, extractDescription, lockCurrency, parseAmountReply, parseConversationalDate,
    UNSTATED_CURRENCY,
    type CurrencyLock, type DescriptionResult, type DirectionResult,
    type ConversationalDateResult,
} from './conversationalCapture';
import type { CaptureSlot } from './conversationalCapture';
import { fmtAmountProse } from './transactionDisplay';

// How an answer becomes part of the capture draft.
//
// This used to live inline in ChatScreen's pending-prompt handlers, and the
// slot-filling tests carried their own hand-written copy of it. The two
// diverged: the test spread absorbAnswer's result BEFORE the field the answer
// was actually about, production spread it AFTER, and so production discarded
// every accepted date for weeks while thirty tests reported green against a
// model that had never had the bug.
//
// So there is one implementation now, here, and both the handlers and the
// tests call it. The same de-duplication already applied to openSlots and
// buildConfirmSentence, for the same reason: a second copy of a rule is a
// second chance to get it wrong, and the copy in the test file is the one that
// will never be the one that ships.

export interface CaptureDraft {
    amount: number | null;
    // The itemisation, when the user gave one. Its total IS `amount`, so the
    // amount slot counts as filled and is never asked about again.
    lineItems: LineItem[] | null;
    // The currency for this transaction and whether the user actually said it.
    // Locked by the first explicit mention anywhere in the conversation and
    // then left alone; a later message that names no currency is the user
    // continuing in the one they already gave, not a switch back to KES.
    currency: CurrencyLock;
    recipient: string | null;
    date: Date | null;
    dateAmbiguous: boolean;
    purposeLabel: string | null;
    // The parser's plain-English reading of the date ("13 March 2026"), echoed
    // back in the confirmation sentence so a date is never silently accepted.
    dateInterpretation: string | null;
    // Set once the user has been offered, and taken, "leave the date off" after
    // repeated unreadable answers. Stops the date question being asked again.
    dateSkipped: boolean;
    // Resolved from what the user typed (extractDescription). Starts unresolved
    // so a capture that never carried a directional word gets asked, not guessed.
    direction: DirectionResult;
}

export const UNRESOLVED_DIRECTION: DirectionResult = { type: 'sent', confidence: 30, source: 'unresolved' };

export function emptyCaptureDraft(): CaptureDraft {
    return {
        amount: null, lineItems: null, currency: UNSTATED_CURRENCY, recipient: null,
        date: null, dateAmbiguous: false, purposeLabel: null, dateInterpretation: null,
        dateSkipped: false, direction: UNRESOLVED_DIRECTION,
    };
}

// ── Folding in a free-text description ───────────────────────────────────────

export interface ComposedDescription {
    draft: CaptureDraft;
    // The raw extraction, which the caller still needs for the date-clarity
    // branches it has to narrate.
    extraction: DescriptionResult;
}

// The opening message, or any later free-text one. Everything the message
// carries is folded in; nothing already established is overwritten by silence.
export function composeDescription(
    draft: CaptureDraft, text: string, now: Date = new Date(),
): ComposedDescription {
    const r = extractDescription(text, now);
    return {
        extraction: r,
        draft: {
            ...draft,
            amount: r.amount ?? draft.amount,
            // An itemised message fills the amount slot with its total and the
            // description slot with the items, so neither is asked about again.
            lineItems: r.itemisation?.items ?? (r.soleLineItem ? [r.soleLineItem] : null) ?? draft.lineItems,
            // Folded, never replaced: the first stated currency holds for the
            // whole transaction, and a silent message does not reset it.
            currency: lockCurrency(draft.currency, text),
            recipient: r.recipient ?? draft.recipient,
            date: r.date ?? draft.date,
            dateAmbiguous: r.dateAmbiguous,
            dateInterpretation: r.date
                ? (r.dateResult.interpretation ?? draft.dateInterpretation)
                : draft.dateInterpretation,
            purposeLabel: r.purposeLabel ?? draft.purposeLabel,
            // Keep a direction we resolved on an earlier turn if this one is silent.
            direction: r.direction.source !== 'unresolved' ? r.direction : draft.direction,
        },
    };
}

// ── Folding in an answer to one specific question ────────────────────────────

export interface ComposedAnswer {
    // The draft after folding the answer in. When `accepted` is false this is
    // the draft with only what could be salvaged — the currency lock, which a
    // rejected answer may still have named — never a half-applied field.
    draft: CaptureDraft;
    // Whether the answer settled the slot it was asked about. False means the
    // caller must ask again; the slot is untouched.
    accepted: boolean;
    // Only for the date slot: the parser's full verdict, which the caller needs
    // for its retry policy and for the clarification question to put back.
    dateResult: ConversationalDateResult | null;
}

// THE ORDER HERE IS LOAD-BEARING.
//
// absorbAnswer is spread FIRST and the answered field set AFTER it. absorbAnswer
// takes the whole draft and returns the slots an answer happened to fill on top
// of what was already there — so spreading it last would write the pre-answer
// value of the very field this answer was about straight back over the new one.
// That is not hypothetical: it is the exact bug that made the bot re-ask "when
// was that?" after every valid date. composeDraftAnswerOrderRegression in the
// tests exists to fail if this is ever flipped back.
export function composeDraftAnswer(
    draft: CaptureDraft, slot: CaptureSlot, answer: string, now: Date = new Date(),
    // The slot asked alongside this one, when the question was batched. A bare
    // figure counts as the amount when "how much?" was part of what was asked,
    // for the same reason it does when that was the whole question: the
    // question supplied the context free text lacks.
    alsoAsked: CaptureSlot | null = null,
): ComposedAnswer {
    const absorbed = absorbAnswer(draft, answer);
    if (alsoAsked === 'amount' && (absorbed.amount == null || absorbed.amount <= 0)) {
        const offered = parseAmountReply(answer).amount;
        if (offered != null && offered > 0) absorbed.amount = offered;
    }

    if (slot === 'date') {
        const dateResult = parseConversationalDate(answer, now);
        const accepted = dateResult.confidence === 'exact' && dateResult.date != null;
        if (!accepted) {
            // Nothing about the date changes, but a currency the answer named
            // is still worth keeping.
            return { draft: { ...draft, currency: absorbed.currency }, accepted: false, dateResult };
        }
        return {
            accepted: true,
            dateResult,
            draft: {
                ...draft,
                // An answer may say more than was asked; anything it carries
                // for a still-empty slot is kept.
                ...absorbed,
                date: dateResult.date,
                dateAmbiguous: false,
                dateInterpretation: dateResult.interpretation,
                dateSkipped: false,
            },
        };
    }

    if (slot === 'amount') {
        // "100k USD" is 100,000 US Dollars. Reading it as 100 Shillings is the
        // bug this whole path was rebuilt around.
        const reply = parseAmountReply(answer);
        if (reply.amount == null && absorbed.amount == null) {
            return { draft: { ...draft, currency: absorbed.currency }, accepted: false, dateResult: null };
        }
        return {
            accepted: true,
            dateResult: null,
            draft: {
                ...draft,
                ...absorbed,
                // A bare figure in reply to "how much" is the amount, even when
                // no currency sat next to it — the question supplied the
                // context that the extractors require in free text.
                amount: absorbed.lineItems?.length ? absorbed.amount : (reply.amount ?? absorbed.amount),
            },
        };
    }

    // description — the typed answer IS the description, whatever else it carries.
    const recipient = answer.trim();
    if (!recipient) {
        return { draft: { ...draft, currency: absorbed.currency }, accepted: false, dateResult: null };
    }
    return {
        accepted: true,
        dateResult: null,
        draft: { ...draft, ...absorbed, recipient },
    };
}

// Taking the "leave the date off" offer after repeated unreadable answers.
// Distinct from a rejected answer: this one deliberately closes the slot.
export function skipDate(draft: CaptureDraft): CaptureDraft {
    return { ...draft, date: null, dateAmbiguous: false, dateInterpretation: null, dateSkipped: true };
}

// ── What is actually captured so far ─────────────────────────────────────────

// A short plain-words account of the draft, or null when it holds nothing.
//
// Used where the flow has to tell the user what is at stake — chiefly the
// cancel confirmation, which must not offer to discard "everything" without
// naming what everything is.
export function capturedSummary(draft: CaptureDraft): string | null {
    const money = (n: number) => fmtAmountProse(n, draft.currency.code);

    if (draft.lineItems && draft.lineItems.length > 0) {
        const named = draft.lineItems.map(i => `${i.description} (${money(i.amount)})`);
        return named.length > 2 ? `${named.slice(0, 2).join(', ')} and ${named.length - 2} more` : named.join(' and ');
    }
    const parts: string[] = [];
    if (draft.amount != null && draft.amount > 0) parts.push(money(draft.amount));
    if (draft.recipient) parts.push(draft.recipient);
    if (parts.length === 0 && draft.date) parts.push('a date');
    return parts.length > 0 ? parts.join(', ') : null;
}

// ── One more thing, said after everything else ───────────────────────────────

// The phrasings that introduce an ADDITION rather than a change.
//
// Deliberately narrow. At the confirmation, anything that is not "yes" is read
// as "no, start again" — which is right for a rejection and catastrophic for
// "oh and airtime for 30": the whole itemisation was cleared and the questions
// began again from the date. But widening that branch to fold in anything
// carrying a figure would be worse still, because "no it was 500" carries one
// too, and adding it would produce a total the user never said.
//
// So an addition has to announce itself, and must not be a correction.
const ADDITION_RE =
    /^\s*(?:oh\s+)?(?:and|also|plus)\b|^\s*(?:oh\s+)?(?:i\s+)?(?:also\s+)?(?:forgot|missed)\b|^\s*(?:i|we)\s+also\b|\balso\s+(?:bought|paid|got|spent)\b/i;

// Folds "one more thing" into a draft that is otherwise complete.
//
// Returns null when the message is not an addition, or carries nothing to add
// — in which case the caller keeps its existing behaviour. Never used as a
// fallback for "I didn't understand that": a message has to look like an
// addition AND yield a priced thing.
export function foldAddition(
    draft: CaptureDraft, text: string, now: Date = new Date(),
): CaptureDraft | null {
    if (!ADDITION_RE.test(text) || isCorrectionMessage(text)) return null;

    // The cue is not part of what was bought: without stripping it the line
    // read "Oh, airtime".
    const body = text
        .replace(/^\s*(?:oh\s+)?(?:and|also|plus)\b[,\s]*/i, '')
        .replace(/^\s*(?:oh\s+)?(?:i\s+)?(?:also\s+)?(?:forgot|missed)\b[,\s:]*(?:about\s+)?/i, '')
        .replace(/^\s*(?:i|we)\s+also\b\s*/i, '');
    const r = extractDescription(body || text, now);
    if (r.mixedCurrencies) return null;
    const added: LineItem[] = r.itemisation?.items ?? (r.soleLineItem ? [r.soleLineItem] : []);
    // A message with a figure but no nameable goods still adds a line, using
    // whatever it did say — losing it is the failure being fixed here.
    if (added.length === 0) {
        if (r.amount == null || r.amount <= 0) return null;
        added.push({ description: r.recipient ?? 'Other', quantity: null, unitPrice: null, amount: r.amount });
    }

    // Whatever was already captured becomes the first line, so the total is a
    // sum of stated figures and never a figure standing next to them.
    const existing: LineItem[] = draft.lineItems && draft.lineItems.length > 0
        ? draft.lineItems
        : draft.amount != null && draft.amount > 0
            ? [{ description: draft.recipient ?? 'Unknown', quantity: null, unitPrice: null, amount: draft.amount }]
            : [];
    if (existing.length === 0) return null;

    const lineItems = [...existing, ...added];
    return {
        ...draft,
        lineItems,
        amount: Math.round(lineItems.reduce((s, i) => s + i.amount, 0) * 100) / 100,
        recipient: lineItems.map(i => i.description).join(', '),
        currency: lockCurrency(draft.currency, text),
    };
}
