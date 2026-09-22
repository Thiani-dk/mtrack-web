import type { DocumentType } from '../types';

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
// Copy only. The slot, the field it writes to and the extraction behind it are
// unchanged — what varies here is the sentence, not the data.
//
// Each type gets more than one phrasing, per the standing rule against the bot
// repeating itself verbatim, and for the same reason as the other questions in
// the flow: the second identical sentence in a session reads as a form, not a
// conversation. See zeroUnderstanding.ts for the same pattern.
const PARTY_QUESTIONS: Record<DocumentType, readonly string[]> = {
    // The user's own spending, and their own note about it — money went out to
    // someone, and that someone is what is being asked for.
    expense_summary: ['Who was it paid to?', 'Who did that one go to?'],
    personal_note: ['Who was it paid to?', 'Who did that one go to?'],
    // Authored BY the merchant, for a customer. The answer is printed under
    // ITEMS on the receipt — see documentLayout — so what is wanted is what
    // was sold, not who paid for it.
    point_of_sale: ['What did they buy?', 'What did they buy this time?'],
    // A claim: the user spent their own money on someone else's behalf and is
    // presenting it back. Where it went is the useful fact, and "paid to"
    // would collide with the separate "who was this for?" at the top of the
    // flow.
    on_behalf_of: ['Where was this spent?', 'Who did the money go to?'],
};

// The wording to use, given how many transactions have been described in this
// session so far — 1 while capturing the first, 2 the second, and so on, which
// is exactly the flow's own describedCount. 0 is tolerated and reads as the
// first.
//
// Deterministic in that count, not random: the flow has to be able to put the
// question back word for word when it has been interrupted and resumed, and a
// question that came back differently worded would read as a second, different
// question. See promptFor in ChatScreen.
export function partyQuestion(documentType: DocumentType, describedCount: number = 1): string {
    const variants = PARTY_QUESTIONS[documentType];
    const i = Math.max(0, Math.floor(describedCount) - 1);
    return variants[i % variants.length];
}

// The short form, for when the party slot is the SECOND thing a batched
// question asks about ("When was that? And who was that to?").
//
// A clause, not a second full question: the primary question is the sentence,
// and restating "Who was it paid to?" in full after it reads as two questions
// stacked rather than one asking for two things. Same type-awareness as the
// primary above — a claim is not asked who it was paid to here either.
const PARTY_FOLLOW_ONS: Record<DocumentType, string> = {
    expense_summary: 'And who was that to?',
    personal_note: 'And who was that to?',
    point_of_sale: 'And what did they buy?',
    on_behalf_of: 'And where was it spent?',
};

export function partyFollowOn(documentType: DocumentType): string {
    return PARTY_FOLLOW_ONS[documentType];
}

// The input placeholder alongside it, in the same voice.
const PARTY_PLACEHOLDERS: Record<DocumentType, string> = {
    expense_summary: 'Who it was paid to...',
    personal_note: 'Who it was paid to...',
    point_of_sale: 'What they bought...',
    on_behalf_of: 'Where it was spent...',
};

export function partyPlaceholder(documentType: DocumentType): string {
    return PARTY_PLACEHOLDERS[documentType];
}
