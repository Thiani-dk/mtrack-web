import type { ParsedTransaction } from '../types';
import { extractRawBlock, finalizeTransaction, deriveSubType } from './parsers';
import { extractAmount } from './parsers/extractors/amount';
import { extractDate } from './parsers/extractors/date';
import { extractParties } from './parsers/extractors/parties';
import { extractCode } from './parsers/extractors/code';

// Conversational entry runs through the SAME classify -> extract -> score
// components as SMS input (extractRawBlock / finalizeTransaction and the
// individual extractors). This module is the conversational glue around them:
// a relaxed confidence bar, a relative-date reader ("today", "yesterday"), and
// a light name heuristic for phrasing the SMS extractors were never built for
// ("I paid Kevin 500"). It does not re-implement any extractor.

export interface DescriptionResult {
    amount: number | null;
    currency: string;
    recipient: string | null;
    purposeLabel: string | null;
    date: Date | null;
    dateAmbiguous: boolean;
    // 'high'   — amount, recipient and date all present, confirm and wait for yes
    // 'partial'— some fields present, ask for the rest one at a time
    // 'none'   — nothing usable, start the questions from scratch
    confidence: 'high' | 'partial' | 'none';
    missing: Array<'amount' | 'recipient' | 'date'>;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfDay(d: Date): Date {
    const c = new Date(d);
    c.setHours(12, 0, 0, 0);
    return c;
}

// "today" / "yesterday" / "3 days ago" / "last friday" / "on monday", plus a
// fall-through to the SMS date extractor for anything calendar-shaped.
export function parseConversationalDate(text: string, now: Date = new Date()): { date: Date; ambiguous: boolean } | null {
    const t = text.toLowerCase();

    if (/\b(today|just now|this morning|this afternoon|tonight|earlier today)\b/.test(t)) {
        return { date: startOfDay(now), ambiguous: false };
    }
    if (/\byesterday\b/.test(t)) {
        return { date: startOfDay(new Date(now.getTime() - 86400000)), ambiguous: false };
    }
    const daysAgo = t.match(/\b(\d{1,2})\s+days?\s+ago\b/);
    if (daysAgo) {
        return { date: startOfDay(new Date(now.getTime() - Number(daysAgo[1]) * 86400000)), ambiguous: false };
    }
    if (/\b(a|one)\s+week\s+ago\b/.test(t)) {
        return { date: startOfDay(new Date(now.getTime() - 7 * 86400000)), ambiguous: false };
    }
    const weekday = t.match(/\b(?:last|on|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekday) {
        const target = WEEKDAYS.indexOf(weekday[1]);
        let delta = (now.getDay() - target + 7) % 7;
        if (delta === 0) delta = 7;
        return { date: startOfDay(new Date(now.getTime() - delta * 86400000)), ambiguous: false };
    }

    const viaExtractor = extractDate(text);
    if (viaExtractor) return { date: viaExtractor.date, ambiguous: viaExtractor.ambiguous };
    return null;
}

// A trailing "for <purpose>" / "for a <purpose>" clause, when present.
function extractPurpose(text: string): string | null {
    const m = text.match(/\bfor\s+(?:a\s+|an\s+|the\s+|my\s+|his\s+|her\s+|their\s+)?([a-z][\w' -]{1,60}?)(?:[.,]|\s+(?:on|yesterday|today|last|cash|by mpesa|via)\b|$)/i);
    if (!m) return null;
    const p = m[1].trim().replace(/\s+/g, ' ');
    if (/^account\b/i.test(p)) return null;
    return p.length >= 2 ? p : null;
}

// "paid Kevin", "gave Mary", "to James", "sent to Achieng" — a capitalised name
// token after a payment verb or preposition. Deliberately conservative.
function extractFreeformName(text: string): string | null {
    const m = text.match(/\b(?:paid|pay|gave|give|sent to|sent|to|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/);
    if (!m) return null;
    const name = m[1].trim();
    // Reject month names and other common non-name capitalised words.
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December|Ksh|Ksh)$/i.test(name)) {
        return null;
    }
    return name;
}

export function extractDescription(text: string, now: Date = new Date()): DescriptionResult {
    // Run both the full SMS path (at a relaxed bar, for anyone who pasted a
    // real confirmation) and the individual extractors, then take the best of
    // each field.
    const raw = extractRawBlock(text, 0);
    const finalized = finalizeTransaction(raw, 20);
    const amountResult = extractAmount(text);
    const parties = extractParties(text);
    const dateResult = parseConversationalDate(text, now);

    const finalizedName =
        finalized && finalized.recipient && finalized.recipient !== 'Unknown' ? finalized.recipient : null;

    const amount = (finalized && finalized.amount > 0 ? finalized.amount : null) ?? amountResult?.amount ?? null;
    const currency = finalized?.currency ?? amountResult?.currency ?? 'KES';
    const recipient = finalizedName ?? parties.recipient ?? parties.sender ?? extractFreeformName(text);
    const date = finalized?.date ?? dateResult?.date ?? null;
    const dateAmbiguous = finalized?.dateAmbiguous ?? dateResult?.ambiguous ?? false;

    const missing: Array<'amount' | 'recipient' | 'date'> = [];
    if (amount == null || amount <= 0) missing.push('amount');
    if (!recipient) missing.push('recipient');
    if (!date) missing.push('date');

    return {
        amount,
        currency,
        recipient,
        purposeLabel: extractPurpose(text),
        date,
        dateAmbiguous,
        confidence: missing.length === 0 ? 'high' : missing.length >= 3 ? 'none' : 'partial',
        missing,
    };
}

// Builds a self-reported ParsedTransaction from captured conversational
// fields. subType is derived the same way the main pipeline does it.
export function buildSelfReportedTransaction(fields: {
    amount: number;
    currency?: string;
    recipient: string;
    date: Date;
    dateAmbiguous?: boolean;
    purposeLabel?: string | null;
    type?: 'sent' | 'received';
}): ParsedTransaction {
    const type = fields.type ?? 'sent';
    const method = 'transfer';
    const codeResult = extractCode('', { merchant: null, amount: fields.amount, isoDate: fields.date.toISOString() });

    return {
        date: fields.date,
        time: fields.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
        type,
        subType: deriveSubType(method, type, false, fields.recipient),
        amount: fields.amount,
        recipient: fields.recipient,
        transactionCode: codeResult.code,
        balance: null,
        transactionCost: null,
        rawLine: '',
        label: null,
        customLabel: null,
        receiptLabel: null,
        excludedFromReceipt: false,

        currency: fields.currency ?? 'KES',
        sender: type === 'received' ? fields.recipient : null,
        account: null,
        provider: 'Self-reported',
        method,
        merchant: null,
        merchantCategory: null,
        location: null,
        isBusiness: false,

        confidence: 100,
        confidenceLevel: 'high',
        missingFields: [],
        codeIsSynthetic: codeResult.synthetic,
        dateAmbiguous: fields.dateAmbiguous ?? false,
        failed: false,
        isHold: false,
        isVerificationCharge: false,
        cardLast4: null,

        dataSource: 'self_reported',
        lineItems: null,
        purposeLabel: fields.purposeLabel ?? null,
    };
}
