import type { ParsedTransaction } from '../../types';
import { hasUsableDate } from '../transactionDisplay';

// "How much did I spend this month?"
//
// Answered only from what is actually on the device, and only from documents
// the user approved. The standing pipeline rule holds without exception: a
// point_of_sale receipt is money a CUSTOMER spent, and an on_behalf_of claim is
// money that will be paid back. Counting either as the user's own spending
// would produce a figure that is simply wrong, and wrong with confidence.
//
// Nothing here estimates. Where the stored data cannot answer the period asked
// for, the answer says so and gives the nearest period it CAN answer exactly.
// An approximate total in a tool whose whole claim is accuracy would be worse
// than no answer.

// One spent line, flattened out of an approved document.
export interface SpentLine {
    date: Date;
    amount: number;
    currency: string;
    // What the line was against, for a merchant filter.
    payee: string;
}

export type Period =
    | { kind: 'this-month' }
    | { kind: 'last-month' }
    | { kind: 'named-month'; month: number; year: number | null }
    | { kind: 'today' }
    | { kind: 'total' }
    // Asked for, and not stored: week boundaries are not kept.
    | { kind: 'this-week' }
    | { kind: 'last-week' };

export interface SpendingQuestion {
    period: Period;
    // A merchant the question named, when it named one.
    merchant: string | null;
}

const MONTHS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
];

// Whether a message is asking what they spent, rather than telling us.
//
// Requires both a spending word and a quantity word, so "I spent 500 on lunch"
// is never mistaken for a question about the past.
const ASKS_TOTAL_RE =
    /\bhow much (?:did|have) i (?:spend|spent|paid|pay)\b|\bhow much (?:have )?i(?:'ve)? spent\b|\bwhat(?:'s| is| did) my (?:total|spending|spend)\b|\bmy total (?:so far|spending|spend)\b|\btotal so far\b|\bhow much in total\b|\bwhat have i spent\b|\bhow much did i use\b/i;

export function isSpendingQuestion(text: string): boolean {
    return ASKS_TOTAL_RE.test(text.trim());
}

// What period, and what filter, the question is asking about.
export function readSpendingQuestion(text: string, now: Date): SpendingQuestion | null {
    if (!isSpendingQuestion(text)) return null;
    const t = text.trim().toLowerCase();

    // Read off the ORIGINAL text, not the lowercased copy, so a merchant name
    // comes back with the capitals the user typed and is not printed back at
    // them as "naivas".
    const merchantMatch = /\b(?:at|on|with|to)\s+([A-Za-z][A-Za-z0-9'&. -]{2,28}?)\s*(?:this|last|in|\?|$)/i
        .exec(text.trim());
    const merchant = merchantMatch ? merchantMatch[1].trim() : null;

    const named = MONTHS.findIndex(m => new RegExp(String.raw`\bin ${m}\b|\b${m}\b`).test(t));
    if (/\btoday\b/.test(t)) return { period: { kind: 'today' }, merchant };
    if (/\blast month\b/.test(t)) return { period: { kind: 'last-month' }, merchant };
    if (/\bthis month\b/.test(t)) return { period: { kind: 'this-month' }, merchant };
    if (/\blast week\b/.test(t)) return { period: { kind: 'last-week' }, merchant };
    if (/\bthis week\b/.test(t)) return { period: { kind: 'this-week' }, merchant };
    if (named >= 0) {
        const yearMatch = /\b(20\d{2})\b/.exec(t);
        return {
            period: { kind: 'named-month', month: named, year: yearMatch ? Number(yearMatch[1]) : null },
            merchant,
        };
    }
    void now;
    return { period: { kind: 'total' }, merchant };
}

// ── Answering ───────────────────────────────────────────────────────────────

export interface SpendingAnswer {
    kind:
        // An exact figure for the period asked for.
        | 'exact'
        // An exact figure, but for a different period than the one asked for,
        // because the one asked for is not stored.
        | 'nearest'
        // Nothing is saved yet.
        | 'none'
        // Saved documents exist, but none in the period asked for.
        | 'noneInPeriod';
    total: number;
    currency: string;
    lineCount: number;
    // The period actually answered, in plain words.
    periodLabel: string;
    // The period asked for, when it differs from the one answered.
    askedLabel: string | null;
    merchant: string | null;
}

function monthLabel(d: Date): string {
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

interface Window {
    from: Date | null;
    to: Date | null;
    label: string;
}

function windowFor(period: Period, now: Date): Window {
    switch (period.kind) {
        case 'today': {
            const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return { from, to: new Date(from.getTime() + 86400000), label: 'today' };
        }
        case 'this-month':
            return {
                from: startOfMonth(now),
                to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
                label: monthLabel(now),
            };
        case 'last-month': {
            const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { from, to: startOfMonth(now), label: monthLabel(from) };
        }
        case 'named-month': {
            const year = period.year ?? (period.month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
            const from = new Date(year, period.month, 1);
            return { from, to: new Date(year, period.month + 1, 1), label: monthLabel(from) };
        }
        // Week boundaries are not stored, so these never produce a window of
        // their own; the caller falls back to the month. See DECISIONS.md D5.
        case 'this-week':
        case 'last-week':
        case 'total':
        default:
            return { from: null, to: null, label: 'all time' };
    }
}

const WEEKLY: ReadonlySet<Period['kind']> = new Set(['this-week', 'last-week']);

// Flattens the transactions of approved own-spending documents into spent
// lines. Money IN is excluded: a refund is not spending, and adding it to the
// total would overstate what left their hands.
export function spentLines(transactions: ParsedTransaction[]): SpentLine[] {
    return transactions
        .filter(t => !t.excludedFromReceipt)
        .filter(t => t.type === 'sent')
        .filter(hasUsableDate)
        .map(t => ({
            date: t.date,
            amount: t.amount,
            currency: t.currency,
            payee: t.merchant ?? t.recipient ?? '',
        }));
}

export function answerSpending(
    question: SpendingQuestion, lines: SpentLine[], now: Date,
): SpendingAnswer {
    const byMerchant = question.merchant
        ? lines.filter(l => l.payee.toLowerCase().includes(question.merchant!.toLowerCase()))
        : lines;

    if (lines.length === 0) {
        return {
            kind: 'none', total: 0, currency: 'KES', lineCount: 0,
            periodLabel: '', askedLabel: null, merchant: question.merchant,
        };
    }

    // A week is not something the stored data can cut on, so the nearest exact
    // period is the month, and the answer says which it gave.
    const asksWeek = WEEKLY.has(question.period.kind);
    const window = asksWeek ? windowFor({ kind: 'this-month' }, now) : windowFor(question.period, now);

    const inWindow = byMerchant.filter(l =>
        (!window.from || l.date >= window.from) && (!window.to || l.date < window.to));

    const total = Math.round(inWindow.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const currency = inWindow[0]?.currency ?? byMerchant[0]?.currency ?? 'KES';

    if (inWindow.length === 0) {
        return {
            kind: 'noneInPeriod', total: 0, currency, lineCount: 0,
            periodLabel: window.label, askedLabel: asksWeek ? 'that week' : null,
            merchant: question.merchant,
        };
    }

    return {
        kind: asksWeek ? 'nearest' : 'exact',
        total,
        currency,
        lineCount: inWindow.length,
        periodLabel: window.label,
        askedLabel: asksWeek ? 'that week' : null,
        merchant: question.merchant,
    };
}
