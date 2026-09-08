import type { ParsedTransaction, ConfidenceResult } from './types';
import { applyProviderHint } from './hints/providerHints';

export type { ConfidenceResult };

// Direction and amount are no longer scored merely for *existing* — they are
// scored by how the value was actually established. This is what makes the
// 'low' tier reachable and stops a silent guess reading as a certainty.
//
//   direction:  balance/keyword -> 15   structural -> 10   unresolved -> 0 (+missing)
//   amount:     verified/normal -> 30    balanceMismatch -> 15 (+missing)   absent -> 0 (+missing)
const WEIGHTS = { amount: 30, amountMismatch: 15, date: 25, directionFull: 15, directionStructural: 10, party: 15, code: 10, channel: 5 };

export function scoreTransaction(t: Partial<ParsedTransaction>): ConfidenceResult {
    let score = 0;
    const missing: string[] = [];

    // ── amount ──
    if (typeof t.amount === 'number' && !Number.isNaN(t.amount)) {
        if (t.balanceMismatch) {
            score += WEIGHTS.amountMismatch;
            missing.push('amount'); // the balance says this number is probably wrong
        } else {
            score += WEIGHTS.amount;
        }
    } else {
        missing.push('amount');
    }

    // ── date ──
    if (t.date instanceof Date && !Number.isNaN(t.date.getTime())) {
        score += WEIGHTS.date;
    } else {
        missing.push('date');
    }

    // ── direction — weighted by how it was resolved ──
    switch (t.directionSource) {
        case 'balance':
        case 'keyword':
            score += WEIGHTS.directionFull;
            break;
        case 'structural':
            score += WEIGHTS.directionStructural;
            break;
        default: // 'unresolved' or unset
            missing.push('direction');
    }

    // ── party ──
    const hasParty =
        (typeof t.sender === 'string' && t.sender.length > 0) ||
        (typeof t.recipient === 'string' && t.recipient.length > 0 && t.recipient !== 'Unknown');
    if (hasParty) {
        score += WEIGHTS.party;
    } else {
        missing.push('party');
    }

    // ── code ──
    if (typeof t.transactionCode === 'string' && t.transactionCode.length > 0 && !t.codeIsSynthetic) {
        score += WEIGHTS.code;
    } else {
        missing.push('code');
    }

    // ── channel ──
    const hasChannel =
        (typeof t.provider === 'string' && t.provider !== 'Unknown') ||
        (typeof t.method === 'string' && t.method !== 'transfer');
    if (hasChannel) {
        score += WEIGHTS.channel;
    } else {
        missing.push('channel');
    }

    const level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 75 ? 'medium' : 'low';
    return { score, missing, level };
}

// scoreTransaction + the provider-hint boost + the two level overrides that
// live outside the raw score (a mid-sentence truncation, and an unresolved
// direction). The single place a transaction's confidence is decided — used
// both when a transaction is first finalised and when the balance oracle
// revises it. `rawBlock` is the source text (for the hint and the truncation
// check).
export function scoreWithContext(t: Partial<ParsedTransaction>, rawBlock: string): ConfidenceResult {
    const base = scoreTransaction(t);
    const boost = applyProviderHint(rawBlock, t.provider ?? 'Unknown');
    const score = Math.min(100, base.score + boost);
    let level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 75 ? 'medium' : 'low';

    const trimmed = rawBlock.trim();
    if (/[A-Za-z]$/.test(trimmed) && !/[.!?)"']$/.test(trimmed)) level = 'low';
    if (t.directionUnresolved) level = 'low';

    return { score, missing: base.missing, level };
}
