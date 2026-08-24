import type { DateResult } from '../types';

export type { DateResult };

const MONTH_NAMES: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Slash dates — "21/8/26 at 7:38 PM" or "06/17/2026 at 21:13:10" — the two
// components are disambiguated after matching, not baked into the pattern.
const RE_SLASH =
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s*(?:at\s*)?)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i;

// "01-JUL-2025 21:59:00"
const RE_DASH_MMM = /(\d{1,2})-([A-Za-z]{3,9})-(\d{4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i;

// "12-06-2026 10:27 AM"
const RE_DASH_NUMERIC =
    /(\d{1,2})-(\d{1,2})-(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i;

// "2026-08-21 19:38"
const RE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

// "21 Aug 2026, 19:38" and the ordinal, timeless "21st August 2026"
const RE_LONGFORM =
    /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i;

function normYear(y: number): number {
    return y < 100 ? 2000 + y : y;
}

function to24Hour(hoursRaw: number, ampm?: string): number {
    if (!ampm) return hoursRaw;
    const upper = ampm.toUpperCase();
    let hours = hoursRaw;
    if (upper === 'PM' && hours < 12) hours += 12;
    if (upper === 'AM' && hours === 12) hours = 0;
    return hours;
}

function resolveSlashComponents(a: number, b: number): { day: number; month: number; ambiguous: boolean } {
    if (a > 12) return { day: a, month: b, ambiguous: false };
    if (b > 12) return { day: b, month: a, ambiguous: false };
    return { day: a, month: b, ambiguous: true }; // both ≤ 12 — default DD/MM
}

export function extractDate(msg: string): DateResult | null {
    let result: DateResult | null = null;

    let m = RE_SLASH.exec(msg);
    if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        const year = normYear(parseInt(m[3], 10));
        const { day, month, ambiguous } = resolveSlashComponents(a, b);
        const hours = to24Hour(parseInt(m[4], 10), m[7]);
        const minutes = parseInt(m[5], 10);
        const seconds = m[6] ? parseInt(m[6], 10) : 0;
        result = { date: new Date(year, month - 1, day, hours, minutes, seconds), ambiguous };
    }

    if (!result) {
        m = RE_DASH_MMM.exec(msg);
        if (m) {
            const month = MONTH_NAMES[m[2].toLowerCase()];
            if (month !== undefined) {
                const day = parseInt(m[1], 10);
                const year = parseInt(m[3], 10);
                const hours = to24Hour(parseInt(m[4], 10), m[7]);
                const minutes = parseInt(m[5], 10);
                const seconds = m[6] ? parseInt(m[6], 10) : 0;
                result = { date: new Date(year, month, day, hours, minutes, seconds), ambiguous: false };
            }
        }
    }

    if (!result) {
        m = RE_DASH_NUMERIC.exec(msg);
        if (m) {
            const day = parseInt(m[1], 10);
            const month = parseInt(m[2], 10);
            const year = parseInt(m[3], 10);
            const hours = to24Hour(parseInt(m[4], 10), m[7]);
            const minutes = parseInt(m[5], 10);
            const seconds = m[6] ? parseInt(m[6], 10) : 0;
            result = { date: new Date(year, month - 1, day, hours, minutes, seconds), ambiguous: false };
        }
    }

    if (!result) {
        m = RE_ISO.exec(msg);
        if (m) {
            const year = parseInt(m[1], 10);
            const month = parseInt(m[2], 10);
            const day = parseInt(m[3], 10);
            const hours = parseInt(m[4], 10);
            const minutes = parseInt(m[5], 10);
            const seconds = m[6] ? parseInt(m[6], 10) : 0;
            result = { date: new Date(year, month - 1, day, hours, minutes, seconds), ambiguous: false };
        }
    }

    if (!result) {
        m = RE_LONGFORM.exec(msg);
        if (m) {
            const month = MONTH_NAMES[m[2].toLowerCase()];
            if (month !== undefined) {
                const day = parseInt(m[1], 10);
                const year = parseInt(m[3], 10);
                const hours = m[4] ? to24Hour(parseInt(m[4], 10), m[7]) : 0;
                const minutes = m[5] ? parseInt(m[5], 10) : 0;
                const seconds = m[6] ? parseInt(m[6], 10) : 0;
                result = { date: new Date(year, month, day, hours, minutes, seconds), ambiguous: false };
            }
        }
    }

    if (!result) return null;
    if (Number.isNaN(result.date.getTime())) return null;

    const oneDayMs = 24 * 60 * 60 * 1000;
    if (result.date.getTime() > Date.now() + oneDayMs) return null;
    if (result.date.getFullYear() < 2007) return null;

    return result;
}
