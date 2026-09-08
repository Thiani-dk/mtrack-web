import type { DirectionResult } from '../types';

export type { DirectionResult };

interface Keyword {
    re: RegExp;
    type: 'sent' | 'received';
    weight: number;
}

// Vocabulary layer. Widened opportunistically (it costs nothing), but the
// structural layer below is what actually generalises across banks — a verb
// list is whack-a-mole.
const KEYWORDS: Keyword[] = [
    { re: /has been credited/i, type: 'received', weight: 3 },
    { re: /credited to your/i, type: 'received', weight: 3 },
    { re: /you have received/i, type: 'received', weight: 3 },
    { re: /received\s+ksh/i, type: 'received', weight: 3 },
    { re: /received into/i, type: 'received', weight: 3 },
    { re: /paid into your/i, type: 'received', weight: 3 },
    { re: /deposited to your/i, type: 'received', weight: 3 },
    { re: /credited(?:\s+with)?/i, type: 'received', weight: 2 },
    { re: /deposited/i, type: 'received', weight: 2 },
    { re: /refund(?:ed)?(?:\s+to)?/i, type: 'received', weight: 2 },
    { re: /reversal/i, type: 'received', weight: 2 },
    { re: /disbursed to/i, type: 'received', weight: 2 },
    { re: /top(?:ped)?[ -]?up/i, type: 'received', weight: 2 },

    { re: /card\s*payment/i, type: 'sent', weight: 3 },
    { re: /you have sent/i, type: 'sent', weight: 3 },
    { re: /sent to/i, type: 'sent', weight: 3 },
    { re: /debited from your/i, type: 'sent', weight: 3 },
    { re: /paid to/i, type: 'sent', weight: 3 },
    { re: /\bsent\b\s+(?:ksh|kes)/i, type: 'sent', weight: 2 },
    { re: /you bought/i, type: 'sent', weight: 2 },
    { re: /withdraw/i, type: 'sent', weight: 2 },
    { re: /debited/i, type: 'sent', weight: 2 },
    { re: /charged to your/i, type: 'sent', weight: 2 },
    { re: /purchase/i, type: 'sent', weight: 2 },
    { re: /transferred to/i, type: 'sent', weight: 2 },
    { re: /give\b.*cash to/i, type: 'sent', weight: 2 },
    { re: /payment of/i, type: 'sent', weight: 2 },
    { re: /cash out/i, type: 'sent', weight: 2 },
    { re: /loaded to/i, type: 'sent', weight: 2 },
];

// ── Structural layer ────────────────────────────────────────────────────────
// Prepositions generalise where verb lists don't. The distinction that
// matters: "to your account" is money arriving, "from your account" is money
// leaving — the possessive is the signal, not the preposition alone.

const CURRENCY_AMOUNT_RE =
    /(?:Ksh\.?|KES|KSH|USD|EUR|GBP|TZS|UGX|RWF|\$|£|€)\s*\.?\s*[\d,]+(?:\.\d{1,2})?/gi;

const ACCOUNT_NOUN_RE = /\b(account|a\/?c|wallet|m-?pesa|mpesa|bank|number|balance|till|paybill)\b/i;

// What does the ~60 chars after this amount say?
function directionFromWindow(after: string): 'sent' | 'received' | null {
    const hasAccountNoun = ACCOUNT_NOUN_RE.test(after);

    // Possessive forms first — most reliable.
    if (/\b(?:to|into)\s+your\b/i.test(after) && hasAccountNoun) return 'received';
    if (/\bfrom\s+your\b/i.test(after) && hasAccountNoun) return 'sent';

    // Bare preposition + a party token (name, number, or code).
    const toOther = /\bto\s+(?!your\b)[A-Za-z0-9]/i.test(after);
    const fromOther = /\bfrom\s+(?!your\b)[A-Za-z0-9]/i.test(after);
    if (toOther && !fromOther) return 'sent';
    if (fromOther && !toOther) return 'received';

    return null;
}

function structuralDirection(msg: string): 'sent' | 'received' | null {
    CURRENCY_AMOUNT_RE.lastIndex = 0;
    const votes: ('sent' | 'received')[] = [];
    let m: RegExpExecArray | null;
    while ((m = CURRENCY_AMOUNT_RE.exec(msg)) !== null) {
        const start = m.index + m[0].length;
        const verdict = directionFromWindow(msg.slice(start, start + 62));
        if (verdict) votes.push(verdict);
    }
    if (votes.length === 0) return null;
    const sent = votes.filter(v => v === 'sent').length;
    const received = votes.length - sent;
    if (sent === received) return null; // conflicting signals — stay unresolved
    return sent > received ? 'sent' : 'received';
}

export function extractDirection(msg: string): DirectionResult {
    // 1 — keyword vote
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
    if (best) return { type: best.type, confidence: 95, source: 'keyword' };

    // 2 — structural inference from prepositions
    const structural = structuralDirection(msg);
    if (structural) return { type: structural, confidence: 75, source: 'structural' };

    // 3 — genuinely unresolved. `type` is a neutral best guess; the caller
    // must treat confidence 30 / source 'unresolved' as "we do not know",
    // NOT as sent.
    return { type: 'sent', confidence: 30, source: 'unresolved' };
}
