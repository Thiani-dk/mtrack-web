// Numeric shorthand, shared by every path that reads an amount out of typed
// text.
//
// "100k USD" being read as 100 is the kind of error that survives
// confirmation, because the confirmation sentence looks plausible. So the
// multiplier is part of the number here, not an afterthought applied by one
// caller and forgotten by another.
//
// The multiplier must be adjacent to the number it multiplies — attached
// ("100k"), or separated by nothing but spaces ("100 k", "100 thousand"). A k
// or an m elsewhere in the sentence is just a letter: "5000 for the kiosk" is
// five thousand, not five million.

import { CURRENCY_SUFFIX_SOURCE } from './currency';

export interface NumericToken {
    value: number;
    // Where the numeric token starts and ends in the source text, multiplier
    // included — callers pair it with a currency token by position.
    start: number;
    end: number;
    // Whether a shorthand multiplier was applied, for tests and diagnostics.
    multiplier: 1 | 1_000 | 1_000_000;
}

const MULTIPLIERS: Record<string, 1_000 | 1_000_000> = {
    k: 1_000, thousand: 1_000, thousands: 1_000,
    m: 1_000_000, million: 1_000_000, millions: 1_000_000, mn: 1_000_000,
};

// A number, optionally comma-grouped and/or decimal, optionally followed by a
// shorthand multiplier. The multiplier alternatives are ordered longest-first
// so "million" is not consumed as a bare "m" with "illion" left over.
// The multiplier ends where a letter does not follow — except that a currency
// code may run straight on from it ("100kUSD"), which is still a multiplier
// and a currency, not a word. The number itself carries no trailing boundary:
// "5000USD" must not require one, or the whole token fails to match.
const MULT_GUARD = `(?:(?![A-Za-z])|(?=${CURRENCY_SUFFIX_SOURCE}))`;
const NUMBER_RE = new RegExp(
    String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`
    + `(?:\\s*(millions|million|thousands|thousand|mn|k|m)${MULT_GUARD})?`,
    'gi',
);

function applyMultiplier(digits: string, suffix: string | undefined): NumericToken['multiplier'] {
    if (!suffix) return 1;
    const mult = MULTIPLIERS[suffix.toLowerCase()];
    if (!mult) return 1;
    // A comma-grouped number is already written out in full — "10,000k" is far
    // more likely a typo than ten million, so the multiplier is not applied to
    // one. Shorthand is for short numbers.
    if (digits.includes(',')) return 1;
    return mult;
}

// Every number in the text, with shorthand resolved, in order.
export function parseNumericTokens(text: string): NumericToken[] {
    const out: NumericToken[] = [];
    NUMBER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMBER_RE.exec(text)) !== null) {
        const base = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isNaN(base)) continue;
        const multiplier = applyMultiplier(m[1], m[2]);
        // The match only extends to the multiplier when one was actually
        // applied; otherwise a trailing letter stays available to whatever
        // reads the rest of the token (a currency code, say).
        const end = multiplier === 1 ? m.index + m[1].length : m.index + m[0].length;
        out.push({ value: base * multiplier, start: m.index, end, multiplier });
    }
    return out;
}

// The first number in the text with shorthand resolved, or null.
export function parseNumeric(text: string): number | null {
    return parseNumericTokens(text)[0]?.value ?? null;
}

// Parses a standalone amount answer — the reply to "How much was it?". The
// whole string is expected to be about one amount ("100k USD", "Ksh 45,000",
// "about 5.5k"), so the first number wins.
export function parseAmountAnswer(text: string): number | null {
    const value = parseNumeric(text);
    return value != null && value > 0 ? value : null;
}
