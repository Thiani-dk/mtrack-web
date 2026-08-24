import type { ParsedTransaction, ConfidenceResult } from './types';

export type { ConfidenceResult };

const WEIGHTS = { amount: 30, date: 25, direction: 15, party: 15, code: 10, channel: 5 };

export function scoreTransaction(t: Partial<ParsedTransaction>): ConfidenceResult {
    let score = 0;
    const missing: string[] = [];

    if (typeof t.amount === 'number' && !Number.isNaN(t.amount)) {
        score += WEIGHTS.amount;
    } else {
        missing.push('amount');
    }

    if (t.date instanceof Date && !Number.isNaN(t.date.getTime())) {
        score += WEIGHTS.date;
    } else {
        missing.push('date');
    }

    if (t.type === 'sent' || t.type === 'received') {
        score += WEIGHTS.direction;
    } else {
        missing.push('direction');
    }

    const hasParty =
        (typeof t.sender === 'string' && t.sender.length > 0) ||
        (typeof t.recipient === 'string' && t.recipient.length > 0 && t.recipient !== 'Unknown');
    if (hasParty) {
        score += WEIGHTS.party;
    } else {
        missing.push('party');
    }

    if (typeof t.transactionCode === 'string' && t.transactionCode.length > 0 && !t.codeIsSynthetic) {
        score += WEIGHTS.code;
    } else {
        missing.push('code');
    }

    const hasChannel =
        (typeof t.provider === 'string' && t.provider !== 'Unknown') ||
        (typeof t.method === 'string' && t.method !== 'transfer');
    if (hasChannel) {
        score += WEIGHTS.channel;
    } else {
        missing.push('channel');
    }

    // amount+date+direction are effectively unconditional (30+25+15=70 floor
    // for any constructed transaction — direction always resolves to sent or
    // received, never absent), so the medium floor sits above that 70, not
    // at the naive halfway point. Otherwise "low" is unreachable dead code.
    const level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 75 ? 'medium' : 'low';
    return { score, missing, level };
}
