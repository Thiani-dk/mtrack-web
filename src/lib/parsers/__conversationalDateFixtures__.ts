// Every phrase named in the conversational-date spec, as named cases.
// All relative cases are evaluated against NOW so the suite is stable.

export const NOW = new Date('2026-09-30T10:00:00');  // a Wednesday

export interface ConversationalDateFixture {
    id: string;
    input: string;
    expect: 'exact' | 'needs_clarification' | 'invalid';
    // For 'exact' cases: the calendar day the parser must land on, as YYYY-MM-DD.
    expectDay?: string;
    // For 'needs_clarification' / 'invalid': a substring the reason must contain.
    reasonContains?: string;
    note?: string;
}

export const CONVERSATIONAL_DATE_FIXTURES: ConversationalDateFixture[] = [
    // ── Month name, with or without year ──
    { id: 'month-day-no-year', input: 'September 1', expect: 'exact', expectDay: '2026-09-01' },
    { id: 'month-day-year-comma', input: 'March 13, 2026', expect: 'exact', expectDay: '2026-03-13' },
    { id: 'day-month-year', input: '13 March 2026', expect: 'exact', expectDay: '2026-03-13' },
    { id: 'abbrev-month-day', input: 'Sept 1', expect: 'exact', expectDay: '2026-09-01' },

    // ── Ordinals ──
    { id: 'ordinal-day-month', input: '3rd March', expect: 'exact', expectDay: '2026-03-03' },
    { id: 'ordinal-day-month-year', input: '9th September, 2026', expect: 'exact', expectDay: '2026-09-09' },
    { id: 'ordinal-abbrev-month', input: '1st Sept', expect: 'exact', expectDay: '2026-09-01' },
    { id: 'word-ordinal-of-month', input: 'the third of September', expect: 'exact', expectDay: '2026-09-03' },

    // ── Numeric, multiple separators ──
    {
        id: 'numeric-slash-ambiguous', input: '9/2/2026', expect: 'needs_clarification',
        reasonContains: 'February',
        note: 'Both components <= 12 — must ask, never silently pick a reading.',
    },
    {
        id: 'numeric-dot-one-reading-valid', input: '3.12.2026', expect: 'exact', expectDay: '2026-03-12',
        note: 'Reads as 3 Dec 2026 or 12 Mar 2026. 3 Dec is still in the future, so only one reading survives the bounds check and the ambiguity settles itself.',
    },
    { id: 'numeric-dash-unambiguous', input: '13-03-2026', expect: 'exact', expectDay: '2026-03-13' },

    // ── Relative ──
    { id: 'today', input: 'today', expect: 'exact', expectDay: '2026-09-30' },
    { id: 'yesterday', input: 'yesterday', expect: 'exact', expectDay: '2026-09-29' },
    { id: 'four-days-ago', input: '4 days ago', expect: 'exact', expectDay: '2026-09-26' },
    { id: 'one-day-ago', input: '1 day ago', expect: 'exact', expectDay: '2026-09-29' },
    {
        id: 'last-saturday', input: 'last Saturday', expect: 'exact', expectDay: '2026-09-26',
        note: 'NOW is Wednesday 30 Sep 2026; the most recent Saturday is the 26th.',
    },

    // ── Vague, must ask rather than guess or fail ──
    { id: 'over-the-weekend', input: 'over the weekend', expect: 'needs_clarification', reasonContains: 'Saturday or Sunday' },
    { id: 'last-week', input: 'last week', expect: 'needs_clarification', reasonContains: 'Which day' },
    { id: 'nonsense', input: 'asdkjfh nonsense', expect: 'needs_clarification', reasonContains: "couldn't work out a date" },

    // ── Bounds ──
    {
        id: 'future-phrase', input: 'a date next month', expect: 'invalid', reasonContains: 'in the future',
        note: 'Forward-looking wording is rejected outright.',
    },
    { id: 'future-explicit', input: '1 December 2026', expect: 'invalid', reasonContains: 'in the future' },
    { id: 'future-tomorrow', input: 'tomorrow', expect: 'invalid', reasonContains: 'in the future' },
    {
        id: 'too-old-phrase', input: '14 months ago', expect: 'invalid', reasonContains: 'more than a year back',
        note: 'A date from 14 months ago is outside the 12-month window.',
    },
    { id: 'too-old-explicit', input: '3 July 2025', expect: 'invalid', reasonContains: 'more than a year back' },
];
