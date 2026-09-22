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
    const fromBefore = tidy(lastSentence(before));
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

// A price-less segment reduced to the thing it names, or null if it names none.
//
// Bounded on purpose: at most a short noun phrase, never a clause. A generous
// version of this would quietly staple half a sentence onto the next item's
// description, which is worse than losing the word.
function itemFragment(segment: string): string | null {
    let clause = lastSentence(segment);

    TRAILING_VERB_RE.lastIndex = 0;
    let lastVerbEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = TRAILING_VERB_RE.exec(clause)) !== null) lastVerbEnd = m.index + m[0].length;
    const hadVerb = lastVerbEnd >= 0;
    if (hadVerb) clause = clause.slice(lastVerbEnd);

    const fragment = tidy(clause);
    if (!fragment) return null;

    const words = fragment.split(' ');
    // With no verb to anchor it, anything longer than a short phrase is
    // narration rather than a list entry.
    if (words.length > (hadVerb ? 4 : 3)) return null;
    if (words.every(w => NON_ITEM_WORDS.has(w.toLowerCase().replace(/[^a-z]/gi, '')))) return null;

    return fragment;
}

// The itemisation in a message, or null when there isn't one.
export function extractLineItems(typed: string, opts: AmountScanOptions = {}): ItemisationResult | null {
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
        if (!description) continue;

        const full = [...carried, description].join(', ');
        const split = splitQuantity(full, match.amount);
        currencies.add(match.currency);
        items.push({ ...split, description: sentenceCase(split.description), amount: match.amount });
    }

    // One priced thing is a transaction, not an itemisation.
    if (items.length < 2) return null;

    return {
        items,
        total: round2(items.reduce((sum, i) => sum + i.amount, 0)),
        currency: currencies.values().next().value ?? 'KES',
        mixedCurrency: currencies.size > 1,
    };
}
