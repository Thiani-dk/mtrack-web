import type { AmountResult } from '../types';
import { CURRENCY_SUFFIX_SOURCE, DEFAULT_CURRENCY, normalizeCurrency } from './currency';

export type { AmountResult };

// An amount is a number with a currency token on one side of it. M-Pesa always
// writes the code first ("Ksh1,000.00"); people typing write it either way
// ("5000USD", "10k USD"), and the shorthand multiplier belongs to the number
// (see numeric.ts) rather than to whichever caller happens to read it.
//
// A currency token on one side or the other is still required. Every bare
// number in a payment message is something else — a balance, a reference, a
// date — so matching those would cost far more than it gained.
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
export function extractAmountMatches(msg: string): AmountMatch[] {
    return scanAmounts(msg).map(c => ({
        amount: c.amount,
        currency: c.currency,
        confidence: confidenceOf(c.score),
        index: c.index,
        length: c.length,
    }));
}

export function extractAmountCandidates(msg: string): AmountResult[] {
    return extractAmountMatches(msg).map(({ amount, currency, confidence }) => ({ amount, currency, confidence }));
}

function scanAmounts(msg: string): Candidate[] {
    const candidates: Candidate[] = [];
    AMOUNT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AMOUNT_RE.exec(msg)) !== null) {
        const [whole, prefix, digits, suffixMult, suffixCur] = m;
        // Guard against the optional-everything pattern matching nothing.
        if (!whole) { AMOUNT_RE.lastIndex++; continue; }
        // A number with no currency on either side is not an amount.
        if (!prefix && !suffixCur) continue;

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

export function extractAmount(msg: string): AmountResult | null {
    const candidates = scanAmounts(msg);
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
