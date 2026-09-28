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
    isCorrectionMessage, isHolding, isNegative, rejectionRemainder, segmentMultiIntent,
} from '../metaIntent';
import { answerOrAdmitCopyId } from '../metaAnswers';
import { partyCopyId, partyFollowOnCopyId, partyQuestion } from '../partyQuestion';
import { applyNamedCorrection, resolveCorrection, resolveRemoval } from '../correction';
import { parseAllMessages } from '../parsers';
import { readAmountPhrase, type AmountChoice } from './amountPhrases';
import { asksWhatOptionsMean, isGreeting, modeValue, readModeChoice } from './openingIntent';
import { asksForExample, readRequest, saysDontKnow } from './requestIntent';
import {
    asksToBeAsked, enrichmentQueue, isGenericDescription, isSkip, MAX_ENRICH_SKIPS,
    volunteeredPlace, type EnrichSlot,
} from './enrichment';
import { classifyEdge, countsAsOffTopic, type EdgeCategory } from './edgeIntent';
import { fmtAmountProse, fmtProseCurrency, UNDATED } from '../transactionDisplay';
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

// The same discipline for every other slot, which had no cap at all.
const MAX_SLOT_ATTEMPTS = 2;

const SLOT_OF_PENDING: Partial<Record<PendingPrompt, CaptureSlot>> = {
    'field-date': 'date',
    'field-amount': 'amount',
    'field-recipient': 'description',
};

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
        namedGoods: null,
        slotAttempts: 0,
        enrichQueue: [],
        enrichSkips: 0,
        offTopicStreak: 0,
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
    namedGoods: string | null = null,
): { pending: PendingPrompt; batchedSlot: CaptureSlot | null } {
    const question = composeSlotQuestion(openSlots(draft), {
        date: '', amount: '', description: '',
    }, documentType);
    if (!question) return { pending: 'confirm', batchedSlot: null };

    // A question that names what it is about ("How much was the lunch?") beats
    // the same question in the abstract, and proves the earlier answer landed.
    const subject = namedSubject(draft) ?? namedSubject({ recipient: namedGoods });
    const primary = question.slot === 'description'
        ? partyCopyIdForInstance(documentType, instance)
        : subject && question.slot === 'amount' ? 'ask.amountFor'
            : subject && question.slot === 'date' ? 'ask.dateFor'
                : slotCopyId(question.slot, documentType);
    b.say(primary, subject ? { what: subject } : {}, question.alsoAsked
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

// The thing being captured, in the user's own words, when it is short enough
// to sit inside a question. A four-item list is not, and "How much was the
// bacon, tomatoes, airtime and sugar?" reads worse than asking plainly.
function namedSubject(draft: { recipient: string | null }): string | null {
    const name = draft.recipient?.trim();
    if (!name) return null;
    if (name.includes(',')) return null;
    if (name.split(/\s+/).length > 3 || name.length > 28) return null;
    return name.toLowerCase();
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

// Whether an opening message is already about money that changed hands.
//
// A pasted transaction message, or typed text that names a figure or reads
// like a purchase. Not merely "any text": a greeting or an off-topic remark
// must not silently start a document.
function looksLikeSpending(text: string, ctx: TurnContext): boolean {
    if (parseAllMessages(text).transactions.length > 0) return true;
    const e = extractDescription(text, ctx.now);
    return (e.amount != null && e.amount > 0)
        || e.itemisation != null
        || e.soleLineItem != null
        || e.date != null
        // A figure at the front door is money. There is nothing else a number
        // could be in reply to "what are we putting together?".
        || e.hasNumber
        || (e.hasTransactionShape && e.namedGoods != null);
}

function sentenceCase(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function fmtShortDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// `accepted` is what the user just settled, in their own words, for the
// acknowledgement. Omitted where there is nothing new to reflect back, and
// deliberately skipped when the confirmation comes next: the confirmation
// already restates every field, and saying it twice is saying too much.
function advanceAfterField(
    b: TurnBuilder, state: ConvState, draft: CaptureDraft, accepted?: string | null,
): ConvState {
    const stillOpen = openSlots(draft).length > 0;
    if (accepted && stillOpen) b.say('ack.answer', { answer: accepted });
    const next = askNextField(b, draft, state.documentType, state.describedCount, state.namedGoods);
    if (next.pending !== 'confirm') {
        return { ...state, draft, pending: next.pending, batchedSlot: next.batchedSlot };
    }
    return confirmOrEnrich(b, { ...state, batchedSlot: next.batchedSlot }, draft);
}

// Everything is captured. Either the description is worth keeping and the
// confirmation goes out, or it is a category rather than a thing and earns at
// most two questions first. Never in reply to a pasted message: the SMS path
// has a merchant name from the message itself and nothing to ask about.
function confirmOrEnrich(b: TurnBuilder, state: ConvState, draft: CaptureDraft): ConvState {
    const queue = enrichmentFor(state, draft);
    if (queue.length === 0) {
        b.say('confirm.summary', { sentence: confirmSentence(draft) });
        return { ...state, draft, pending: 'confirm', enrichQueue: [] };
    }
    askEnrichment(b, queue[0]);
    return { ...state, draft, pending: 'enrich', enrichQueue: queue };
}

function enrichmentFor(state: ConvState, draft: CaptureDraft): EnrichSlot[] {
    if (state.enrichSkips >= MAX_ENRICH_SKIPS) return [];
    if (draft.lineItems && draft.lineItems.length > 1) return [];
    if (!isGenericDescription(draft.recipient)) return [];
    return enrichmentQueue(state.documentType);
}

function askEnrichment(b: TurnBuilder, slot: EnrichSlot): void {
    b.say(`enrich.${slot}` as CopyId, {}, {
        options: [{ id: 'enrich-skip', label: b.text('enrich.option.skip'), value: 'skip' }],
    });
}

// Where an enrichment answer lands. Both are fields the document already has
// and already prints: the place becomes the party column, the goods become the
// purpose column. Nothing new is stored and nothing new is rendered.
function applyEnrichment(draft: CaptureDraft, slot: EnrichSlot, answer: string): CaptureDraft {
    const value = answer.trim();
    if (!value) return draft;
    const cased = value.charAt(0).toUpperCase() + value.slice(1);
    if (slot === 'where') return { ...draft, recipient: cased };
    if (slot === 'order') return { ...draft, recipient: cased };
    return { ...draft, purposeLabel: cased };
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

    // A greeting, wherever it arrives. Outranks the edge ladder, which would
    // otherwise read "niaje" as small talk and redirect away from a hello.
    if (isGreeting(t) && state.pending !== 'cancel-confirm' && state.pending !== 'correction-target') {
        b.say('open.greetBack');
        stepBack(b, state, 'smallTalk');
        return state;
    }

    // The edge. Runs before anything reads the message as data, because a
    // message this catches is one the capture path would otherwise mine for an
    // amount it never contained. It never catches a real record: see the tense
    // rule in edgeIntent. Asking the app to DO something is checked first:
    // "send it to my boss" is about sharing a document, not moving money.
    if (state.pending !== 'cancel-confirm' && state.pending !== 'correction-target'
        && readRequest(t) === null) {
        const edge = classifyEdge(t);
        if (edge) return handleEdge(b, state, edge);
    }

    // A question ABOUT the app, asked in the middle of being asked something.
    // Answer it, then put the parked question back verbatim — the interruption
    // must not count as an answer to anything, so the pending state is
    // deliberately left exactly as it was. That IS the resume pointer: nothing
    // advanced, so nothing needs restoring.
    if (state.pending !== 'mode' && state.pending !== 'cancel-confirm'
        && state.pending !== 'correction-target' && state.pending !== 'zero-escape'
        && !asksForExample(t) && readRequest(t) === null) {
        const e = extractDescription(t, ctx.now);
        const intent = classifyIntent({ text: t, extraction: e, nothingExtracted: understoodNothing(e) });
        if (intent === 'meta_question') {
            // The answer and the question it puts back are two ideas, so they
            // are two turns. That is also what lets a scenario assert on WHICH
            // answer was given: folded into one string, the answer's own
            // registry id was invisible.
            b.say(answerOrAdmitCopyId(t));
            stepBack(b, state, 'offTopic');
            return state;
        }
    }

    // Asking the app to DO something. Checked before the correction branch:
    // "make it a PDF" carries the correction marker "make it", and was read as
    // an edit to the draft.
    const request = readRequest(t);
    if (request === 'undo') { b.say('after.undo'); return state; }
    if (request === 'send') { b.say('after.share'); return state; }
    if (request === 'export') { b.say('help.export'); return state; }

    // "Like what?" is a question about the question, not about the app. One
    // example, then the same question again.
    const openSlot = SLOT_OF_PENDING[state.pending];
    if (openSlot && asksForExample(t)) {
        b.say(`help.example.${openSlot}` as CopyId, {}, { resumedCopyId: slotCopyId(openSlot, state.documentType) });
        return state;
    }
    // "I don't know" on the amount. A required field, so say in one clause why
    // it is needed rather than asking the same question again, and take a
    // rough figure.
    if (state.pending === 'field-amount' && saysDontKnow(t)) {
        b.say('ask.amountWhyNeeded');
        return state;
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

    // A transaction message pasted in the middle of a typed capture.
    //
    // It is not an answer to whatever was asked: it is a complete record of its
    // own, with its own amount, date and merchant. Reading it as a date answer
    // (or, worse, mining it for an amount) is how a pasted message used to
    // half-land. So it goes down the SMS path, the half-built line is left
    // exactly as it was, and both facts are said out loud.
    if (SLOT_OF_PENDING[state.pending] && parseAllMessages(t).transactions.length > 0) {
        b.effect({ kind: 'parse-batch', text: t });
        b.say('capture.smsMidFlow');
        const parked = parkedQuestion(state);
        b.say('edge.backToQuestion', { question: parked.text }, { resumedCopyId: parked.copyId });
        return state;
    }

    switch (state.pending) {
        // A figure with two honest readings, settled by a tap. The values ARE
        // the option values, so the answer needs no second mechanism.
        case 'amount-choice': {
            const chosen = parseFloat(t.replace(/[^\d.]/g, ''));
            if (!Number.isFinite(chosen)) {
                b.say('zero.tapOne');
                return state;
            }
            return advanceAfterField(b, state, { ...state.draft, amount: chosen, lineItems: null });
        }
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
        // The front door. A tap is the easy case; everything else a person
        // might reasonably open with is handled here rather than met with
        // "tap one of the options above".
        case 'mode': {
            if (asksWhatOptionsMean(t)) {
                b.say('open.modeExplained');
                b.say('open.modeQuestion', {}, { options: modeOptions() });
                return state;
            }
            const named = readModeChoice(t);
            if (named) {
                const chosen = chooseMode(state, modeValue(named));
                b.turns.push(...chosen.turns);
                return chosen.state;
            }
            // Someone who types a purchase, or pastes an M-Pesa message, at
            // the mode question has told us what they want: a record of their
            // own spending. Confirming that implicitly and getting on with it
            // beats making them answer a question they have already answered.
            if (looksLikeSpending(t, ctx)) {
                b.say('open.assumeOwn');
                const started: ConvState = { ...state, documentType: 'expense_summary', pending: 'input' };
                if (parseAllMessages(t).transactions.length > 0) {
                    b.effect({ kind: 'parse-batch', text: t });
                    return started;
                }
                return handleDescription(b, started, t, ctx);
            }
            b.say('open.tapOne');
            return state;
        }
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
                // Accepted, and said back in the parser's own reading of it, so
                // a misread date is caught here rather than at the very end.
                return advanceAfterField(
                    b, { ...state, dateAttempts: 0, lastDateAnswer: null }, composed.draft,
                    composed.draft.dateInterpretation ?? null,
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
            // composed.draft, not state.draft. The answer failed to settle the
            // DATE; anything else it carried is still kept. Asked "when was
            // that? And how much?" and answered "3100", the flow used to throw
            // the figure away and then ask for it again a turn later, which is
            // the most obvious possible way to look like you were not
            // listening.
            return {
                ...state,
                draft: composed.draft,
                dateAttempts: retry.state.attempts,
                lastDateAnswer: retry.state.lastAnswer,
            };
        }
        case 'field-amount': {
            const composed = composeDraftAnswer(state.draft, 'amount', t, ctx.now, state.batchedSlot);
            if (!composed.accepted) {
                const stuck = state.slotAttempts + 1;
                // Two goes is enough. A question that has twice failed to get a
                // usable answer will not get one on the third try either, and
                // asking again in the same words is a loop with extra steps.
                if (stuck >= MAX_SLOT_ATTEMPTS) {
                    b.say('ask.stuck');
                    b.say('zero.escape', {}, { options: optionsFrom(ZERO_ESCAPE_VALUES, ZERO_OPTION_COPY) });
                    return { ...state, draft: composed.draft, pending: 'zero-escape', slotAttempts: 0 };
                }
                b.say('ask.amountRetry');
                return { ...state, draft: composed.draft, slotAttempts: stuck };
            }
            return advanceAfterField(
                b, { ...state, slotAttempts: 0 }, composed.draft,
                composed.draft.amount != null
                    ? fmtAmountProse(composed.draft.amount, composed.draft.currency.code)
                    : null,
            );
        }
        case 'field-recipient': {
            const composed = composeDraftAnswer(state.draft, 'description', t, ctx.now, state.batchedSlot);
            if (!composed.accepted) {
                b.say(partyCopyId(state.documentType));
                return state;
            }
            return advanceAfterField(b, state, composed.draft, composed.draft.recipient);
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
        // Which field the user said was wrong, answered by a tap.
        case 'confirm-field': {
            if (t === 'start-again') {
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
            const slot = (['amount', 'date', 'description'] as const).find(x => x === t);
            if (!slot) {
                b.say('confirm.whatIsOff', {}, { options: fieldOptions(b) });
                return state;
            }
            b.say(`confirm.fieldAsk.${slot}` as CopyId);
            // The slot is emptied so the answer has somewhere to land and the
            // ordinary answer reader handles it; nothing else is touched.
            const cleared: CaptureDraft = slot === 'amount'
                ? { ...state.draft, amount: null, lineItems: null }
                : slot === 'date'
                    ? { ...state.draft, date: null, dateSkipped: false, dateInterpretation: null }
                    : { ...state.draft, recipient: null };
            return {
                ...state,
                draft: cleared,
                pending: slot === 'amount' ? 'field-amount' : slot === 'date' ? 'field-date' : 'field-recipient',
                batchedSlot: null,
            };
        }
        // One enrichment question, answered or skipped.
        case 'enrich': {
            const [slot, ...rest] = state.enrichQueue;
            if (isSkip(t)) {
                // Each question is skippable on its own; the count is what is
                // session-wide. Two skips anywhere and the offer is withdrawn
                // for good, so the next vague line is simply confirmed.
                const skips = state.enrichSkips + 1;
                if (rest.length > 0 && skips < MAX_ENRICH_SKIPS) {
                    askEnrichment(b, rest[0]);
                    return { ...state, enrichSkips: skips, enrichQueue: rest };
                }
                b.say('confirm.summary', { sentence: confirmSentence(state.draft) });
                return { ...state, enrichSkips: skips, enrichQueue: [], pending: 'confirm' };
            }
            const enriched = applyEnrichment(state.draft, slot, t);
            b.say('enrich.attached', { detail: t.trim() });
            if (rest.length > 0) {
                askEnrichment(b, rest[0]);
                return { ...state, draft: enriched, enrichQueue: rest };
            }
            b.say('confirm.summary', { sentence: confirmSentence(enriched) });
            return { ...state, draft: enriched, pending: 'confirm', enrichQueue: [] };
        }
        case 'confirm': {
            // Detail volunteered after the fact, or a request to be asked for
            // it. Neither is a rejection of the draft.
            const place = volunteeredPlace(t);
            if (place && isGenericDescription(state.draft.recipient)) {
                const withPlace = applyEnrichment(state.draft, 'where', place);
                b.say('enrich.attached', { detail: place });
                b.say('confirm.summary', { sentence: confirmSentence(withPlace) });
                return { ...state, draft: withPlace };
            }
            if (asksToBeAsked(t)) {
                const queue = enrichmentQueue(state.documentType);
                if (queue.length > 0) {
                    askEnrichment(b, queue[0]);
                    return { ...state, pending: 'enrich', enrichQueue: queue, enrichSkips: 0 };
                }
            }
            const added = foldAddition(state.draft, t, ctx.now);
            if (isAffirmative(t)) return commit(b, state, state.draft, ctx);

            // "Hmm" and "hold on" are not rejections. Wiping a draft over one
            // is the most expensive possible reading of the least committal
            // thing a person can say.
            if (isHolding(t)) {
                b.say('confirm.holding');
                return state;
            }

            // Taking a line back off.
            const removal = resolveRemoval(state.draft, t);
            if (removal) {
                if (removal.kind === 'notFound') {
                    b.say('confirm.removeNotFound');
                    return state;
                }
                b.say('confirm.removed', {
                    item: removal.item,
                    sentence: confirmSentence(removal.draft),
                });
                return { ...state, draft: removal.draft };
            }

            // "No, 600" is a one-step correction, not a rejection. A bare "no"
            // is a rejection, and gets asked what is wrong rather than being
            // made to answer every question again.
            const remainder = rejectionRemainder(t);
            if (remainder) {
                const outcome = resolveCorrection(state.draft, remainder, ctx.now);
                if (outcome.kind === 'applied') {
                    b.say('correction.applied', { echo: outcome.echo });
                    return advanceAfterField(b, { ...state, pending: 'input' }, outcome.draft);
                }
                if (outcome.kind === 'ambiguous') {
                    b.say('correction.ambiguous', { question: outcome.text }, { options: outcome.options });
                    return { ...state, pending: 'correction-target', pendingCorrectionAmount: outcome.amount };
                }
            }
            if (isNegative(t)) {
                b.say('confirm.whatIsOff', {}, { options: fieldOptions(b) });
                return { ...state, pending: 'confirm-field' };
            }

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
        case 'input': {
            if (t === 'carry-on') {
                b.say('edge.backToCapture');
                return { ...state, offTopicStreak: 0 };
            }
            if (request === 'another') {
                // The same mode, a clean draft. Nothing already on the
                // document is touched.
                b.say('after.another');
                return { ...state, draft: emptyCaptureDraft(), namedGoods: null, slotAttempts: 0 };
            }
            return 'not-consumed';
        }
    }
    return 'not-consumed';
}

// The two-reading question. The figures themselves are the option values.
function askAmountChoice(b: TurnBuilder, choice: AmountChoice): void {
    const label = (n: number) => fmtAmountProse(n, 'KES');
    if (choice.kind === 'split') {
        const [share, full] = choice.values;
        b.say('amount.splitBill', {}, {
            options: [
                { id: 'amount-share', label: b.text('amount.optionShare', { label: label(share) }), value: String(share) },
                { id: 'amount-full', label: b.text('amount.optionFull', { label: label(full) }), value: String(full) },
            ],
        });
        return;
    }
    b.say('amount.whichOfRange', {}, {
        options: choice.values.map((n, i) => ({
            id: `amount-choice-${i}`,
            label: b.text('amount.optionFigure', { label: label(n) }),
            value: String(n),
        })),
    });
}

// The draft's own fields, offered as the answer to "which part is wrong?".
function fieldOptions(b: TurnBuilder): ChatOption[] {
    return [
        { id: 'confirm-amount', label: b.text('confirm.field.amount'), value: 'amount' },
        { id: 'confirm-date', label: b.text('confirm.field.date'), value: 'date' },
        { id: 'confirm-description', label: b.text('confirm.field.description'), value: 'description' },
        { id: 'confirm-start', label: b.text('confirm.field.start'), value: 'start-again' },
    ];
}

// ── The redirect composer ───────────────────────────────────────────────────

// One formula for every edge category: a brief honest acknowledgement of the
// limit, then a concrete next step relevant to where the conversation actually
// is. If a question is parked, it comes back. If not, the way back is offered.
//
// Written once, on purpose. Nineteen bespoke replies would drift into nineteen
// different voices, and the variation that matters is in the registry.
const EDGE_ANSWER: Record<EdgeCategory, CopyId> = {
    crisis: 'emotion.crisis',
    capability: 'edge.cannotMoveMoney',
    advice: 'edge.advice',
    privacy: 'help.privacy',
    identity: 'help.identity',
    whoMadeYou: 'help.whoMadeYou',
    coverage: 'help.coverage',
    taxInvoice: 'help.notTaxInvoice',
    noConnection: 'help.noConnection',
    frustration: 'emotion.frustration',
    moneyStress: 'emotion.moneyStress',
    goodNews: 'emotion.goodNews',
    smallTalk: 'edge.smallTalk',
    entertainment: 'edge.entertainment',
    otherApp: 'edge.otherApp',
    personal: 'edge.personal',
    language: 'edge.language',
    offTopic: 'edge.offTopic',
};

function handleEdge(b: TurnBuilder, state: ConvState, category: EdgeCategory): ConvState {
    const streak = countsAsOffTopic(category) ? state.offTopicStreak + 1 : 0;

    // Crisis stops everything. No next step, no question, no getting back to
    // the receipt. The draft is untouched and waiting whenever they return.
    if (category === 'crisis') {
        b.say('emotion.crisis');
        return { ...state, offTopicStreak: 0 };
    }

    // Third in a row: shorter, and options rather than the same sentence again.
    // The options are whatever is actually useful from here, which is the mode
    // choice at the front door and a way back into the capture once it is
    // under way. Offering the mode options mid-capture would invite restarting
    // a document the user is halfway through.
    if (streak >= 3) {
        const options = state.pending === 'mode'
            ? modeOptions()
            : [
                { id: 'edge-paste-msg', label: b.text('zero.option.paste'), value: 'paste' },
                { id: 'edge-carry-on', label: b.text('edge.option.carryOn'), value: 'carry-on' },
            ];
        b.say('edge.offTopicAgain', {}, { options });
        return { ...state, offTopicStreak: streak };
    }

    b.say(EDGE_ANSWER[category]);

    // Frustration gets the simplest path offered, not just sympathy.
    if (category === 'frustration') {
        b.say('zero.escape', {}, {
            options: [
                { id: 'edge-paste', label: b.text('emotion.option.paste'), value: 'paste' },
                { id: 'edge-one', label: b.text('emotion.option.oneAtATime'), value: 'one-at-a-time' },
            ],
        });
        return { ...state, offTopicStreak: streak };
    }

    stepBack(b, state, category);
    return { ...state, offTopicStreak: streak };
}

// The way back, chosen from where the conversation actually is.
function stepBack(b: TurnBuilder, state: ConvState, category: EdgeCategory): void {
    if (state.pending === 'mode') {
        b.say('open.modeQuestion', {}, { options: modeOptions() });
        return;
    }
    // Money stress is the one place the offer is better than the question: they
    // said something about their money, and where it went is the honest thing
    // this can actually give them.
    if (category === 'moneyStress') {
        b.say('edge.offerSpending');
        return;
    }
    const parked = parkedQuestion(state);
    if (state.pending === 'input') {
        b.say('edge.backToCapture');
        return;
    }
    b.say('edge.backToQuestion', { question: parked.text }, { resumedCopyId: parked.copyId });
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
        b.say(questionIds[0]);
        stepBack(b, state, 'offTopic');
        return state;
    }
    // Only the data half is folded into the draft; the question half would
    // otherwise be mined for an amount it never contained.
    let dataText = segments.data.length > 0 && questionIds.length > 0
        ? segments.data.map(d => d.text).join(', ')
        : text;

    // Figures that are not simply figures: a split bill, a range, arithmetic,
    // a self-correction, or nothing paid at all. Settled before extraction, so
    // the ordinary path only ever sees a message that says what it means.
    const phrase = readAmountPhrase(dataText);
    if (phrase?.kind === 'nothingPaid') {
        b.say('commit.nothingToRecord');
        return { ...state, draft: emptyCaptureDraft(), pending: 'input', describedCount: state.describedCount + 1 };
    }
    if (phrase?.kind === 'choice') {
        askAmountChoice(b, phrase.choice);
        return {
            ...state,
            draft: composeDescription(state.draft, dataText, ctx.now).draft,
            pending: 'amount-choice',
            describedCount: state.describedCount + 1,
        };
    }
    const working = phrase?.kind === 'rewrite' ? phrase.rewrite.working : null;
    if (phrase?.kind === 'rewrite') dataText = phrase.rewrite.text;

    const { draft, extraction: r } = composeDescription(state.draft, dataText, ctx.now);
    // The working is shown before whatever the message prompts, so a
    // misreading can be caught on the figures rather than on the total alone.
    if (working) b.say('ack.arithmetic', { working });
    const describedCount = state.describedCount + 1;
    // Goods named without a price. Carried by every branch below, including the
    // date-clarification ones, which is where it was first lost: "bought lunch"
    // has no date, so it never reached the ordinary path at all.
    const namedGoods = r.namedGoods ?? state.namedGoods;

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
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft), namedGoods,
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
        const subject = namedSubject(draft) ?? namedSubject({ recipient: namedGoods });
        if (attempted) b.say('date.retry', { reason: r.dateResult.reason }, followFor(draft));
        else if (subject) b.say('ask.dateFor', { what: subject }, followFor(draft));
        else b.say('ask.date', {}, followFor(draft));
        const next = fireNudge({
            ...state, draft: { ...draft, date: null }, pending: 'field-date',
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft), namedGoods,
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
            describedCount, zeroAttempts: 0, batchedSlot: nextOpenAfterDate(draft), namedGoods,
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
            batchedSlot: null, namedGoods,
        });
        answerQuestions();
        return next;
    }

    // One path, driven by what is actually still missing: everything the
    // message filled stays filled, and only a genuinely empty slot earns a
    // question.
    // On the document types whose description slot IS the goods, a named thing
    // fills it once a price lands. A payee slot is never filled with a thing
    // that was bought.
    // Only point_of_sale. Its description slot asks "what did they buy?", and
    // the message already said. The other three ask for a payee or a place,
    // which a named thing is not: filing "lunch" as who the money went to
    // would put the wrong word on the document.
    const withGoods: CaptureDraft = !draft.recipient && namedGoods && state.documentType === 'point_of_sale'
        ? { ...draft, recipient: sentenceCase(namedGoods) }
        : draft;

    // A claim asks "Where was this spent?", and a category is not a place.
    // Filing "food" there would print the word Food in the column a reviewer
    // reads as the merchant, so it becomes the purpose instead and the place
    // is still asked for. The claim walks a purpose for every line anyway, so
    // nothing here is a second pass over the same ground.
    const placed: CaptureDraft = state.documentType === 'on_behalf_of'
        && isGenericDescription(withGoods.recipient)
        ? {
            ...withGoods,
            recipient: null,
            purposeLabel: withGoods.purposeLabel ?? sentenceCase(withGoods.recipient!),
        }
        : withGoods;

    const asked = askNextField(b, placed, state.documentType, describedCount, namedGoods);
    const settled: ConvState = asked.pending === 'confirm'
        ? confirmOrEnrich(b, {
            ...state, describedCount, zeroAttempts: 0, batchedSlot: asked.batchedSlot, namedGoods,
        }, placed)
        : {
            ...state, draft: placed, pending: asked.pending, describedCount, zeroAttempts: 0,
            batchedSlot: asked.batchedSlot, namedGoods,
        };
    const next = fireNudge(settled);
    answerQuestions();
    return next;
}

export type { Effect, TurnResult };
