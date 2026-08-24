import type { AmountResult } from '../types';

export type { AmountResult };

const CURRENCY_MAP: Record<string, string> = {
    ksh: 'KES', kes: 'KES', '$': 'USD', usd: 'USD',
    eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP',
    tzs: 'TZS', ugx: 'UGX', rwf: 'RWF',
};

const AMOUNT_RE = /(Ksh\.?|KES|USD|EUR|GBP|TZS|UGX|RWF|\$|£|€)\s*\.?\s*([\d,]+(?:\.\d{1,2})?)/gi;

const POSITIVE_CONTEXT =
    /\b(sent|paid|received|bought|give|withdraw|transfer(?:red)?|of|you have (?:sent|paid|received))\b/i;
const NEGATIVE_CONTEXT =
    /\b(balance|transaction cost|transact within the day|limit|charge|fee|avail(?:able)?\s*bal)\b/i;

function currencyKey(sym: string): string {
    return sym.toLowerCase().replace(/\.$/, '');
}

interface Candidate {
    amount: number;
    currency: string;
    index: number;
    score: number;
}

function scoreCandidate(msg: string, matchIndex: number, matchLength: number): number {
    const before = msg.slice(Math.max(0, matchIndex - 40), matchIndex);
    const after = msg.slice(matchIndex + matchLength, matchIndex + matchLength + 40);
    const context = `${before} ${after}`;

    let score = 0;
    if (POSITIVE_CONTEXT.test(context)) score += 2;
    if (NEGATIVE_CONTEXT.test(context)) score -= 3;
    if (matchIndex < 40) score += 1;
    return score;
}

export function extractAmount(msg: string): AmountResult | null {
    const candidates: Candidate[] = [];
    AMOUNT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = AMOUNT_RE.exec(msg)) !== null) {
        const amount = parseFloat(m[2].replace(/,/g, ''));
        if (Number.isNaN(amount)) continue;
        const currency = CURRENCY_MAP[currencyKey(m[1])] ?? 'KES';
        const score = scoreCandidate(msg, m.index, m[0].length);
        candidates.push({ amount, currency, index: m.index, score });
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const best = candidates[0];
    if (best.score < 0) return null;

    const confidence = best.score >= 2 ? 95 : best.score === 1 ? 80 : 60;
    return { amount: best.amount, currency: best.currency, confidence };
}

const FEE_RE = /(?:transaction cost|charge(?:d)?\s*(?:of)?|fee)\s*[,:]?\s*(?:Ksh\.?|KES)?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function extractFee(msg: string): number | null {
    const m = msg.match(FEE_RE);
    if (!m) return null;
    const fee = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(fee) ? null : fee;
}

const BALANCE_RE =
    /(?:new\s+)?(?:m-?pesa\s+)?(?:balance|avail(?:able)?\s*bal)(?:\s+is)?[,:\s]*(?:Ksh\.?|KES)?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function extractBalance(msg: string): number | null {
    const m = msg.match(BALANCE_RE);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    return Number.isNaN(v) ? null : v;
}
