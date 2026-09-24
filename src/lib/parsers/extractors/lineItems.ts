import type { LineItem } from '../../../types';
import { extractAmountMatches, type AmountScanOptions } from './amount';
import { normalizeForKeywords } from '../fuzzy';
import { normalizeSwahiliNumerals, SWAHILI_VERBS } from '../swahili';

// Reading an itemised list out of one typed message.
//
// "Some ram I sold at 5000USD, AI chip 10k USD, CPU 10k USD, motherboard
// 7000usd" is four things with four prices, and a capture flow that throws that
// away and then asks "what did they buy?" is asking a question it has already
// been answered. The LineItem shape and the receipt rendering for it already
// existed; nothing populated it until now.
//
// Deliberately conservative. It only reports an itemisation when the user's own
// phrasing gives it one — two or more segments that each carry their own
// currency-tagged amount. A single amount in a sentence is a single
// transaction, and "Sold a laptop for Ksh 45,000" must stay one, not become a
// one-item list with a laptop in it.
//
// Item and price appear in either order ("ram I sold at 5000USD" / "500 USD on
// call time"); both are read.

export interface ItemisationResult {
    items: LineItem[];
    total: number;
    currency: string;
    // Set when the message names more than one currency. Itemising across
    // currencies would require a rate, which is not something to invent, so the
    // caller asks instead.
    mixedCurrency: boolean;
}

// Segment boundaries: commas, semicolons, newlines, bullets, and "and"/"plus"
// between items. Full stops are NOT boundaries — "Some ram I sold at 5000USD"
// follows "Computer components." and the sentence before it is context, not an
// item.
//
// The comma is only a boundary when it is not the thousands separator inside a
// number: splitting "Ksh 30,000 and electricity" on its comma turned thirty
// thousand into thirty.
// "na" is the Swahili "and", and separates a list of items the same way.
const SEGMENT_RE = /\s*(?:,(?!\d{3}(?!\d))|[;\n•]|\band\b|\bna\b|\bplus\b)\s*/i;

// Words that attach a price to a thing rather than naming it. Stripped from
// the end of a description, where they always end up: "Some ram I sold at".
const TRAILING_NOISE =
    /(?:\b(?:i|we|he|she|they|it)\b\s+)?(?:\b(?:sold|sell|bought|buy|paid|pay|got|charged|went|cost(?:s|ing)?|worth|was|were|is|are)\b\s*)*(?:\b(?:at|for|to|of|each|@)\b\s*)*[-–—:=]?\s*$/i;

// Leading quantifiers, filler and transaction verbs: "Some ram", "a laptop",
// "Paid rent" — the thing bought is "rent", the paying is the transaction.
const LEADING_NOISE = new RegExp(
    String.raw`^(?:\s*(?:i|we|he|she|they|you|some|a|an|the|my|our|his|her|their|also|then|next`
    + String.raw`|plus|with|and|na|paid|pay|bought|buy|sold|sell|got|spent|for|on`
    + String.raw`|sent|send|gave|give|received|receive|to`
    + String.raw`|${SWAHILI_VERBS.join('|')})\b\s*)+`,
    'i',
);

// Sentences before the first item are scene-setting ("They bought hardware.
// Computer components.") — only the last one is part of the item. Likewise,
// only the FIRST sentence after a price belongs to it.
function splitSentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/);
}

function lastSentence(text: string): string {
    const parts = splitSentences(text);
    return parts[parts.length - 1] ?? text;
}

// The last sentence before a price that still says something once tidied.
//
// "...one sweet (honey dipped). worth 2999 ksh" puts a full stop between the
// goods and their price, so the sentence immediately before the price is the
// bare word "worth" — which tidying correctly reduces to nothing, and the item
// was then dropped for having no description at all. A sentence made only of
// the words that attach a price to a thing names no thing; the one before it
// does.
//
// Stepping back is allowed ONLY over a sentence like that: one that had words
// and lost all of them to tidying. A sentence that was blank to begin with
// means the price opened its own sentence, and everything before it is
// scene-setting — "They bought credits... on my platform. 500 USD on call
// time" is call time, not the platform. That case stops here and lets the
// words AFTER the price have it.
function lastSpeakingSentence(text: string): string {
    const parts = splitSentences(text);
    for (let i = parts.length - 1; i >= 0; i--) {
        if (!parts[i].trim()) return '';
        const tidied = goodsIn(parts[i]);
        if (tidied) return tidied;
    }
    return '';
}

// The thing named in a clause that runs up to a price.
//
// The same rule itemFragment uses on price-less clauses: the last transaction
// verb is where the goods start, so "3 days ago i bought milk for 120" is about
// milk and not about three days ago. Applied only when trimming to the verb
// leaves something behind — "Some ram I sold at" has its goods BEFORE the verb,
// and trimming there would throw the ram away.
function goodsIn(clause: string): string {
    const trimmed = tidy(afterLastVerb(clause));
    return trimmed || tidy(clause);
}

function firstSentence(text: string): string {
    return splitSentences(text.trim())[0] ?? text;
}

function tidy(raw: string): string {
    let out = raw.trim();
    out = out.replace(LEADING_NOISE, '');
    out = out.replace(TRAILING_NOISE, '');
    // A price can sit mid-sentence, so the words around it keep their
    // punctuation — strip what is left dangling at either end.
    out = out.replace(/^[\s,;:—–-]+/, '').replace(/[\s,;:.!?—–-]+$/, '');
    // "sweet(honey dipped)" is one word to everything that counts words, and
    // reads as a typo in the confirmation. The space the user left out.
    out = out.replace(/(\S)\(/g, '$1 (');
    return out.replace(/\s+/g, ' ').trim();
}

// The words naming the thing this price was for.
//
// People write it both ways round. "Some ram I sold at 5000USD" puts the item
// first; "500 USD on call time" puts the price first. Reading only one side
// silently dropped every item phrased the other way — and a dropped item is
// not a visible failure, it is a flow that asks "what did they buy?" about
// something it was already told.
//
// Before wins when it says anything, since that is the more common phrasing
// and the side that carries a quantity.
function cleanDescription(before: string, after: string): string {
    const fromBefore = lastSpeakingSentence(before);
    if (fromBefore) return fromBefore;
    return tidy(firstSentence(after));
}

// Give a lowercase word a capital, but leave one that already carries internal
// capitals alone — "ram" becomes "Ram", while "iPhone" and "CPU" are untouched.
function sentenceCase(text: string): string {
    const [first] = text.split(' ');
    if (!first || first !== first.toLowerCase()) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// "2 x 1500", "3 at Ksh 1,500" — a quantity and a unit price, when the user's
// phrasing actually implies them. Absent that, an item is just a thing and a
// price and the quantity stays null rather than being invented as 1.
// Either side of the thing: "3 x sodas" and "sodas 3 x" both mean three.
const QUANTITY_LEADING_RE = /^(\d{1,3})\s*(?:x|×|pcs?|pieces?|of)\s+/i;
const QUANTITY_TRAILING_RE = /(?:^|\s)(\d{1,3})\s*(?:x|×|pcs?|pieces?)\s*$/i;

function splitQuantity(description: string, amount: number): Pick<LineItem, 'description' | 'quantity' | 'unitPrice'> {
    const plain = { description, quantity: null, unitPrice: null };

    const leading = description.match(QUANTITY_LEADING_RE);
    const trailing = leading ? null : description.match(QUANTITY_TRAILING_RE);
    const m = leading ?? trailing;
    if (!m) return plain;

    const quantity = parseInt(m[1], 10);
    if (!Number.isFinite(quantity) || quantity <= 1) return plain;

    const rest = leading
        ? description.slice(m[0].length).trim()
        : description.slice(0, m.index).trim();
    if (!rest) return plain;

    return {
        description: rest,
        quantity,
        // The stated figure is the line total; the unit price follows from it.
        unitPrice: round2(amount / quantity),
    };
}

// Second-pass boundaries, used ONLY on a segment that came back carrying more
// than one price — which the pass below would otherwise discard whole.
//
// A full stop is not a first-pass boundary on purpose ("They bought hardware.
// Computer components." is one item, not two), so "...garlic at 400. then i
// bought airtime worth 30" arrived as a single two-priced segment and both
// items were dropped. Re-splitting only where the extractor was already going
// to give up cannot cost anything it currently gets right.
const RESEGMENT_RE =
    /\s*(?:(?<=[.!?:])\s+|\bthen\b|\bafter that\b|\bnext\b|\blater\b|\band also\b|\boh and\b|\balso\b)\s*/i;

// Greetings, fillers and time words that survive tidying but name no item.
// Carrying one forward would file "hi so" as part of a purchase.
const NON_ITEM_WORDS = new Set([
    'hi', 'hey', 'hello', 'so', 'ok', 'okay', 'well', 'yeah', 'yep', 'yes', 'no',
    'thanks', 'please', 'today', 'yesterday', 'tomorrow', 'morning', 'afternoon',
    'evening', 'night', 'lot', 'much', 'quite', 'really', 'just', 'stuff', 'things',
]);

// The last transaction verb in a price-less clause is where the goods start:
// "then i rode a bus to a neighborhood where i bought tomatoes" is about
// tomatoes, and everything before "bought" is how the user got there.
const TRAILING_VERB_RE = /\b(?:bought|buy|purchased|paid|pay|sold|sell|got|spent|took|had)\b/gi;

// Everything after the last transaction verb in a clause, or the whole clause
// when it has none.
function afterLastVerb(clause: string): string {
    TRAILING_VERB_RE.lastIndex = 0;
    let end = -1;
    let m: RegExpExecArray | null;
    while ((m = TRAILING_VERB_RE.exec(clause)) !== null) end = m.index + m[0].length;
    return end >= 0 ? clause.slice(end) : clause;
}

// A subject pronoun is the mark of narration rather than of a thing: "i rode a
// bus to a neighborhood" has one, "2 buckets of chicken wings" does not.
const NARRATING_RE = /\b(?:i|we|he|she|they|you|it)\b/i;

// A price-less segment reduced to the thing it names, or null if it names none.
//
// Bounded on purpose: at most a short noun phrase, never a clause. A generous
// version of this would quietly staple half a sentence onto the next item's
// description, which is worse than losing the word.
function itemFragment(segment: string): string | null {
    const clause = lastSentence(segment);
    const hadVerb = afterLastVerb(clause) !== clause;

    const fragment = tidy(afterLastVerb(clause));
    if (!fragment) return null;

    const words = fragment.split(' ');
    // How much text may be carried forward as one item's words.
    //
    // A bare noun phrase — no transaction verb to anchor it, and no subject
    // pronoun either — is exactly what a descriptive fragment looks like: "2
    // buckets of chicken wings", "one sweet (honey dipped)". Those ran over the
    // old three-word ceiling and were dropped, which is how a message whose
    // first six words said what was bought still got asked what was bought.
    // Anything carrying a pronoun is someone telling a story and keeps the
    // tight ceiling.
    const limit = hadVerb ? 4 : NARRATING_RE.test(fragment) ? 3 : 6;
    if (words.length > limit) return null;
    if (words.every(w => NON_ITEM_WORDS.has(w.toLowerCase().replace(/[^a-z]/gi, '')))) return null;

    return fragment;
}

// Every priced thing a message names, however many that is.
//
// Split out from extractLineItems because "how many priced things are in this
// message" and "does this message name what was bought" are two questions, and
// answering the second with the first is what made the chicken-wings message
// fail: one price meant no itemisation, no itemisation meant no description,
// and the flow asked what they bought about a sentence that opened by saying.
function collectItems(typed: string, opts: AmountScanOptions): { items: LineItem[]; currencies: Set<string> } {
    // Typed input gets the typo/merged-word pass before anything reads it, so
    // "somebacon" reaches the description as "bacon" rather than as itself.
    // Idempotent, so a caller that has already normalised loses nothing.
    const text = opts.allowBare ? normalizeForKeywords(normalizeSwahiliNumerals(typed)) : typed;

    const items: LineItem[] = [];
    const currencies = new Set<string>();

    // Things named without a price yet, waiting for the price they share.
    // "bacon and pork cuts for 3100" splits on "and", leaving "bacon" priceless
    // and "pork cuts for 3100" priced — they are one line, not one line and one
    // discarded word.
    let pending: string[] = [];

    const segments = text.split(SEGMENT_RE).flatMap(segment =>
        extractAmountMatches(segment, opts).length > 1 ? segment.split(RESEGMENT_RE) : [segment],
    );

    for (const segment of segments) {
        if (!segment.trim()) continue;

        const matches = extractAmountMatches(segment, opts);
        // No price in this segment: either a thing whose price comes later, or
        // context. More than one even after re-splitting: guessing which words
        // belong to which price would be inventing detail.
        if (matches.length !== 1) {
            if (matches.length === 0) {
                const fragment = itemFragment(segment);
                // Capped so a long preamble cannot accumulate into a line.
                if (fragment && pending.length < 8) pending.push(fragment);
                else if (!fragment) pending = [];
            }
            continue;
        }

        const [match] = matches;
        const description = cleanDescription(
            segment.slice(0, match.index),
            segment.slice(match.index + match.length),
        );
        const carried = pending;
        pending = [];

        // A segment that is nothing but the price and the word attaching it
        // ("...half warm, worth 1200") describes whatever came just before it.
        // Dropping the item here is what made the words the user actually
        // typed disappear and the question come back.
        const full = [...carried, description].filter(Boolean).join(', ');
        if (!full) continue;
        const split = splitQuantity(full, match.amount);
        currencies.add(match.currency);
        items.push({ ...split, description: sentenceCase(split.description), amount: match.amount });
    }

    return { items, currencies };
}

// The itemisation in a message, or null when there isn't one.
export function extractLineItems(typed: string, opts: AmountScanOptions = {}): ItemisationResult | null {
    const { items, currencies } = collectItems(typed, opts);

    // One priced thing is a transaction, not an itemisation. A receipt that
    // breaks a single purchase out into a one-row table, with the row and the
    // total saying the same figure twice, is noise. See extractSoleItem for
    // what that one thing is still good for.
    if (items.length < 2) return null;

    return {
        items,
        total: round2(items.reduce((sum, i) => sum + i.amount, 0)),
        currency: currencies.values().next().value ?? 'KES',
        mixedCurrency: currencies.size > 1,
    };
}

// The goods named by a message that carries exactly one price.
//
// Not an itemisation — the caller uses this for the DESCRIPTION alone, so a
// single purchase is still confirmed as one line. It exists because "2 buckets
// of chicken wings, one spicy, one sweet (honey dipped). worth 2999 ksh" said
// what was bought perfectly clearly and was still answered with "What did they
// buy?": the only reader of item text in the whole flow was the itemisation,
// and an itemisation needs two prices.
//
// Guarded against handing back filler: a description made entirely of words
// that name no thing ("yesterday", "stuff") is no description at all, and
// filing a purchase as "Yesterday" is worse than asking.
export function extractSoleItem(typed: string, opts: AmountScanOptions = {}): LineItem | null {
    const { items } = collectItems(typed, opts);
    if (items.length !== 1) return null;

    const [item] = items;
    const words = item.description.split(' ').filter(Boolean);
    if (words.length === 0) return null;
    if (words.every(w => NON_ITEM_WORDS.has(w.toLowerCase().replace(/[^a-z]/gi, '')))) return null;
    if (!/[a-z]/i.test(item.description)) return null;
    return item;
}
