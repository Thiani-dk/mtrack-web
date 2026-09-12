import type { LineItem } from '../../../types';
import { extractAmountMatches } from './amount';

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
const SEGMENT_RE = /\s*(?:,(?!\d{3}(?!\d))|[;\n•]|\band\b|\bplus\b)\s*/i;

// Words that attach a price to a thing rather than naming it. Stripped from
// the end of a description, where they always end up: "Some ram I sold at".
const TRAILING_NOISE =
    /(?:\b(?:i|we|he|she|they|it)\b\s+)?(?:\b(?:sold|sell|bought|buy|paid|pay|got|charged|went|cost(?:s|ing)?|was|were|is|are)\b\s*)*(?:\b(?:at|for|to|of|each|@)\b\s*)*[-–—:=]?\s*$/i;

// Leading quantifiers, filler and transaction verbs: "Some ram", "a laptop",
// "Paid rent" — the thing bought is "rent", the paying is the transaction.
const LEADING_NOISE =
    /^(?:\s*(?:some|a|an|the|my|our|his|her|their|also|then|plus|with|and|paid|pay|bought|buy|sold|sell|got|spent|for|on)\b\s*)+/i;

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

// The itemisation in a message, or null when there isn't one.
export function extractLineItems(text: string): ItemisationResult | null {
    const items: LineItem[] = [];
    const currencies = new Set<string>();

    let cursor = 0;
    for (const segment of text.split(SEGMENT_RE)) {
        const start = text.indexOf(segment, cursor);
        cursor = start >= 0 ? start + segment.length : cursor;
        if (!segment.trim()) continue;

        const matches = extractAmountMatches(segment);
        // No price in this segment: it is context, not an item. More than one:
        // the segmentation did not separate them, and guessing which words
        // belong to which price would be inventing detail.
        if (matches.length !== 1) continue;

        const [match] = matches;
        const description = cleanDescription(
            segment.slice(0, match.index),
            segment.slice(match.index + match.length),
        );
        if (!description) continue;

        const split = splitQuantity(description, match.amount);
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
