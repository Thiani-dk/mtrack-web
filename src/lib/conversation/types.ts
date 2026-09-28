import type {
    ChatOption, DocumentType, MerchantProfile, OnBehalfOfContext, ParsedTransaction,
} from '../../types';
import type { CaptureDraft } from '../captureDraft';
import type { CaptureSlot } from '../conversationalCapture';
import type { CopyId, CopyKind } from './copy';
import type { EnrichSlot } from './enrichment';

// Which question the conversation is currently waiting on an answer to.
// Unchanged from the shape that lived in ChatScreen as DocFlow.pending.
export type PendingPrompt =
    | 'mode' | 'business-name' | 'party-name' | 'purpose'
    | 'field-date' | 'field-amount' | 'field-recipient' | 'confirm'
    | 'purpose-label' | 'zero-escape' | 'cancel-confirm' | 'correction-target'
    // Two honest readings of one figure (a range, a split bill). Settled by a
    // tap rather than guessed.
    | 'amount-choice'
    // An enrichment question about a description too vague to keep.
    | 'enrich'
    // Which field the user said was wrong at the confirmation.
    | 'confirm-field'
    | 'input';

// One thing the bot says. `copyId` is what the scenario harness asserts on, so
// wording can be rewritten without touching a test.
export interface BotTurn {
    copyId: CopyId;
    kind: CopyKind;
    text: string;
    options?: ChatOption[];
    // The short second question appended to this one, when two open slots were
    // asked in one breath. Its words come from the registry too.
    suffixCopyId?: CopyId;
    // The parked question this turn put back after an interruption. What
    // `resumes(copyId)` asserts on.
    resumedCopyId?: CopyId;
}

// Everything the conversation knows between turns.
//
// Deliberately plain data with no React in it, so one call to `receive` is a
// pure function of (state, message) and the harness drives exactly what ships.
export interface ConvState {
    documentType: DocumentType;
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
    pending: PendingPrompt;
    draft: CaptureDraft;
    describedCount: number;
    nudgeShown: boolean;
    // Consecutive answers that produced no usable date on the line being
    // captured. Counts failures, not replies, so a fresh valid date is never
    // discarded just for arriving second. See advanceDateRetry.
    dateAttempts: number;
    // The previous date answer verbatim: repeating the same text is not a
    // fresh attempt, however it parses.
    lastDateAnswer: string | null;
    // The figure from a correction whose target is still being chosen.
    pendingCorrectionAmount: number | null;
    // The second slot asked alongside the pending one, when the question was
    // batched. A bare figure is the amount only if "how much?" was asked.
    batchedSlot: CaptureSlot | null;
    // Consecutive messages this flow made nothing whatsoever of. Capped.
    zeroAttempts: number;
    // Transaction codes still awaiting a guided purpose label (on_behalf_of).
    purposeQueue: string[];
    // Which variant of each copy id was used last, so the next use rotates
    // rather than repeating. Deterministic, so transcripts are reproducible.
    variantCursor: Record<string, number>;
    // The copy id of the last thing the bot said, for notRepeatOfPrevious.
    lastCopyId: CopyId | null;
    // What the user said they bought, before any price was attached to it.
    // Used to name the subject of the next question ("How much was the
    // lunch?") and, once a price lands, to fill the description on the
    // document types whose description slot IS the goods.
    namedGoods: string | null;
    // Consecutive answers that failed to settle the slot being asked about,
    // whichever slot that is. The date slot has always had its own cap; every
    // other question could be put in the same words forever.
    slotAttempts: number;
    // The enrichment questions still to put for the line being captured, and
    // how many times this session the user has declined one. Two declines and
    // the offer is withdrawn for good: someone who has twice said no has told
    // us. See enrichment.ts.
    enrichQueue: EnrichSlot[];
    enrichSkips: number;
    // Consecutive messages that were outside the lane. The third in a row gets
    // a shorter reply and options rather than the same redirect again.
    offTopicStreak: number;
}

// Work the conversation cannot do itself because it belongs to storage, to the
// SMS pipeline, or to the message list. The engine decides; the caller acts.
export type Effect =
    // Hand the raw text to the SMS parsing pipeline and narrate the result.
    | { kind: 'parse-batch'; text: string }
    // A described line is settled: add it to the document.
    | { kind: 'commit'; transaction: ParsedTransaction }
    // The receipt message's transactions changed (a purpose label landed).
    | { kind: 'update-transactions'; transactions: ParsedTransaction[] }
    // Persist the draft document as it now stands. A `state` of null is what
    // ends a flow; there is no effect for that.
    | { kind: 'sync-draft' };

export interface TurnResult {
    state: ConvState | null;
    turns: BotTurn[];
    effects: Effect[];
}

// What the engine needs from outside itself for one turn.
export interface TurnContext {
    // Fixed in tests so relative dates are deterministic.
    now: Date;
    // The document's transactions as they currently stand, for the paths that
    // edit them (purpose labelling). The message list stays authoritative.
    transactions: ParsedTransaction[];
    // Every line from every APPROVED expense_summary / personal_note document
    // on this device, for answering "how much did I spend?". Never any
    // point_of_sale or on_behalf_of line: those are a customer's money and
    // money owed back, and counting either would give a confidently wrong
    // figure. Supplied by the caller, which is the only thing that can read
    // IndexedDB.
    ownSpending: ParsedTransaction[];
}
