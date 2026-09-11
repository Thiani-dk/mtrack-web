import type { ParsedTransaction } from '../types';
import { extractRawBlock, finalizeTransaction, deriveSubType } from './parsers';
import { extractAmount } from './parsers/extractors/amount';
import { DEFAULT_CURRENCY, detectCurrency } from './parsers/extractors/currency';
import { parseAmountAnswer } from './parsers/extractors/numeric';
import { extractParties } from './parsers/extractors/parties';
import { extractCode } from './parsers/extractors/code';
import { extractDirection } from './parsers/extractors/direction';
import { parseConversationalDate, type ConversationalDateResult } from './parsers/conversationalDate';
import { fmtAmountProse, hasUsableDate } from './transactionDisplay';
import type { DirectionResult } from './parsers/types';

export type { DirectionResult, ConversationalDateResult };
export { parseConversationalDate };

// Conversational entry runs through the SAME classify -> extract -> score
// components as SMS input (extractRawBlock / finalizeTransaction and the
// individual extractors). This module is the conversational glue around them:
// a relaxed confidence bar, a relative-date reader ("today", "yesterday"), and
// a light name heuristic for phrasing the SMS extractors were never built for
// ("I paid Kevin 500"). It does not re-implement any extractor.

// Which currency a transaction under construction is in, and whether anyone
// actually said so.
//
// The two are not the same fact, and conflating them is how "100k USD" was
// confirmed back as "Ksh 100". `code` is always a usable ISO code; `explicit`
// says whether it came from the user or from the KES default. A default is
// only ever allowed to reach the user inside a sentence that names it as an
// assumption — see the confirmation copy in ChatScreen.
export interface CurrencyLock {
    code: string;
    explicit: boolean;
}

export const UNSTATED_CURRENCY: CurrencyLock = { code: DEFAULT_CURRENCY, explicit: false };

// Folds one more message into the lock. The first explicit mention anywhere in
// the conversation wins and is never overwritten by a later silent message —
// that silence is the user carrying on in the currency they already named, not
// switching to Shillings.
export function lockCurrency(current: CurrencyLock, text: string): CurrencyLock {
    if (current.explicit) return current;
    const found = detectCurrency(text);
    return found ? { code: found, explicit: true } : current;
}

// The lock for a whole conversation so far, scanned oldest message first.
// Equivalent to folding lockCurrency over the turns, and used where the full
// transcript is to hand rather than one message at a time.
export function currencyFromConversation(texts: string[]): CurrencyLock {
    return texts.reduce(lockCurrency, UNSTATED_CURRENCY);
}

export interface DescriptionResult {
    amount: number | null;
    // The effective currency: what was detected, or the KES default.
    currency: string;
    // The currency the user actually stated in THIS message, or null if they
    // stated none. The caller folds it into the conversation-wide lock.
    detectedCurrency: string | null;
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

    // A currency stated anywhere in the sentence counts, whether or not it sat
    // next to the amount the extractor settled on ("I sold it at 5000, USD of
    // course"). Only a token the user actually typed sets detectedCurrency —
    // the extractors' own KES fallback must not masquerade as a statement.
    const detectedCurrency = detectCurrency(text);
    const currency = detectedCurrency ?? DEFAULT_CURRENCY;
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
        detectedCurrency,
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

// Reads the answer to "How much was it?".
//
// This path used to strip the string of everything but digits and take the
// first run of them, which turned "100k USD" into 100 and threw the currency
// away. It now goes through the same shorthand parser and the same currency
// recognition as every other path.
export interface AmountAnswer {
    amount: number | null;
    // Stated in this answer, if it was. null means "say nothing about it" —
    // the caller keeps whatever the conversation already locked in.
    detectedCurrency: string | null;
}

export function parseAmountReply(text: string): AmountAnswer {
    return { amount: parseAmountAnswer(text), detectedCurrency: detectCurrency(text) };
}

// ── The confirmation sentence ────────────────────────────────────────────────

// What the user is actually being asked to agree to. Lives here, not in the
// component, because it is the last thing standing between a misread figure
// and a saved record — it needs to be testable on its own.
export interface ConfirmFields {
    amount: number | null;
    currency: CurrencyLock;
    recipient: string | null;
    direction: DirectionResult;
    purposeLabel: string | null;
    dateLabel: string | null;
    dateSkipped: boolean;
}

export function buildConfirmSentence(f: ConfirmFields): string {
    const money = (n: number) => fmtAmountProse(n, f.currency.code);

    // Don't imply a direction we haven't resolved — "money in or out?" is
    // asked separately, right after this line.
    const lead = f.direction.source === 'unresolved'
        ? `${money(f.amount ?? 0)}, ${f.recipient}`
        : `${money(f.amount ?? 0)} ${f.direction.type === 'received' ? 'from' : 'to'} ${f.recipient}`;

    const parts = [lead];
    if (f.purposeLabel) parts.push(`for ${f.purposeLabel}`);
    // The date is never accepted silently either: the parser's own reading of
    // it is echoed here, inside the confirmation that already exists, rather
    // than as a second question.
    if (f.dateLabel) parts.push(`on ${f.dateLabel}`);
    else if (f.dateSkipped) parts.push('with no date');

    return `${parts.join(', ')}${assumedCurrencyNote(f.currency)}. Right?`;
}

// A currency nobody mentioned is an assumption, and an assumption the user
// cannot see is one they cannot correct — which is precisely how a USD amount
// came to be filed as Shillings. Stated inside the confirmation rather than as
// an extra question, so the common case costs no additional turn.
export function assumedCurrencyNote(currency: CurrencyLock): string {
    return currency.explicit ? '' : " — I've assumed Kenyan Shillings, since none was mentioned";
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
