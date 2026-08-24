import type { CodeResult } from '../types';

export type { CodeResult };

export interface CodeContext {
    merchant?: string | null;
    amount?: number | null;
    isoDate?: string | null;
}

const LABELLED_RE =
    /(?:M-?Pesa\s+receipt\s+number\s+is:?|MPESA\s+Ref\.?|Ref(?:erence)?:?|Txn\s*ID:?|Transaction\s+(?:ID|Ref|Code):?)\s*([A-Z0-9]{6,15})/i;

const LEADING_RE = /^([A-Z0-9]{10})\b/i;

const STANDALONE_RE = /\b([A-Z0-9]{8,12})\b/gi;

const CURRENCY_CODES = new Set(['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF']);

function hasLetterAndDigit(token: string): boolean {
    return /[A-Z]/.test(token) && /[0-9]/.test(token);
}

function isPhoneLike(token: string): boolean {
    return /^(?:0?7\d{8}|0?1\d{8}|254[17]\d{8})$/.test(token);
}

function isPureNumber(token: string): boolean {
    return /^\d+$/.test(token);
}

function djb2(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h = h >>> 0;
    }
    return h.toString(36).toUpperCase().slice(0, 6).padStart(6, '0');
}

export function extractCode(msg: string, ctx: CodeContext = {}): CodeResult {
    const labelled = msg.match(LABELLED_RE);
    if (labelled) return { code: labelled[1].toUpperCase(), synthetic: false, label: 'Ref' };

    const leading = msg.match(LEADING_RE);
    if (leading && hasLetterAndDigit(leading[1].toUpperCase())) {
        return { code: leading[1].toUpperCase(), synthetic: false, label: 'Code' };
    }

    STANDALONE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STANDALONE_RE.exec(msg)) !== null) {
        const token = m[1].toUpperCase();
        if (!hasLetterAndDigit(token)) continue;
        if (isPhoneLike(token) || isPureNumber(token)) continue;
        if (CURRENCY_CODES.has(token)) continue;

        const before = msg.slice(Math.max(0, m.index - 20), m.index);
        if (/for account\s*$/i.test(before)) continue;

        // Skip merchant>location reference blobs — not a real txn code
        const after = msg.slice(m.index + m[1].length, m.index + m[1].length + 1);
        if (after === '>') continue;

        return { code: token, synthetic: false, label: 'Code' };
    }

    const seed = `${ctx.merchant ?? ''}|${ctx.amount ?? ''}|${ctx.isoDate ?? ''}`;
    return { code: `AUTO-${djb2(seed)}`, synthetic: true, label: 'Auto ref' };
}
