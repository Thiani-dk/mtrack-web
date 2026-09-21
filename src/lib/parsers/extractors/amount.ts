import type { AmountResult } from '../types';
import { CURRENCY_SUFFIX_SOURCE, DEFAULT_CURRENCY, normalizeCurrency } from './currency';

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
    String.raw`(?:\s*(millions|million|thousands|thousand|mn|k|m)`
    + `(?:(?![A-Za-z])|(?=${CURRENCY_SUFFIX_SOURCE})))?`;
const AMOUNT_RE = new RegExp(
    `(?:(${CURRENCY_SUFFIX_SOURCE})\\s*\\.?\\s*)?(${NUMBER_SOURCE})${MULTIPLIER_SOURCE}\\s*(${CURRENCY_SUFFIX_SOURCE})?`,
    'gi',
);

const SHORTHAND: Record<string, number> = {
    k: 1_000, thousand: 1_000, thousands: 1_000,
    m: 1_000_000, mn: 1_000_000, million: 1_000_000, millions: 1_000_000,
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
const MONEY_CUE_RE =
    /\b(?:for|at|worth|of|each|cost|costs|costing|spent|spend|spending|paid|pay|paying|sold|sell|selling|bought|buy|buying|gave|give|sent|send|received|receive|got|charged|totall?ing|total|around|about|roughly|approx(?:imately)?)\s*$|@\s*$/i;

// A trailing "/=" is how a Kenyan price is written without naming Shillings.
const TRAILING_SLASH_RE = /^\s*\/=/;

// Numbers a cue word can sit next to that are still not money.
const NOT_MONEY_AFTER_RE = /^\s*(?:am|pm|a\.m\.|p\.m\.|o'clock|hrs?|%|x\b|×|pcs?\b|pieces?\b|st\b|nd\b|rd\b|th\b)/i;

// Inside a date, a time or a ratio ("12/09/2026", "at 7:30", "2024-09-11").
const DATE_CHAR_BEFORE_RE = /[/:\-.]$/;
const DATE_CHAR_AFTER_RE = /^[/:]/;

function isBareMoney(msg: string, index: number, length: number): boolean {
    const before = msg.slice(Math.max(0, index - 24), index);
    const after = msg.slice(index + length);

    // "12/09/2026", "7:30" — a number wedged into a date or a time, however
    // money-ish the words around it are.
    if (DATE_CHAR_BEFORE_RE.test(before) || DATE_CHAR_AFTER_RE.test(after)) return false;
    // "around 7pm" is a time, "3 x" is a quantity, "20%" is a rate.
    if (NOT_MONEY_AFTER_RE.test(after)) return false;

    return MONEY_CUE_RE.test(before) || TRAILING_SLASH_RE.test(after);
}

interface Candidate {
    amount: number;
    currency: string;
    // Where the whole "Ksh 5,000" / "5000USD" run sits in the message, so a
    // caller can take the words around it as that amount's description.
    index: number;
    length: number;
    score: number;
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
        if (bare && !(opts.allowBare && isBareMoney(msg, m.index, whole.length))) continue;

        const base = parseFloat(digits.replace(/,/g, ''));
        if (Number.isNaN(base)) continue;
        // A comma-grouped number is already written out in full; "10,000k" is
        // a typo far more often than it is ten million.
        const mult = suffixMult && !digits.includes(',') ? (SHORTHAND[suffixMult.toLowerCase()] ?? 1) : 1;

        const currency = normalizeCurrency(prefix ?? '') ?? normalizeCurrency(suffixCur ?? '') ?? DEFAULT_CURRENCY;
        const score = scoreCandidate(msg, m.index, whole.length);
        candidates.push({ amount: base * mult, currency, index: m.index, length: whole.length, score });
    }
    return candidates;
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
