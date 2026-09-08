import type { ParsedTransaction } from '../types';
import { extractRawBlock, finalizeTransaction, deriveSubType } from './parsers';
import { extractAmount } from './parsers/extractors/amount';
import { extractParties } from './parsers/extractors/parties';
import { extractCode } from './parsers/extractors/code';
import { extractDirection } from './parsers/extractors/direction';
import { parseConversationalDate, type ConversationalDateResult } from './parsers/conversationalDate';
import { hasUsableDate } from './transactionDisplay';
import type { DirectionResult } from './parsers/types';

export type { DirectionResult, ConversationalDateResult };
export { parseConversationalDate };

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
    // The full verdict from the conversational date parser, so the caller can
    // echo `interpretation` back for confirmation, ask `reason` when it needs
    // clarifying, or refuse an out-of-bounds date. Never silently accepted.
    dateResult: ConversationalDateResult;
    // Direction resolved from the typed text by the SAME layered oracle the
    // SMS pipeline uses (extractDirection), with a light conversational verb
    // nudge for phrasing it was never built for ("paid Kevin 500"). source
    // 'unresolved' means the caller must ask, never silently default to sent.
    direction: DirectionResult;
    // 'high'   — amount, recipient and date all present, confirm and wait for yes
    // 'partial'— some fields present, ask for the rest one at a time
    // 'none'   — nothing usable, start the questions from scratch
    confidence: 'high' | 'partial' | 'none';
    missing: Array<'amount' | 'recipient' | 'date'>;
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

// The SMS direction oracle handles house-style confirmations. Free typing is
// different: "paid Kevin 500", "gave mum 2k", "Jane sent me 800" carry a clear
// direction in the verb, with no "to your account" structure and often no
// currency token for the structural layer to bite on. Consulted ONLY when
// extractDirection comes back unresolved, so it never overrides a real signal.
function conversationalDirectionHint(text: string): DirectionResult | null {
    const t = ` ${text.toLowerCase()} `;

    // Money coming to the user.
    if (/\b(?:paid|sent|gave|owed|repaid|refunded|wired)\s+me\b/.test(t) || /\bpay(?:ing|s)?\s+me\b/.test(t)) {
        return { type: 'received', confidence: 95, source: 'keyword' };
    }
    if (/\b(?:received|receive|got|collected|earned|invoiced)\b/.test(t) && /\bfrom\b/.test(t)) {
        return { type: 'received', confidence: 95, source: 'keyword' };
    }
    if (/\b(?:received|receive|got\s+paid|was\s+paid|were\s+paid)\b/.test(t)) {
        return { type: 'received', confidence: 95, source: 'keyword' };
    }

    // Money leaving the user.
    if (/\b(?:i\s+)?(?:paid|pay|paying|sent|send|sending|gave|give|giving|spent|spend|spending|bought|buy|buying|settled|settle)\b/.test(t)) {
        return { type: 'sent', confidence: 95, source: 'keyword' };
    }

    return null;
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

    // Direction: the shared oracle first, the conversational verb nudge only if
    // it could not decide. Never a silent default.
    const oracleDirection = extractDirection(text);
    const direction: DirectionResult = oracleDirection.source === 'unresolved'
        ? (conversationalDirectionHint(text) ?? oracleDirection)
        : oracleDirection;

    const finalizedName =
        finalized && finalized.recipient && finalized.recipient !== 'Unknown' ? finalized.recipient : null;

    const amount = (finalized && finalized.amount > 0 ? finalized.amount : null) ?? amountResult?.amount ?? null;
    const currency = finalized?.currency ?? amountResult?.currency ?? 'KES';
    const recipient = finalizedName ?? parties.recipient ?? parties.sender ?? extractFreeformName(text);

    // A pasted confirmation that fully parsed already carries a trustworthy
    // date; otherwise the conversational reader has the say. A date is only
    // taken as final when it came back 'exact' — anything else is handed up so
    // the caller can ask, never quietly accepted.
    const fromSms = finalized?.date ?? null;
    const date = fromSms ?? (dateResult.confidence === 'exact' ? dateResult.date : null);
    const dateAmbiguous = fromSms
        ? (finalized?.dateAmbiguous ?? false)
        : dateResult.confidence === 'needs_clarification' && dateResult.date != null;

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
        dateResult,
        direction,
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
    // The resolved direction. Omitted means "nothing was said" -> unresolved,
    // exactly as the SMS path treats a signal-free message. No silent 'sent'.
    direction?: DirectionResult;
}): ParsedTransaction {
    const direction: DirectionResult = fields.direction ?? { type: 'sent', confidence: 30, source: 'unresolved' };
    const type = direction.type;
    const directionUnresolved = direction.source === 'unresolved';
    const method = 'transfer';
    // The date may deliberately be an invalid Date — the capture flow offers to
    // leave it off rather than guess. Nothing downstream may call toISOString
    // or toLocaleTimeString on one of those without checking first.
    const dated = hasUsableDate({ date: fields.date });
    const codeResult = extractCode('', {
        merchant: null,
        amount: fields.amount,
        isoDate: dated ? fields.date.toISOString() : null,
    });

    return {
        date: fields.date,
        time: dated ? fields.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }) : '',
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

        // A self-reported line is otherwise taken at face value (100/high).
        // An unresolved direction is the one thing that drops it to low and
        // marks it for a question, exactly as finalizeTransaction does for SMS.
        confidence: directionUnresolved ? 30 : 100,
        confidenceLevel: directionUnresolved ? 'low' : 'high',
        missingFields: directionUnresolved ? ['direction'] : [],
        codeIsSynthetic: codeResult.synthetic,
        dateAmbiguous: fields.dateAmbiguous ?? false,
        failed: false,
        isHold: false,
        isVerificationCharge: false,
        cardLast4: null,
        fulizaAmount: null,
        reversalOf: null,
        isReversed: false,
        amountVerified: false,
        balanceMismatch: false,
        directionSource: directionUnresolved ? 'unresolved' : direction.source,
        directionDisputed: false,
        directionUnresolved,

        dataSource: 'self_reported',
        lineItems: null,
        purposeLabel: fields.purposeLabel ?? null,
    };
}
