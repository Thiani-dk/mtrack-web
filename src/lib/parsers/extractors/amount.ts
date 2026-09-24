import type { AmountResult } from '../types';
import { CURRENCY_SUFFIX_SOURCE, DEFAULT_CURRENCY, normalizeCurrency } from './currency';
import { isPartySpan } from '../names';

export type { AmountResult };

// An amount is a number with a currency token on one side of it. M-Pesa always
// writes the code first ("Ksh1,000.00"); people typing write it either way
// ("5000USD", "10k USD"), and the shorthand multiplier belongs to the number
// (see numeric.ts) rather than to whichever caller happens to read it.
//
// A currency token on one side or the other is required by default. Every bare
// number in an SMS is something else — a balance, a reference, a date — so
// matching those would cost far more than it gained. Typed input is the
// opposite case and opts in; see AmountScanOptions below.
const NUMBER_SOURCE = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
// A multiplier ends where a letter does not follow, or where a currency code
// runs straight on from it ("100kUSD").
const MULTIPLIER_SOURCE =
    String.raw`(?:\s*(millions|million|thousands|thousand|elfu|mia|mn|k|m)`
    + `(?:(?![A-Za-z])|(?=${CURRENCY_SUFFIX_SOURCE})))?`;
const AMOUNT_RE = new RegExp(
    `(?:(${CURRENCY_SUFFIX_SOURCE})\\s*\\.?\\s*)?(${NUMBER_SOURCE})${MULTIPLIER_SOURCE}\\s*(${CURRENCY_SUFFIX_SOURCE})?`,
    'gi',
);

const SHORTHAND: Record<string, number> = {
    k: 1_000, thousand: 1_000, thousands: 1_000,
    m: 1_000_000, mn: 1_000_000, million: 1_000_000, millions: 1_000_000,
    // Swahili, normalised into this form upstream: "elfu tatu" arrives as
    // "3 elfu". See parsers/swahili.ts.
    elfu: 1_000, mia: 100,
};

const POSITIVE_CONTEXT =
    /\b(sent|paid|received|bought|give|withdraw|transfer(?:red)?|of|you have (?:sent|paid|received))\b/i;
const NEGATIVE_CONTEXT =
    /\b(balance|transaction cost|transact within the day|limit|charge|fee|avail(?:able)?\s*bal|fuliza|outstanding|interest)\b/i;

// ── Bare numbers, for typed input only ───────────────────────────────────────

// M-Pesa always writes the code ("Ksh1,000.00"), so requiring one costs SMS
// nothing. People typing do not: "i bought somebacon and pork cuts for 3100,
// ... at 400 ... airtime worth 30" carries three amounts and not one currency
// token, and the requirement silently reduced that whole message to nothing —
// no amounts, so no itemisation, so a flow that asked "How much was it?" about
// a message that had already said so three times.
//
// So a bare number counts, but only where the sentence itself marks it as
// money: a cue word immediately before it, or a Kenyan "/=" immediately after.
// This is opt-in (`allowBare`) and off by default — the SMS pipeline keeps the
// strict rule, where bare numbers really are balances, reference numbers and
// dates.
export interface AmountScanOptions {
    allowBare?: boolean;
}

// "for 3100", "at 400", "worth 30", "spent 2000", "cost 750", "@ 120".
//
// "came to 250" is on the list as a phrase rather than by adding "to" on its
// own: a bare "to" sits in front of a great many numbers that are not prices.
// Without it a paragraph-length shopping list lost one item's price entirely,
// and the orphaned clause was then carried forward as the description of the
// NEXT item — a total short by Ksh 250 with nothing to show anything had gone.
const MONEY_CUE_RE =
    /\b(?:for|at|worth|of|each|cost|costs|costing|spent|spend|spending|paid|pay|paying|sold|sell|selling|bought|buy|buying|gave|give|sent|send|received|receive|got|charged|totall?ing|total|around|about|roughly|approx(?:imately)?)\s*$|@\s*$|\b(?:came|comes|come|add(?:s|ed)?\s+up|amount(?:s|ed|ing)?)\s+to\s*$/i;

// A trailing "/=" or "/-" is how a Kenyan price is written without naming
// Shillings. Both forms are common; only the first was ever listed, and even
// that one never fired — see isBareMoney.
const TRAILING_SLASH_RE = /^\s*\/[=-](?!\d)/;

// The name of whoever the money went to, sitting between the cue word and the
// figure: "paid Kevin 500", "sent Mama Njeri 1,200".
//
// This is probably the commonest way an English sentence states a payment, and
// the cue rule — which tolerates whitespace and nothing else — refused every
// one of them. "paid the 500" failed for the same reason, which is what
// confirmed it was distance and not anything about names.
//
// Deliberately only a name. The adjacency rule is what stops reference codes,
// times, years and quantities being read as money, and a widened window of
// characters would let all of those back. A capitalised run that could be a
// person is a narrow, checkable exception; "the" is not, and still fails.
// Whether a money cue word governs the figure that follows `before`.
//
// Spans of one, two and three words are each tried, because a party can be
// "Kevin", "Mama Njeri" or "my landlord" and the cue has to reach past all of
// it. Every word of the span has to belong to the party — "paid Kevin Tuesday
// 500" must not become five hundred.
function cueReaches(before: string): boolean {
    if (MONEY_CUE_RE.test(before)) return true;

    const words = before.replace(/\s+$/, '').split(/\s+/).filter(Boolean);
    for (let n = 1; n <= Math.min(3, words.length); n++) {
        const span = words.slice(words.length - n).join(' ');
        if (!isPartySpan(span)) continue;
        if (MONEY_CUE_RE.test(words.slice(0, words.length - n).join(' '))) return true;
    }
    return false;
}

// Numbers a cue word can sit next to that are still not money.
const NOT_MONEY_AFTER_RE = /^\s*(?:am|pm|a\.m\.|p\.m\.|o'clock|hrs?|%|x\b|×|pcs?\b|pieces?\b|st\b|nd\b|rd\b|th\b)/i;

// Inside a date, a time or a ratio ("12/09/2026", "at 7:30", "2024-09-11").
const DATE_CHAR_BEFORE_RE = /[/:\-.]$/;
const DATE_CHAR_AFTER_RE = /^[/:]/;

function isBareMoney(msg: string, index: number, length: number): boolean {
    // Wide enough to hold a cue word and the longest name span allowed after
    // it. The window is only a bound on the search, not on what counts: the
    // patterns below are anchored to the end of it.
    const before = msg.slice(Math.max(0, index - 64), index);
    const after = msg.slice(index + length);

    // "500/=" says money and nothing else, so it is settled before the date
    // guard rather than after it. Checked in the other order — which is how it
    // was written — the slash reads as a date separator and returns false, and
    // the branch below it was unreachable: "lunch 500/= and beer 300/="
    // extracted no amount at all.
    if (TRAILING_SLASH_RE.test(after)) return true;

    // "12/09/2026", "7:30" — a number wedged into a date or a time, however
    // money-ish the words around it are.
    if (DATE_CHAR_BEFORE_RE.test(before) || DATE_CHAR_AFTER_RE.test(after)) return false;
    // "around 7pm" is a time, "3 x" is a quantity, "20%" is a rate.
    if (NOT_MONEY_AFTER_RE.test(after)) return false;
    // A digit glued to the end of a word is part of that word, not a sum:
    // "QGH4R7TY9P" is a reference code, and its 4 is not four shillings. A
    // currency written against the number ("Ksh500") is matched as a
    // currency-tagged amount and never reaches this bare-number path.
    if (/[A-Za-z]$/.test(before)) return false;

    return cueReaches(before);
}

interface Candidate {
    amount: number;
    currency: string;
    // Where the whole "Ksh 5,000" / "5000USD" run sits in the message, so a
    // caller can take the words around it as that amount's description.
    index: number;
    length: number;
    score: number;
    // Whether it was written with no currency token, and so depends on the
    // sentence marking it as money. Only those can be misread as counts.
    bare: boolean;
}

// One currency-tagged amount, located in the text.
export interface AmountMatch extends AmountResult {
    index: number;
    length: number;
}

function scoreCandidate(msg: string, matchIndex: number, matchLength: number): number {
    const before = msg.slice(Math.max(0, matchIndex - 40), matchIndex);
    const after = msg.slice(matchIndex + matchLength, matchIndex + matchLength + 40);
    const context = `${before} ${after}`;

    let score = 0;
    if (POSITIVE_CONTEXT.test(context)) score += 2;
    if (NEGATIVE_CONTEXT.test(context)) score -= 3;
    if (matchIndex < 40) score += 1;
    return score;
}

function confidenceOf(score: number): number {
    return score >= 2 ? 95 : score === 1 ? 80 : 60;
}

// Every currency-tagged amount in the message, in order, with its position —
// the building block for both the single best amount below and the line-item
// itemisation in conversationalCapture.
export function extractAmountMatches(msg: string, opts: AmountScanOptions = {}): AmountMatch[] {
    return scanAmounts(msg, opts).map(c => ({
        amount: c.amount,
        currency: c.currency,
        confidence: confidenceOf(c.score),
        index: c.index,
        length: c.length,
    }));
}

export function extractAmountCandidates(msg: string, opts: AmountScanOptions = {}): AmountResult[] {
    return extractAmountMatches(msg, opts).map(({ amount, currency, confidence }) => ({ amount, currency, confidence }));
}

function scanAmounts(msg: string, opts: AmountScanOptions = {}): Candidate[] {
    const candidates: Candidate[] = [];
    AMOUNT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AMOUNT_RE.exec(msg)) !== null) {
        const [whole, prefix, digits, suffixMult, suffixCur] = m;
        // Guard against the optional-everything pattern matching nothing.
        if (!whole) { AMOUNT_RE.lastIndex++; continue; }
        // A number with no currency on either side is not an amount — unless
        // the caller reads typed input and the sentence marks it as money.
        const bare = !prefix && !suffixCur;
        // A bare number carrying a multiplier is a quantity of money by
        // construction — "10k", "3 elfu", "mia tano". No cue word needed.
        const carriesMultiplier = Boolean(suffixMult);
        if (bare && !(opts.allowBare && (carriesMultiplier || isBareMoney(msg, m.index, whole.length)))) continue;

        const base = parseFloat(digits.replace(/,/g, ''));
        if (Number.isNaN(base)) continue;
        // A comma-grouped number is already written out in full; "10,000k" is
        // a typo far more often than it is ten million.
        const mult = suffixMult && !digits.includes(',') ? (SHORTHAND[suffixMult.toLowerCase()] ?? 1) : 1;

        const currency = normalizeCurrency(prefix ?? '') ?? normalizeCurrency(suffixCur ?? '') ?? DEFAULT_CURRENCY;
        const score = scoreCandidate(msg, m.index, whole.length);
        candidates.push({ amount: base * mult, currency, index: m.index, length: whole.length, score, bare });
    }
    return dropCounts(msg, candidates);
}

// Words that can follow a number without the number being a count of them:
// prepositions and conjunctions that join it to something else, and the time
// words a date phrase is built from. "3 chapati" counts chapati; "20 for", "50
// yesterday" and "3 days" count nothing.
const NOT_A_COUNTED_THING =
    /^(?:for|at|worth|of|each|and|or|to|on|in|from|per|a|an|the|plus|na|kwa|more|less|about|around)$/i;
const TIME_WORD =
    /^(?:today|yesterday|tomorrow|day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes|am|pm|oclock)$/i;

// "sold 3 chapati for 150" is a hundred and fifty shillings, not three.
//
// The cue-word rule has no way to tell a count from a sum: "sold" sits right
// before the 3, so the 3 qualifies as money, scores as well as the 150 and wins
// on position. A receipt for that sale read TOTAL PAID Ksh 3.00.
//
// A small number followed by the thing it counts is a count — but only where
// something else in the message can be the price. Without that second
// candidate the count reading would leave the message with no amount at all,
// and "spent 50 yesterday" really is fifty. Two readings compete; the count
// only wins when the price reading is still available elsewhere.
function dropCounts(msg: string, candidates: Candidate[]): Candidate[] {
    return candidates.filter((c, i) => {
        if (!c.bare || c.amount > 99 || !Number.isInteger(c.amount)) return true;
        // Something after it has to be able to carry the price.
        if (!candidates.some((other, j) => j > i && other.index > c.index)) return true;
        // The match may already have eaten the space after the digits — the
        // pattern allows for a currency token there and consumes the gap
        // whether or not one turns up.
        const [, next] = msg.slice(c.index + c.length).match(/^\s*([a-z][a-z-]*)/i) ?? [];
        if (!next || NOT_A_COUNTED_THING.test(next) || TIME_WORD.test(next)) return true;
        return false;
    });
}

export function extractAmount(msg: string, opts: AmountScanOptions = {}): AmountResult | null {
    const candidates = scanAmounts(msg, opts);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const best = candidates[0];
    if (best.score < 0) return null;

    return { amount: best.amount, currency: best.currency, confidence: confidenceOf(best.score) };
}

const FEE_RE = /(?:transaction cost|charge(?:d)?\s*(?:of)?|fee)\s*[,:]?\s*(?:Ksh\.?|KES)?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function extractFee(msg: string): number | null {
    const m = msg.match(FEE_RE);
    if (!m) return null;
    const fee = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(fee) ? null : fee;
}

const BALANCE_RE =
    /(?:new\s+)?(?:m-?pesa\s+)?(?:balance|avail(?:able)?\s*bal)(?:\s+is)?[,:\s]*(?:Ksh\.?|KES)?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function extractBalance(msg: string): number | null {
    const m = msg.match(BALANCE_RE);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(v) ? null : v;
}
