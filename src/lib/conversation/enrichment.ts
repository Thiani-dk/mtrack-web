import type { DocumentType } from '../../types';

// Asking for the detail that makes a record worth keeping, without turning the
// conversation into a form.
//
// "Food, 500" is a line nobody will recognise in three months. "Java House,
// chicken wings, 500" is a record. The difference is two questions.
//
// The whole design here is the bound, not the questions. Two questions, one at
// a time, both skippable, and the moment someone skips twice in a session they
// are never asked again. An enrichment pass with no bound on it is an
// interrogation, and it would be worse than the vague line it was trying to
// fix.

export type EnrichSlot = 'where' | 'what' | 'order';

// Descriptions that name a category rather than a thing. Deliberately a short,
// closed list: "chicken wings" must never land here, and the cost of a false
// positive (an unnecessary question) is paid by the user every single time.
const GENERIC = new Set([
    'food', 'lunch', 'breakfast', 'dinner', 'supper', 'meal', 'meals', 'snack', 'snacks',
    'drinks', 'drink', 'groceries', 'grocery', 'shopping', 'stuff', 'things', 'items',
    'transport', 'fare', 'travel', 'supplies', 'materials', 'misc', 'miscellaneous',
    'expenses', 'expense', 'bills', 'bill', 'other', 'sundries', 'purchases', 'purchase',
]);

// Whether a description is too vague to be worth keeping as it stands.
//
// A description of two or more words is left alone even when one of them is
// generic: "lunch at Java House" already says where, and "office supplies" is
// as specific as that line is going to get.
export function isGenericDescription(description: string | null): boolean {
    if (!description) return false;
    const words = description.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 2) return false;
    if (words.length === 2 && !/^(?:some|the|a|an|my)$/.test(words[0])) return false;
    return GENERIC.has(words[words.length - 1].replace(/[^a-z]/g, ''));
}

// Which questions a document type earns, in order.
//
// point_of_sale gets exactly one, because its description slot IS the goods
// and "where" is the business, which was asked at the top of that flow.
// on_behalf_of gets none: it already walks a purpose for every line and asks
// "Where was this spent?" as its party question, and a third pass over the
// same ground is the double-asking this whole effort is against.
export function enrichmentQueue(documentType: DocumentType): EnrichSlot[] {
    if (documentType === 'point_of_sale') return ['order'];
    if (documentType === 'on_behalf_of') return [];
    return ['where', 'what'];
}

// Two skips and the offer is withdrawn for the session. Someone who has twice
// said they do not want to answer has told us.
export const MAX_ENRICH_SKIPS = 2;

// ── Detail volunteered without being asked ──────────────────────────────────

// "Oh, it was at Java." A place named on its own, after the fact.
//
// Narrow on purpose: it has to look like someone adding a place, not like any
// sentence containing the word "at".
const VOLUNTEERED_PLACE_RE =
    /^\s*(?:oh[,\s]+)?(?:it\s+was\s+|that\s+was\s+|we\s+were\s+|i\s+was\s+)?(?:at|from|in)\s+(?:the\s+)?([a-z][a-z0-9'&.\- ]{1,30}?)\s*[.!]?\s*$/i;

export function volunteeredPlace(text: string): string | null {
    const m = VOLUNTEERED_PLACE_RE.exec(text);
    if (!m) return null;
    const place = m[1].trim();
    // A bare pronoun or a filler word is not a place.
    if (/^(?:there|here|it|that|this|work|home|town)$/i.test(place)) return null;
    return place;
}

// ── Asking to be asked ──────────────────────────────────────────────────────

const ASK_ME_MORE_RE =
    /\b(?:ask me more|ask more|more questions|don'?t you want (?:the )?(?:specifics|details|more)|do you want (?:the )?(?:specifics|details|more)|want (?:the )?details|any more questions|anything else you need)\b/i;

export function asksToBeAsked(text: string): boolean {
    return ASK_ME_MORE_RE.test(text.trim());
}

const SKIP_RE = /^(?:skip|no|nope|nah|leave it|not sure|don'?t know|dunno|pass|next)\b[\s.!?]*$/i;

export function isSkip(text: string): boolean {
    return SKIP_RE.test(text.trim());
}
