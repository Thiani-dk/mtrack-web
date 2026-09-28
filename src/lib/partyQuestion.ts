import type { DocumentType } from '../types';
import { copyEntry, type CopyId } from './conversation/copy';

// The question that fills the party/recipient slot, worded for the document
// actually being written.
//
// It was one string for three of the four types — "Who was it paid to?" — which
// reads correctly for the user's own spending and wrongly for a reimbursement
// claim, where the money was spent on someone else's behalf and is being
// presented back to them. "Who was it paid to?" invites the name of the person
// being claimed from, which is a different field entirely (the claim's party,
// asked once at the top of that flow).
//
// The wordings themselves now live in the copy registry under ask.party.* and
// follow.party.*, alongside every other bot-facing sentence. This module keeps
// the rule for CHOOSING between them, which is the part worth testing.

export function partyCopyId(documentType: DocumentType): CopyId {
    return `ask.party.${documentType}` as CopyId;
}

export function partyFollowOnCopyId(documentType: DocumentType): CopyId {
    return `follow.party.${documentType}` as CopyId;
}

// The wording to use, given how many transactions have been described in this
// session so far — 1 while capturing the first, 2 the second, and so on, which
// is exactly the flow's own describedCount. 0 is tolerated and reads as the
// first.
//
// Deterministic in that count, not random: the flow has to be able to put the
// question back word for word when it has been interrupted and resumed, and a
// question that came back differently worded would read as a second, different
// question.
export function partyQuestion(documentType: DocumentType, describedCount: number = 1): string {
    const variants = copyEntry(partyCopyId(documentType)).variants;
    const i = Math.max(0, Math.floor(describedCount) - 1);
    return variants[i % variants.length];
}

// The short form, for when the party slot is the SECOND thing a batched
// question asks about ("When was that? And who was that to?").
//
// A clause, not a second full question: the primary question is the sentence,
// and restating "Who was it paid to?" in full after it reads as two questions
// stacked rather than one asking for two things.
export function partyFollowOn(documentType: DocumentType): string {
    return copyEntry(partyFollowOnCopyId(documentType)).variants[0];
}

// The input placeholder alongside it, in the same voice.
export function partyPlaceholder(documentType: DocumentType): string {
    return copyEntry(`placeholder.party.${documentType}` as CopyId).variants[0];
}
