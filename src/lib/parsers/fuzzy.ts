// Tolerating imperfectly-typed input, in two narrow, bounded ways.
//
// Neither of these is a spellchecker, and neither is allowed to touch free
// text. A wrong correction inside an item name or a recipient name replaces
// one real word with a different real word and says nothing about having done
// it — strictly worse than not understanding, because the user has no way to
// notice. So both mechanisms here only ever consult small, fixed vocabularies
// that the parser already treats as keywords.
//
//   1. Fuzzy keyword matching — "boought" reads as "bought". Bounded by edit
//      distance, by a minimum token length, and by only running at all in a
//      clause where the exact match has already failed.
//   2. Merged-word recovery — "somebacon" reads as "some bacon". Bounded to a
//      quantity/filler word followed by a plausible standalone word.

import { SWAHILI_VERBS } from './swahili';

// ── Edit distance ────────────────────────────────────────────────────────────

// Damerau-Levenshtein, because the commonest typo by far is a transposition
// ("recieved", "bougth") and plain Levenshtein charges two for it — which is
// the difference between catching those and not.
//
// Bounded: returns false as soon as the distance cannot come in under `max`,
// so this stays cheap over a vocabulary scan.
export function withinEditDistance(a: string, b: string, max: number): boolean {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > max) return false;

    const rows: number[][] = [];
    for (let i = 0; i <= a.length; i++) rows.push(new Array<number>(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) rows[i][0] = i;
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        let best = Infinity;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            // Transposition: "ab" for "ba".
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d = Math.min(d, rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = d;
            best = Math.min(best, d);
        }
        // No cell in this row can lead anywhere under the bound.
        if (best > max) return false;
    }
    return rows[a.length][b.length] <= max;
}

// How far a token of a given length is allowed to stray. Longer words carry
// more redundancy, so two edits still identify them unambiguously; four- and
// five-letter words do not, which is why "gold" is never allowed to become
// "sold" and "pyed" is never allowed to become "paid". Silently swapping one
// real word for another is the exact failure this whole module exists to
// avoid, and a handful of uncaught short typos is the honest price of it.
const MIN_FUZZY_LENGTH = 5;

function allowedDistance(len: number): number {
    return len > 6 ? 2 : 1;
}

// The vocabulary entry a token is a misspelling of, or null.
//
// Exact matches are the caller's business — this is the fallback for when
// those have already failed.
export function fuzzyCanonical(token: string, vocabulary: readonly string[]): string | null {
    const word = token.toLowerCase();
    // An exact hit is an exact hit at any length — the minimum below governs
    // how short a word may be before it is allowed to be *corrected*.
    if (vocabulary.includes(word)) return word;
    if (word.length < MIN_FUZZY_LENGTH) return null;

    const max = allowedDistance(word.length);
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const candidate of vocabulary) {
        for (let d = 1; d <= max; d++) {
            if (d >= bestDistance) break;
            if (withinEditDistance(word, candidate, d)) {
                // A tie between two vocabulary words at the same distance is
                // genuinely ambiguous — decline rather than pick one.
                if (d === bestDistance) best = null;
                else { best = candidate; bestDistance = d; }
                break;
            }
        }
    }
    return best;
}

// ── The keyword vocabularies ─────────────────────────────────────────────────

// The verbs that mark a message as describing a transaction. Shared, so the
// SMS classifier and the conversational path tolerate the same typos — a user
// pasting an SMS-derived description and a user typing one out should not get
// different answers.
export const TRANSACTION_VERBS: readonly string[] = [
    'sent', 'paid', 'payment', 'received', 'withdraw', 'withdrew', 'approved',
    'charge', 'charged', 'bought', 'purchased', 'credited', 'debited',
    'deposited', 'transferred', 'refund', 'refunded', 'reversal', 'spent',
    'sold', 'gave', 'settled',
    // Swahili and Sheng, matched at the token level so a code-switched
    // sentence needs no language detection. See parsers/swahili.ts.
    ...SWAHILI_VERBS,
];

// Quantity and filler words, for quantity parsing.
export const QUANTITY_FILLER: readonly string[] = [
    'a', 'an', 'the', 'some', 'few', 'couple', 'half', 'my', 'our',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
];

// The subset a merged word's first half may match — deliberately narrower.
//
// "four", "six", "ten" and "one" are missing on purpose: they open real words
// ("fourteen", "sixteen", "tendencies", "onerous") and including them buys a
// merge nobody types in exchange for mis-splitting words people do.
const SPLITTABLE_FILLER: readonly string[] = [
    'a', 'an', 'the', 'some', 'few', 'couple', 'half', 'my', 'our', 'two', 'three',
];

// ── Merged-word recovery ─────────────────────────────────────────────────────

// Long enough that a run-together pair is likelier than a real word. Below
// this the risk is all downside: "fewer", "tension" and "another" are real.
const MIN_MERGED_LENGTH = 8;

// Consonant pairs that can open an English word. A remainder starting with any
// other consonant pair is not a word, which is what stops "accommodation"
// splitting into "a ccommodation" and "somersaults" into "some rsaults".
const VALID_ONSETS = new Set([
    'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'kn', 'ph',
    'pl', 'pr', 'qu', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
    'th', 'tr', 'tw', 'wh', 'wr', 'sq', 'gn', 'rh',
]);

const VOWEL_RE = /[aeiouy]/;

function isPlausibleWord(word: string): boolean {
    if (word.length < 3) return false;
    if (!VOWEL_RE.test(word)) return false;
    const [a, b] = word;
    if (!VOWEL_RE.test(a) && !VOWEL_RE.test(b) && !VALID_ONSETS.has(a + b)) return false;
    return true;
}

// "somebacon" -> ["some", "bacon"], "afewtomatoes" -> ["a", "few", "tomatoes"].
// null when no split is safe, which is the answer for every genuine long word.
//
// Exactly one strategy, applied repeatedly from the front: peel off a
// quantity/filler word, and require what is left to be a plausible standalone
// word. Nothing more aggressive — a split that merely *could* be right is a
// wrong result stated confidently.
export function splitMergedWord(token: string): string[] | null {
    const word = token.toLowerCase();
    if (word.length < MIN_MERGED_LENGTH || !/^[a-z]+$/.test(word)) return null;

    const parts: string[] = [];
    let rest = word;

    while (parts.length < 3) {
        // Longest filler first, so "three" wins over "the" on "threesodas".
        const prefix = [...SPLITTABLE_FILLER]
            .sort((x, y) => y.length - x.length)
            .find(f => rest.startsWith(f) && rest.length > f.length);
        if (!prefix) break;

        const remainder = rest.slice(prefix.length);
        // A one-letter filler is too weak on its own — "a" prefixes plenty of
        // real words. It only counts when what follows is itself a filler, as
        // in "afewtomatoes", so "accommodation" is never touched.
        const chains = SPLITTABLE_FILLER.some(f => remainder.startsWith(f) && remainder.length > f.length);
        if (prefix.length < 2 && !chains) break;

        parts.push(prefix);
        rest = remainder;
        if (isPlausibleWord(rest) && !chains) break;
    }

    if (parts.length === 0 || !isPlausibleWord(rest)) return null;
    return [...parts, rest];
}

// ── The normalisation pass ───────────────────────────────────────────────────

// A token worth considering at all: letters only, so transaction codes
// ("TFJ8K2L9M1"), amounts and anything with a digit in it are left alone.
const WORD_TOKEN_RE = /[A-Za-z]+/g;

export interface NormalizeOptions {
    // Fuzzy keyword correction. Off unless the caller has already established
    // that the exact match failed — see normalizeForKeywords.
    fuzzyVerbs?: boolean;
}

// Rewrites a message so the parser's existing exact-match machinery sees what
// the user meant. Positions shift, so every downstream stage must read the
// SAME normalised string — which is why callers normalise once at the top and
// pass it on, rather than each extractor doing its own.
export function normalizeKeywords(text: string, opts: NormalizeOptions = {}): string {
    return text.replace(WORD_TOKEN_RE, token => {
        const split = splitMergedWord(token);
        if (split) return split.join(' ');

        if (opts.fuzzyVerbs) {
            const corrected = fuzzyCanonical(token, TRANSACTION_VERBS);
            if (corrected && corrected !== token.toLowerCase()) return corrected;
        }
        return token;
    });
}

// Clause boundaries. Kept as captured separators so rejoining reproduces the
// original string exactly — character offsets matter, because the line-item
// extractor reads amounts by position.
const CLAUSE_RE = /([.,;:!?\n]|\band\b|\bthen\b|\bplus\b)/i;

const VERB_RE = new RegExp(`\\b(?:${TRANSACTION_VERBS.join('|')})\\b`, 'i');

// The pass as the parser actually wants it: merged words always, fuzzy verb
// correction only in a clause that carries no exactly-spelled verb.
//
// That gate is what keeps the mechanism honest. "I sold gold for 5000" already
// has a real verb, so nothing in it is a candidate for correction and "gold"
// cannot become "sold". Only a clause the verb vocabulary failed to recognise
// outright is worth a second, fuzzier look.
//
// Per clause rather than per message, because the two are genuinely different
// questions. "i boought somebacon and pork cuts for 3100, then i bought
// tomatoes" contains a correctly spelled verb — in the other half of the
// sentence, which says nothing about whether "boought" was understood.
export function normalizeForKeywords(text: string): string {
    return text
        .split(CLAUSE_RE)
        // Merged words are recovered everywhere; only the fuzzy pass is gated.
        .map(part => normalizeKeywords(part, { fuzzyVerbs: !VERB_RE.test(part) }))
        .join('');
}
