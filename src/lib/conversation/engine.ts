import type { ChatOption, DocumentType } from '../../types';
import {
    buildConfirmSentence, buildSelfReportedTransaction, composeSlotQuestion, extractDescription,
    mixedCurrencyQuestion, openSlots, type CaptureSlot,
} from '../conversationalCapture';
import {
    capturedSummary, composeDescription, composeDraftAnswer, emptyCaptureDraft, foldAddition,
    skipDate, type CaptureDraft,
} from '../captureDraft';
import { advanceDateRetry, DATE_REASON_UNREADABLE } from '../parsers/conversationalDate';
import { advanceZeroUnderstanding, understoodNothing, ZERO_ESCAPE_VALUES } from '../zeroUnderstanding';
import {
    CANCEL_CONFIRM_VALUES, classifyIntent, decideCancel, isAffirmative, isCancelMessage,
    isCorrectionMessage, segmentMultiIntent,
} from '../metaIntent';
import { answerOrAdmitCopyId } from '../metaAnswers';
import { partyCopyId, partyFollowOnCopyId, partyQuestion } from '../partyQuestion';
import { applyNamedCorrection, resolveCorrection } from '../correction';
import { parseAllMessages } from '../parsers';
import { fmtProseCurrency, UNDATED } from '../transactionDisplay';
import type { CopyId } from './copy';
import { TurnBuilder } from './turns';
import type { ConvState, Effect, PendingPrompt, TurnContext, TurnResult } from './types';

// The conversation, as a function.
//
// Everything below used to live inside ChatScreen.tsx as React callbacks
// closing over addMessage / setDocFlow, which meant the only way to exercise
// it was to render a chat — so nothing did, and the tests that existed modelled
// the flow by hand instead. That is the mistake this project has already made
// once, with the slot-filling suite, and it is why a hand-written model is
// banned here: `receive` is what ships, and it is what the scenario harness
// drives.
//
// The component is now an adapter. It owns the message list, IndexedDB and the
// SMS pipeline; this module owns what the bot says and what it waits for next.

// Two unreadable answers is enough. A missing date beats a wrong one, and a
// question that repeats forever is worse than either.
const MAX_DATE_ATTEMPTS = 2;

// A parsed-transaction count at or below this counts as "small".
export const MODE_VALUES = ['own', 'point_of_sale', 'on_behalf_of'] as const;

export function emptyConvState(documentType: DocumentType = 'expense_summary'): ConvState {
    return {
        documentType,
        merchantProfile: null,
        onBehalfOf: null,
        pending: 'mode',
        draft: emptyCaptureDraft(),
        describedCount: 0,
        nudgeShown: false,
        dateAttempts: 0,
        lastDateAnswer: null,
        pendingCorrectionAmount: null,
        batchedSlot: null,
        zeroAttempts: 0,
        purposeQueue: [],
        variantCursor: {},
        lastCopyId: null,
    };
}

// ── Options, built from registry labels ─────────────────────────────────────

function modeOptions(): ChatOption[] {
    return [
        TurnBuilder.option('open.mode.own', 'own', 'open.mode.own.sub'),
        TurnBuilder.option('open.mode.pos', 'point_of_sale', 'open.mode.pos.sub'),
        TurnBuilder.option('open.mode.obo', 'on_behalf_of', 'open.mode.obo.sub'),
    ];
}

const CANCEL_OPTION_COPY: Record<string, CopyId> = {
    discard: 'cancel.option.discard',
    keep: 'cancel.option.keep',
};
const ZERO_OPTION_COPY: Record<string, CopyId> = {
    paste: 'zero.option.paste',
    skip: 'zero.option.skip',
    restart: 'zero.option.restart',
};

function optionsFrom(values: readonly string[], table: Record<string, CopyId>): ChatOption[] {
    return values.map(v => TurnBuilder.option(table[v], v));
}

// ── The opening ─────────────────────────────────────────────────────────────

export function openConversation(): TurnResult {
    const state = emptyConvState();
    const b = new TurnBuilder(state.variantCursor);
    b.say('open.greeting');
    b.say('open.modeQuestion', {}, { options: modeOptions() });
    return { state: b.settle(state), turns: b.turns, effects: b.effects };
}

// ── Asking for what is still missing ────────────────────────────────────────

const SLOT_COPY: Record<CaptureSlot, CopyId> = {
    date: 'ask.date',
    amount: 'ask.amount',
    description: 'ask.date', // replaced per document type below
};

function slotCopyId(slot: CaptureSlot, documentType: DocumentType): CopyId {
    return slot === 'description' ? partyCopyId(documentType) : SLOT_COPY[slot];
}

function followCopyId(slot: CaptureSlot, documentType: DocumentType): CopyId {
    if (slot === 'description') return partyFollowOnCopyId(documentType);
    return slot === 'date' ? 'follow.date' : 'follow.amount';
}

// Emits the question for the first slot still genuinely empty (openSlots), and
// reports which prompt we are now waiting on. Nothing open means ready to
// confirm. Asking for something the user already said is what made this flow
// feel like it wasn't listening — and at worst invited a second, vaguer answer
// that overwrote a good one.
//
// Two open slots are asked together: they are independent, so nothing is lost
// by it, and a user who volunteered everything but two fields should not make
// two round trips for them. The answer is filed against the first; absorbAnswer
// picks up the second if it was given, and it is asked again on its own if not.
function askNextField(
    b: TurnBuilder, draft: CaptureDraft, documentType: DocumentType, instance: number,
): { pending: PendingPrompt; batchedSlot: CaptureSlot | null } {
    const question = composeSlotQuestion(openSlots(draft), {
        date: '', amount: '', description: '',
    }, documentType);
    if (!question) return { pending: 'confirm', batchedSlot: null };

    const primary = question.slot === 'description'
        ? partyCopyIdForInstance(documentType, instance)
        : slotCopyId(question.slot, documentType);
    b.say(primary, {}, question.alsoAsked
        ? { suffixCopyId: followCopyId(question.alsoAsked, documentType) }
        : {});

    const pending: PendingPrompt =
        question.slot === 'date' ? 'field-date'
            : question.slot === 'amount' ? 'field-amount' : 'field-recipient';
    return { pending, batchedSlot: question.alsoAsked };
}

// The party question rotates by how many lines have been described, not by the
// variant cursor: an interrupted question has to come back word for word, and
// a question that returned differently worded reads as a second question.
function partyCopyIdForInstance(documentType: DocumentType, instance: number): CopyId {
    void instance;
    return partyCopyId(documentType);
}

function confirmSentence(draft: CaptureDraft): string {
    return buildConfirmSentence({
        amount: draft.amount,
        currency: draft.currency,
        recipient: draft.recipient,
        direction: draft.direction,
        purposeLabel: draft.purposeLabel,
        dateLabel: draft.date ? (draft.dateInterpretation ?? fmtShortDate(draft.date)) : null,
        dateSkipped: draft.dateSkipped,
        lineItems: draft.lineItems,
    });
}

function fmtShortDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function advanceAfterField(b: TurnBuilder, state: ConvState, draft: CaptureDraft): ConvState {
    const next = askNextField(b, draft, state.documentType, state.describedCount);
    if (next.pending === 'confirm') b.say('confirm.summary', { sentence: confirmSentence(draft) });
    return { ...state, draft, pending: next.pending, batchedSlot: next.batchedSlot };
}

// The question currently on the table, so an interruption can be answered and
// the thread picked back up exactly where it was.
function parkedQuestion(state: ConvState): { copyId: CopyId; text: string } {
    switch (state.pending) {
        case 'field-date': return { copyId: 'ask.date', text: variant('ask.date') };
        case 'field-amount': return { copyId: 'ask.amount', text: variant('ask.amount') };
        case 'field-recipient':
            return {
                copyId: partyCopyId(state.documentType),
                text: partyQuestion(state.documentType, state.describedCount),
            };
        case 'business-name': return { copyId: 'mode.posName', text: variant('mode.posName') };
        case 'party-name': return { copyId: 'mode.oboParty', text: variant('mode.oboParty') };
        case 'purpose': return { copyId: 'mode.oboPurpose', text: variant('mode.oboPurpose') };
        case 'confirm':
            return { copyId: 'confirm.summary', text: confirmSentence(state.draft) };
        default:
            return { copyId: 'mode.ownPrompt', text: variant('mode.ownPrompt') };
    }
}

// The first variant of an entry, for the places that need the words without
// advancing a cursor (a resumed question must come back identical).
function variant(id: CopyId): string {
    return new TurnBuilder({}).text(id);
}

// "Anyway — how much was it?" reads as one sentence; "Anyway — How much..."
// reads as two glued together. A prompt that starts with a proper noun or an
// acronym is left alone.
function lowerFirst(text: string): string {
    const [first] = text.split(' ');
    if (!first || first.slice(1) !== first.slice(1).toLowerCase()) return text;
    return text.charAt(0).toLowerCase() + text.slice(1);
}

// ── Choosing a mode ─────────────────────────────────────────────────────────

export function chooseMode(state: ConvState, value: string): TurnResult {
    const b = new TurnBuilder(state.variantCursor);
    const base: ConvState = {
        ...emptyConvState(),
        variantCursor: state.variantCursor,
        lastCopyId: state.lastCopyId,
    };
    if (value === 'own') {
        b.say('mode.ownPrompt');
        const next = { ...base, documentType: 'expense_summary' as DocumentType, pending: 'input' as PendingPrompt };
        return { state: b.settle(next), turns: b.turns, effects: b.effects };
    }
    if (value === 'point_of_sale') {
        b.say('mode.posName');
        const next = { ...base, documentType: 'point_of_sale' as DocumentType, pending: 'business-name' as PendingPrompt };
        return { state: b.settle(next), turns: b.turns, effects: b.effects };
    }
    b.say('mode.oboParty');
    const next = { ...base, documentType: 'on_behalf_of' as DocumentType, pending: 'party-name' as PendingPrompt };
    return { state: b.settle(next), turns: b.turns, effects: b.effects };
}

// ── One user message ────────────────────────────────────────────────────────

export function receive(state: ConvState | null, text: string, ctx: TurnContext): TurnResult {
    if (!text.trim()) return { state, turns: [], effects: [] };
    if (!state) return { state, turns: [], effects: [{ kind: 'parse-batch', text }] };

    const b = new TurnBuilder(state.variantCursor);
    const outcome = handleFlow(b, state, text, ctx);
    if (outcome !== 'not-consumed') {
        return { state: b.settle(outcome), turns: b.turns, effects: b.effects };
    }

    // The open 'input' state: a pasted batch of transaction messages, or a
    // typed description.
    if (parseAllMessages(text).transactions.length > 0) {
        b.effect({ kind: 'parse-batch', text });
        return { state: b.settle(state), turns: b.turns, effects: b.effects };
    }
    const described = handleDescription(b, state, text, ctx);
    return { state: b.settle(described), turns: b.turns, effects: b.effects };
}

// Handles a message while a specific prompt is pending. Returns the next state,
// or 'not-consumed' when we are in the open 'input' state and the caller must
// decide between a paste and a description.
type FlowOutcome = ConvState | null | 'not-consumed';

function handleFlow(b: TurnBuilder, state: ConvState, text: string, ctx: TurnContext): FlowOutcome {
    const t = text.trim();

    // Classification before slot-filling. Whatever the flow was waiting for,
    // "never mind" is not an answer to it — and a design that only discovers
    // that after trying to read it as one has already filed it as a date or a
    // description by then.
    if (state.pending !== 'mode' && state.pending !== 'cancel-confirm' && isCancelMessage(t)) {
        const decision = decideCancel({ summary: capturedSummary(state.draft) });
        if (decision.kind === 'immediate') {
            b.say('cancel.immediate');
            return null;
        }
        b.say('cancel.confirm', { summary: capturedSummary(state.draft) ?? '' }, {
            options: optionsFrom(CANCEL_CONFIRM_VALUES, CANCEL_OPTION_COPY),
        });
        return { ...state, pending: 'cancel-confirm' };
    }

    // A question ABOUT the app, asked in the middle of being asked something.
    // Answer it, then put the parked question back verbatim — the interruption
    // must not count as an answer to anything, so the pending state is
    // deliberately left exactly as it was. That IS the resume pointer: nothing
    // advanced, so nothing needs restoring.
    if (state.pending !== 'mode' && state.pending !== 'cancel-confirm'
        && state.pending !== 'correction-target' && state.pending !== 'zero-escape') {
        const e = extractDescription(t, ctx.now);
        const intent = classifyIntent({ text: t, extraction: e, nothingExtracted: understoodNothing(e) });
        if (intent === 'meta_question') {
            const parked = parkedQuestion(state);
            b.say('meta.answerAndResume', {
                answer: b.text(answerOrAdmitCopyId(t)),
                question: lowerFirst(parked.text),
            }, { resumedCopyId: parked.copyId });
            return state;
        }
    }

    // A correction, wherever it arrives. This has to run before the slot
    // switch for the same reason cancel does: at the confirmation step ANY
    // non-yes message used to wipe the whole draft and restart from the date,
    // so "actually it was 3500" threw away an amount, a date and an item list
    // that were all correct.
    if (state.pending !== 'mode' && state.pending !== 'cancel-confirm' && isCorrectionMessage(t)) {
        const outcome = resolveCorrection(state.draft, t, ctx.now);
        if (outcome.kind === 'applied') {
            // Every correction says what it changed. A silently-applied one is
            // the single case where editing the WRONG field leaves the user no
            // way to notice.
            b.say('correction.applied', { echo: outcome.echo });
            return advanceAfterField(b, { ...state, pending: 'input' }, outcome.draft);
        }
        if (outcome.kind === 'ambiguous') {
            b.say('correction.ambiguous', { question: outcome.text }, { options: outcome.options });
            return { ...state, pending: 'correction-target', pendingCorrectionAmount: outcome.amount };
        }
        b.say(outcome.copyId);
        return state;
    }

    switch (state.pending) {
        // Which of several items the correction meant. The answer carries the
        // item's own description, so it resolves through the same reference
        // matching rather than a second positional mechanism.
        case 'correction-target': {
            const named = t.replace(/^correction-target:/, '');
            const pendingAmount = state.pendingCorrectionAmount;
            const outcome = pendingAmount != null
                ? applyNamedCorrection(state.draft, named, pendingAmount)
                : resolveCorrection(state.draft, named, ctx.now);
            if (outcome.kind === 'applied') {
                b.say('correction.applied', { echo: outcome.echo });
                return advanceAfterField(
                    b, { ...state, pending: 'input', pendingCorrectionAmount: null }, outcome.draft,
                );
            }
            b.say('correction.tapOne');
            return state;
        }
        // "Cancel" said with real progress behind it is genuinely ambiguous
        // between "scrap this" and "stop asking, I'm done", so it is asked
        // rather than guessed. See decideCancel.
        case 'cancel-confirm': {
            if (/^discard/i.test(t)) {
                b.say('cancel.discarded');
                return null;
            }
            if (/^keep/i.test(t)) {
                b.say('confirm.summary', { sentence: confirmSentence(state.draft) });
                return { ...state, pending: 'confirm' };
            }
            b.say('cancel.tapOne');
            return state;
        }
        case 'mode':
            b.say('open.tapOne');
            return state;
        // The way out offered after two failed "I didn't follow" turns. Three
        // options, all of which end the loop rather than asking in the same
        // shape a third time.
        case 'zero-escape': {
            if (/^paste/i.test(t)) {
                b.say('zero.pasteReady');
                return { ...state, pending: 'input', zeroAttempts: 0 };
            }
            if (/^skip/i.test(t)) {
                // Keep whatever the flow has and move on to the first slot that
                // is genuinely still open, one plain question at a time.
                return advanceAfterField(b, { ...state, zeroAttempts: 0 }, state.draft);
            }
            if (/^start over|^restart/i.test(t)) {
                b.say('zero.cleared');
                return { ...state, draft: emptyCaptureDraft(), pending: 'input', zeroAttempts: 0 };
            }
            b.say('zero.tapOne');
            return state;
        }
        case 'business-name':
            if (!t) { b.say('mode.posName'); return state; }
            b.say('mode.posItem');
            return {
                ...state,
                merchantProfile: { businessName: t, contact: null },
                pending: 'input',
            };
        case 'party-name':
            if (!t) { b.say('mode.oboParty'); return state; }
            b.say('mode.oboPurpose');
            return {
                ...state,
                onBehalfOf: { preparedBy: null, partyName: t, purpose: null },
                pending: 'purpose',
            };
        case 'purpose': {
            const skip = !t || /^(skip|none|n\/?a|no|nothing)$/i.test(t);
            b.say('mode.oboInput');
            return {
                ...state,
                onBehalfOf: state.onBehalfOf
                    ? { ...state.onBehalfOf, purpose: skip ? null : t }
                    : state.onBehalfOf,
                pending: 'input',
            };
        }
        case 'field-date': {
            const composed = composeDraftAnswer(state.draft, 'date', t, ctx.now, state.batchedSlot);
            const d = composed.dateResult!;
            if (composed.accepted) {
                // Accepted, but still echoed back inside the confirmation
                // sentence before anything is committed.
                return advanceAfterField(
                    b, { ...state, dateAttempts: 0, lastDateAnswer: null }, composed.draft,
                );
            }
            // Not settled. Ask the parser's own question — but the cap counts
            // consecutive answers that produced nothing usable, not replies. A
            // fresh date that merely needs disambiguating gets its own hearing
            // however many attempts came before it; the cap still guards
            // against a real loop of unreadable answers.
            const retry = advanceDateRetry(
                { attempts: state.dateAttempts, lastAnswer: state.lastDateAnswer },
                t, d, MAX_DATE_ATTEMPTS,
            );
            if (retry.giveUp) {
                b.say('date.giveUp');
                return advanceAfterField(
                    b, { ...state, dateAttempts: 0, lastDateAnswer: null }, skipDate(composed.draft),
                );
            }
            if (d.reason) b.say('date.retry', { reason: d.reason });
            else b.say('ask.date');
            return { ...state, dateAttempts: retry.state.attempts, lastDateAnswer: retry.state.lastAnswer };
        }
        case 'field-amount': {
            const composed = composeDraftAnswer(state.draft, 'amount', t, ctx.now, state.batchedSlot);
            if (!composed.accepted) {
                b.say('ask.amountRetry');
                return { ...state, draft: composed.draft };
            }
            return advanceAfterField(b, state, composed.draft);
        }
        case 'field-recipient': {
            const composed = composeDraftAnswer(state.draft, 'description', t, ctx.now, state.batchedSlot);
            if (!composed.accepted) {
                b.say(partyCopyId(state.documentType));
                return state;
            }
            return advanceAfterField(b, state, composed.draft);
        }
        case 'purpose-label': {
            const [code, ...restQueue] = state.purposeQueue;
            const skip = !t || /^(skip|none|n\/?a|no)$/i.test(t);
            let updated = ctx.transactions;
            if (!skip && code) {
                updated = ctx.transactions.map(tx =>
                    tx.transactionCode === code ? { ...tx, purposeLabel: t } : tx);
                b.effect({ kind: 'update-transactions', transactions: updated });
            }
            b.effect({ kind: 'sync-draft' });
            if (restQueue.length > 0) {
                askPurposeFor(b, restQueue[0], updated);
                return { ...state, purposeQueue: restQueue };
            }
            b.say('purpose.done');
            return { ...state, purposeQueue: [], pending: 'input' };
        }
        case 'confirm': {
            const added = foldAddition(state.draft, t, ctx.now);
            if (isAffirmative(t)) return commit(b, state, state.draft, ctx);
            if (added) {
                // "Oh and airtime for 30" is not a rejection. Anything that was
                // not "yes" used to clear the whole draft and start again from
                // the date, so one forgotten item cost the user everything they
                // had already typed.
                b.say('confirm.added', { sentence: confirmSentence(added) });
                return { ...state, draft: added };
            }
            b.say('confirm.reject', { question: b.text('ask.date') });
            return {
                ...state,
                draft: {
                    ...emptyCaptureDraft(),
                    currency: state.draft.currency,
                    purposeLabel: state.draft.purposeLabel,
                    direction: state.draft.direction,
                },
                pending: 'field-date',
            };
        }
        case 'input':
            return 'not-consumed';
    }
    return 'not-consumed';
}

function askPurposeFor(b: TurnBuilder, code: string, transactions: TurnContext['transactions']): void {
    const txn = transactions.find(tx => tx.transactionCode === code);
    if (!txn) return;
    b.say('purpose.ask', {
        amount: fmtProseCurrency(txn.amount, txn.currency),
        party: txn.merchant ?? txn.recipient,
    });
}

// ── Settling a described line ───────────────────────────────────────────────

function commit(b: TurnBuilder, state: ConvState, draft: CaptureDraft, ctx: TurnContext): ConvState {
    // Zero is a figure. Refusing it here meant that even once the flow accepted
    // "it was free", pressing yes at the confirmation silently did nothing at
    // all — the worse half of the same dead end.
    if (draft.amount == null || draft.amount < 0 || !draft.recipient) return state;
    if (!draft.date && !draft.dateSkipped) return state;

    const txn = buildSelfReportedTransaction({
        amount: draft.amount,
        currency: draft.currency.code,
        recipient: draft.recipient,
        // Deliberately undated when the user took the "leave it off" offer.
        date: draft.date ?? UNDATED(),
        dateAmbiguous: draft.dateAmbiguous,
        purposeLabel: draft.purposeLabel,
        direction: draft.direction,
        lineItems: draft.lineItems,
    });

    // A described transaction under "my own spending" is a personal note, not
    // an SMS-built expense summary.
    const resolvedType: DocumentType =
        state.documentType === 'expense_summary' ? 'personal_note' : state.documentType;

    b.effect({ kind: 'commit', transaction: txn });
    b.effect({ kind: 'sync-draft' });

    const next: ConvState = {
        ...state, documentType: resolvedType, draft: emptyCaptureDraft(), pending: 'input',
    };

    if (resolvedType === 'on_behalf_of' && !txn.purposeLabel) {
        askPurposeFor(b, txn.transactionCode, [...ctx.transactions, txn]);
        return { ...next, purposeQueue: [txn.transactionCode], pending: 'purpose-label' };
    }
    b.say(txn.directionUnresolved ? 'commit.addedDirection' : 'commit.added');
    return next;
}

// ── A free-text description ─────────────────────────────────────────────────

function handleDescription(b: TurnBuilder, state: ConvState, text: string, ctx: TurnContext): ConvState {
    // A message can carry two things at once — "bought bacon for 3100, also can
    // you tell me what currencies you support". The data clause advances the
    // actual task and is handled first, whichever half it sat in; the question
    // is answered in the SAME turn, because two bot turns for one message reads
    // as a system that lost its place.
    const intentOf = (clause: string) => {
        const e = extractDescription(clause, ctx.now);
        return classifyIntent({ text: clause, extraction: e, nothingExtracted: understoodNothing(e) });
    };
    const segments = segmentMultiIntent(text, intentOf);
    const questionIds = segments.questions.map(q => answerOrAdmitCopyId(q.text));

    // A message that is ONLY a question about the app. Answering it must not
    // cost the user their place, and it must never reach the zero-understanding
    // fallback — "I couldn't pick anything out of that" in reply to a perfectly
    // clear question would be nonsense.
    if (segments.data.length === 0 && questionIds.length > 0) {
        const parked = parkedQuestion(state);
        b.say('meta.answerAndResume', {
            answer: b.text(questionIds[0]),
            question: lowerFirst(parked.text),
        }, { resumedCopyId: parked.copyId });
        return state;
    }
    // Only the data half is folded into the draft; the question half would
    // otherwise be mined for an amount it never contained.
    const dataText = segments.data.length > 0 && questionIds.length > 0
        ? segments.data.map(d => d.text).join(', ')
        : text;

    const { draft, extraction: r } = composeDescription(state.draft, dataText, ctx.now);
    const describedCount = state.describedCount + 1;

    // Emitted after whatever the data half prompts, so the reply reads "here's
    // what I did with that — and to answer your question, ...".
    const answerQuestions = () => {
        for (const id of questionIds) b.say('meta.answerAfterData', { answer: b.text(id) });
    };

    // These branches put the date parser's OWN wording rather than going
    // through askNextField, which is why batching used to miss the most common
    // case of all — a first message with no readable date.
    const nextOpenAfterDate = (d: CaptureDraft): CaptureSlot | null =>
        openSlots({ ...d, date: null }).filter(slot => slot !== 'date')[0] ?? null;
    const followFor = (d: CaptureDraft) => {
        const second = nextOpenAfterDate(d);
        return second ? { suffixCopyId: followCopyId(second, state.documentType) } : {};
    };

    const fireNudge = (s: ConvState): ConvState => {
        if (describedCount >= 2 && !s.nudgeShown) {
            b.say('nudge.efficiency');
            return { ...s, nudgeShown: true };
        }
        return s;
    };

    // Nothing at all came out of that message. Say so, rather than falling
    // through to the next question in the sequence — "How much was it?" after
    // understanding none of a message implies the rest of it landed, and it
    // didn't. Checked against THIS message's extraction, not the accumulated
    // draft, and only when every field came back empty: a message that named a
    // thing without a price is partial understanding and keeps its ordinary
    // targeted question.
    const zero = advanceZeroUnderstanding({ consecutive: state.zeroAttempts }, understoodNothing(r));
    if (zero.response) {
        if (zero.response.kind === 'escape') {
            b.say(zero.response.copyId, {}, {
                options: optionsFrom(ZERO_ESCAPE_VALUES, ZERO_OPTION_COPY),
            });
            answerQuestions();
            return { ...state, draft, zeroAttempts: 0, pending: 'zero-escape', describedCount };
        }
        b.say(zero.response.copyId);
        answerQuestions();
        return {
            ...state, draft, zeroAttempts: zero.state.consecutive, pending: 'input', describedCount,
        };
    }

    // A date the parser refused outright (in the future, or older than the
    // 12-month window) is never carried into the draft — say why and ask again.
    if (!draft.date && !draft.dateSkipped && r.dateResult.confidence === 'invalid') {
        b.say('date.invalid', { reason: r.dateResult.reason ?? '' }, followFor(draft));
        const next = fireNudge({
            ...state, draft: { ...draft, date: null }, pending: 'field-date',
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft),
        });
        answerQuestions();
        return next;
    }

    // A real but two-way reading ("9/2/2026", "over the weekend") — put the
    // parser's own question, rather than picking a side. When the sentence
    // simply never mentioned a date, ask the plain question instead: "I
    // couldn't work out a date from that" would imply they'd tried.
    if (!draft.date && !draft.dateSkipped
        && r.dateResult.confidence === 'needs_clarification' && r.dateResult.reason) {
        const attempted = r.dateResult.reason !== DATE_REASON_UNREADABLE;
        if (attempted) b.say('date.retry', { reason: r.dateResult.reason }, followFor(draft));
        else b.say('ask.date', {}, followFor(draft));
        const next = fireNudge({
            ...state, draft: { ...draft, date: null }, pending: 'field-date',
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft),
        });
        answerQuestions();
        return next;
    }

    // A day/month flip on a reimbursement claim can sink the whole submission,
    // so escalate it before doing anything else.
    if (draft.date && draft.dateAmbiguous && state.documentType === 'on_behalf_of') {
        b.say('date.oboAmbiguous');
        const next = fireNudge({
            ...state, draft: { ...draft, date: null }, pending: 'field-date',
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft),
        });
        answerQuestions();
        return next;
    }

    // Two currencies in one message. The amount is deliberately left open —
    // there is no honest total without a rate — so say which two rather than
    // putting a bare "How much was it?" to someone who just gave two perfectly
    // clear figures.
    if (r.mixedCurrencies && (draft.amount == null || draft.amount <= 0)) {
        b.say('confirm.mixedCurrency', { question: mixedCurrencyQuestion(r.mixedCurrencies) });
        const next = fireNudge({
            ...state, draft, pending: 'field-amount', describedCount, zeroAttempts: 0,
            batchedSlot: null,
        });
        answerQuestions();
        return next;
    }

    // One path, driven by what is actually still missing: everything the
    // message filled stays filled, and only a genuinely empty slot earns a
    // question.
    const asked = askNextField(b, draft, state.documentType, describedCount);
    if (asked.pending === 'confirm') b.say('confirm.summary', { sentence: confirmSentence(draft) });
    const next = fireNudge({
        ...state, draft, pending: asked.pending, describedCount, zeroAttempts: 0,
        batchedSlot: asked.batchedSlot,
    });
    answerQuestions();
    return next;
}

export type { Effect, TurnResult };
