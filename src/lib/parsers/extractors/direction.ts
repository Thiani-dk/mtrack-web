import type { DirectionResult } from '../types';

export type { DirectionResult };

interface Keyword {
    re: RegExp;
    type: 'sent' | 'received';
    weight: number;
}

const KEYWORDS: Keyword[] = [
    { re: /has been credited/i, type: 'received', weight: 3 },
    { re: /you have received/i, type: 'received', weight: 3 },
    { re: /received\s+ksh/i, type: 'received', weight: 3 },
    { re: /credited(?:\s+with)?/i, type: 'received', weight: 2 },
    { re: /deposited/i, type: 'received', weight: 2 },
    { re: /refund/i, type: 'received', weight: 2 },
    { re: /reversal/i, type: 'received', weight: 2 },

    { re: /card\s*payment/i, type: 'sent', weight: 3 },
    { re: /sent to/i, type: 'sent', weight: 3 },
    { re: /paid to/i, type: 'sent', weight: 3 },
    { re: /you bought/i, type: 'sent', weight: 2 },
    { re: /withdraw/i, type: 'sent', weight: 2 },
    { re: /debited/i, type: 'sent', weight: 2 },
    { re: /purchase/i, type: 'sent', weight: 2 },
    { re: /transferred to/i, type: 'sent', weight: 2 },
    { re: /give\b.*cash to/i, type: 'sent', weight: 2 },
    { re: /payment of/i, type: 'sent', weight: 2 },
];

export function extractDirection(msg: string): DirectionResult {
    let best: { type: 'sent' | 'received'; score: number; index: number } | null = null;

    for (const kw of KEYWORDS) {
        const m = kw.re.exec(msg);
        if (!m) continue;
        const positionBonus = m.index < 30 ? 1 : 0;
        const score = kw.weight + positionBonus;
        if (!best || score > best.score || (score === best.score && m.index < best.index)) {
            best = { type: kw.type, score, index: m.index };
        }
    }

    if (!best) return { type: 'sent', confidence: 30 };
    const confidence = Math.min(95, 50 + best.score * 10);
    return { type: best.type, confidence };
}
