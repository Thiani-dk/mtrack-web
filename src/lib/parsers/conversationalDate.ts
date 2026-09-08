import { extractDate } from './extractors/date';

// A deliberately lenient date reader for TYPED input only.
//
// extractors/date.ts is built against SMS confirmations, which always carry a
// clock time ("...on 21/8/26 at 7:38 PM"). Five of its six patterns require
// that time, so nothing a person actually types conversationally — "March 13,
// 2026", "9/2/2026", "3rd March" — parses at all. That made three of the four
// document types unusable without an SMS in hand.
//
// This module is separate on purpose. The SMS extractor's strictness is a
// correctness feature there (it must not invent dates out of reference numbers
// and balances), so it stays exactly as it is; this parser is only ever fed a
// short answer to "when was that?".

export interface ConversationalDateResult {
    date: Date | null;
    // 'exact'               — understood; still echo `interpretation` for confirmation
    // 'needs_clarification' — a real reading exists but it isn't safe to assume; ask `reason`
    // 'invalid'             — resolved, then rejected by the bounds rules; state `reason`
    confidence: 'exact' | 'needs_clarification' | 'invalid';
    reason: string | null;
    interpretation: string | null;
}

// Exported so ChatScreen and the fixtures reference the same copy.
export const DATE_REASON_FUTURE =
    "That's in the future. I can only log things that already happened.";
export const DATE_REASON_TOO_OLD =
    "That's more than a year back. I can only track the last 12 months.";
export const DATE_REASON_WEEKEND =
    'Which day, roughly? Saturday or Sunday?';
export const DATE_REASON_LAST_WEEK =
    'Which day last week?';
export const DATE_REASON_UNREADABLE =
    "I couldn't work out a date from that. Try something like '13 March' or '4 days ago'.";
export const DATE_REASON_NO_DAY =
    'Which day of that month?';

const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
    dec: 11, december: 11,
};

const MONTH_TOKEN =
    /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)\b\.?/i;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const WORD_ORDINALS: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20, 'twenty-first': 21, 'twenty-second': 22,
    'twenty-third': 23, 'twenty-fourth': 24, 'twenty-fifth': 25, 'twenty-sixth': 26,
    'twenty-seventh': 27, 'twenty-eighth': 28, 'twenty-ninth': 29, thirtieth: 30,
    'thirty-first': 31,
};

// Noon, so a date can never slide a day under a DST shift.
function atNoon(y: number, monthIndex: number, day: number): Date {
    return new Date(y, monthIndex, day, 12, 0, 0, 0);
}

function startOfDay(d: Date): Date {
    const c = new Date(d);
    c.setHours(12, 0, 0, 0);
    return c;
}

function describe(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysInMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

// 1.3 — with no year given, take the most recent occurrence that isn't in the
// future. "March 13" on 8 Sep 2026 means 2026, not 2027.
function inferYear(monthIndex: number, day: number, now: Date): number {
    const thisYear = now.getFullYear();
    const candidate = atNoon(thisYear, monthIndex, day);
    return candidate.getTime() > startOfDay(now).getTime() ? thisYear - 1 : thisYear;
}

const ok = (date: Date, extra?: Partial<ConversationalDateResult>): ConversationalDateResult => ({
    date, confidence: 'exact', reason: null, interpretation: describe(date), ...extra,
});
const ask = (reason: string, date: Date | null = null): ConversationalDateResult => ({
    date, confidence: 'needs_clarification', reason,
    interpretation: date ? describe(date) : null,
});
const bad = (reason: string, date: Date | null = null): ConversationalDateResult => ({
    date, confidence: 'invalid', reason, interpretation: date ? describe(date) : null,
});

// 1.4 — no resolved date is accepted without passing both bounds.
function boundsFailure(d: Date, now: Date): string | null {
    const day = startOfDay(d).getTime();
    const today = startOfDay(now).getTime();
    if (day > today) return DATE_REASON_FUTURE;
    const floor = startOfDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())).getTime();
    if (day < floor) return DATE_REASON_TOO_OLD;
    return null;
}

function withinBounds(d: Date, now: Date): boolean {
    return boundsFailure(d, now) === null;
}

// Runs on every resolved date, whatever produced it.
function applyBounds(result: ConversationalDateResult, now: Date): ConversationalDateResult {
    if (!result.date || result.confidence === 'invalid') return result;
    const failure = boundsFailure(result.date, now);
    return failure ? bad(failure, result.date) : result;
}

// ── Relative phrasing ────────────────────────────────────────────────────────

function parseRelative(t: string, now: Date): ConversationalDateResult | null {
    // Explicitly forward-looking wording is rejected before anything else tries
    // to read a day out of it.
    if (/\b(tomorrow|next\s+(?:week|month|year)|next\s+(?:sun|mon|tues|wednes|thurs|fri|satur)day)\b/.test(t)) {
        return bad(DATE_REASON_FUTURE);
    }

    // Weekend before week, so "last weekend" isn't swallowed by "last week".
    if (/\b(?:over|during|at|on)?\s*(?:the\s+)?(?:last\s+|this\s+|past\s+)?weekend\b/.test(t)) {
        return ask(DATE_REASON_WEEKEND);
    }
    if (/\blast\s+week\b/.test(t) || /\bthis\s+week\b/.test(t)) {
        return ask(DATE_REASON_LAST_WEEK);
    }

    if (/\b(today|just now|this morning|this afternoon|this evening|tonight|earlier today)\b/.test(t)) {
        return ok(startOfDay(now));
    }
    if (/\byesterday\b/.test(t)) {
        return ok(startOfDay(new Date(now.getTime() - 86400000)));
    }
    if (/\bday before yesterday\b/.test(t)) {
        return ok(startOfDay(new Date(now.getTime() - 2 * 86400000)));
    }

    const daysAgo = t.match(/\b(\d{1,4})\s+days?\s+ago\b/);
    if (daysAgo) {
        return ok(startOfDay(new Date(now.getTime() - Number(daysAgo[1]) * 86400000)));
    }
    const weeksAgo = t.match(/\b(?:(\d{1,3})|a|one)\s+weeks?\s+ago\b/);
    if (weeksAgo) {
        const n = weeksAgo[1] ? Number(weeksAgo[1]) : 1;
        return ok(startOfDay(new Date(now.getTime() - n * 7 * 86400000)));
    }
    const monthsAgo = t.match(/\b(?:(\d{1,3})|a|one)\s+months?\s+ago\b/);
    if (monthsAgo) {
        const n = monthsAgo[1] ? Number(monthsAgo[1]) : 1;
        const d = new Date(now);
        d.setMonth(d.getMonth() - n);
        return ok(startOfDay(d));
    }

    // Any weekday reference resolves to its most recent PAST occurrence, which
    // is what "last Saturday" means and the only safe reading of a bare one.
    const weekday = t.match(/\b(?:last|on|this|past)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekday) {
        const target = WEEKDAYS.indexOf(weekday[1]);
        let delta = (now.getDay() - target + 7) % 7;
        if (delta === 0) delta = 7;
        return ok(startOfDay(new Date(now.getTime() - delta * 86400000)));
    }

    return null;
}

// ── Month-name forms ─────────────────────────────────────────────────────────
// Located by finding the month token, then reading the day off whichever side
// carries it. Far steadier than one regex trying to cover "March 13, 2026",
// "13 March 2026", "the third of September" and "Sept 1" at once.

function parseMonthName(raw: string, now: Date): ConversationalDateResult | null {
    const m = MONTH_TOKEN.exec(raw);
    if (!m) return null;
    const monthIndex = MONTHS[m[1].toLowerCase()];
    if (monthIndex === undefined) return null;

    const before = raw.slice(0, m.index);
    const after = raw.slice(m.index + m[0].length);

    let day: number | null = null;

    // "13 March", "3rd March", "the third of September", "13th of March"
    const numericBefore = before.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?\s*$/i);
    if (numericBefore) day = parseInt(numericBefore[1], 10);
    if (day == null) {
        // Drop a trailing "of" first ("the third of September") so the ordinal
        // word itself is the last token to match against.
        const beforeWords = before.replace(/\s+of\s*$/i, ' ');
        const wordBefore = beforeWords.match(/(?:^|\s)(?:the\s+)?([a-z]+(?:[-\s][a-z]+)?)\s*$/i);
        if (wordBefore) {
            const key = wordBefore[1].toLowerCase().replace(/\s+/g, '-');
            if (WORD_ORDINALS[key] !== undefined) day = WORD_ORDINALS[key];
        }
    }

    // "March 13", "September 1", "Sept 1". Anchored so a bare year ("March
    // 2026") can never be misread as a day.
    if (day == null) {
        const numericAfter = after.match(/^[\s,]*(\d{1,2})(?:st|nd|rd|th)?(?!\d)/);
        if (numericAfter) day = parseInt(numericAfter[1], 10);
    }
    if (day == null) {
        const wordAfter = after.match(/^[\s,]*(?:the\s+)?([a-z]+(?:[-\s][a-z]+)?)\b/i);
        if (wordAfter) {
            const key = wordAfter[1].toLowerCase().replace(/\s+/g, '-');
            if (WORD_ORDINALS[key] !== undefined) day = WORD_ORDINALS[key];
        }
    }

    const yearMatch = raw.match(/\b(\d{4})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    if (day == null) {
        // A month with no day. Real reading, but not one to assume.
        return ask(DATE_REASON_NO_DAY);
    }
    if (day < 1 || day > daysInMonth(year ?? now.getFullYear(), monthIndex)) {
        return ask(DATE_REASON_UNREADABLE);
    }

    const resolvedYear = year ?? inferYear(monthIndex, day, now);
    return ok(atNoon(resolvedYear, monthIndex, day));
}

// ── Numeric forms ────────────────────────────────────────────────────────────

const NUMERIC_DATE = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\b/;

function normYear(y: number): number {
    return y < 100 ? 2000 + y : y;
}

function parseNumeric(raw: string, now: Date): ConversationalDateResult | null {
    const m = NUMERIC_DATE.exec(raw);
    if (!m) return null;

    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const year = m[3] ? normYear(parseInt(m[3], 10)) : null;

    // Build a date for one reading, or null if that reading isn't a real day.
    const reading = (dayPart: number, monthPart: number): Date | null => {
        if (monthPart < 1 || monthPart > 12) return null;
        const monthIndex = monthPart - 1;
        const y = year ?? inferYear(monthIndex, dayPart, now);
        if (dayPart < 1 || dayPart > daysInMonth(y, monthIndex)) return null;
        return atNoon(y, monthIndex, dayPart);
    };

    const dayFirst = reading(a, b);   // Kenyan convention: DD/MM
    const monthFirst = reading(b, a); // the US reading: MM/DD

    if (!dayFirst && !monthFirst) return ask(DATE_REASON_UNREADABLE);
    if (dayFirst && !monthFirst) return applyBounds(ok(dayFirst), now);
    if (monthFirst && !dayFirst) return applyBounds(ok(monthFirst), now);
    // "3/3/2026" — both readings land on the same day, so nothing to ask.
    if (dayFirst!.getTime() === monthFirst!.getTime()) return applyBounds(ok(dayFirst!), now);

    // Both are real days. If only one of them also falls inside the accepted
    // window, the ambiguity is already settled — take it rather than asking a
    // question whose other answer we would have to reject anyway.
    const dayFirstOk = withinBounds(dayFirst!, now);
    const monthFirstOk = withinBounds(monthFirst!, now);
    if (dayFirstOk && !monthFirstOk) return ok(dayFirst!);
    if (monthFirstOk && !dayFirstOk) return ok(monthFirst!);
    if (!dayFirstOk && !monthFirstOk) return bad(boundsFailure(dayFirst!, now)!, dayFirst!);

    // Genuinely two-way: name both readings rather than silently picking one.
    return ask(`Is that ${describe(dayFirst!)} or ${describe(monthFirst!)}?`, dayFirst!);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function parseConversationalDate(input: string, now: Date = new Date()): ConversationalDateResult {
    const raw = (input ?? '').trim();
    if (!raw) return ask(DATE_REASON_UNREADABLE);
    const lower = raw.toLowerCase();

    const relative = parseRelative(lower, now);
    if (relative) return applyBounds(relative, now);

    const monthForm = parseMonthName(raw, now);
    if (monthForm) return applyBounds(monthForm, now);

    const numericForm = parseNumeric(raw, now);
    if (numericForm) return applyBounds(numericForm, now);

    // Last resort: someone pasted something SMS-shaped into the answer.
    const viaSms = extractDate(raw);
    if (viaSms) {
        const r: ConversationalDateResult = viaSms.ambiguous
            ? ask(`Is that ${describe(viaSms.date)}, read day-first?`, viaSms.date)
            : ok(viaSms.date);
        return applyBounds(r, now);
    }

    return ask(DATE_REASON_UNREADABLE);
}
