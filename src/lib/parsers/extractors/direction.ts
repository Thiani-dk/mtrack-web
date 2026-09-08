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

interface WindowVerdict {
    dir: 'sent' | 'received';
    // A possessive form ("to your account" / "from your account") is the
    // single strongest textual signal — it outranks the verb vocabulary,
    // because "transferred TO YOUR account" is money arriving no matter what
    // the verb implies.
    possessive: boolean;
}

// What do the ~60 chars after this amount say?
function directionFromWindow(after: string): WindowVerdict | null {
    const hasAccountNoun = ACCOUNT_NOUN_RE.test(after);

    if (/\b(?:to|into)\s+your\b/i.test(after) && hasAccountNoun) return { dir: 'received', possessive: true };
    if (/\bfrom\s+your\b/i.test(after) && hasAccountNoun) return { dir: 'sent', possessive: true };

    // Bare preposition + a party token (name, number, or code).
    const toOther = /\bto\s+(?!your\b)[A-Za-z0-9]/i.test(after);
    const fromOther = /\bfrom\s+(?!your\b)[A-Za-z0-9]/i.test(after);
    if (toOther && !fromOther) return { dir: 'sent', possessive: false };
    if (fromOther && !toOther) return { dir: 'received', possessive: false };

    return null;
}

interface StructuralResult {
    dir: 'sent' | 'received' | null;
    possessive: boolean; // the winning vote came from a possessive form
}

function structuralDirection(msg: string): StructuralResult {
    CURRENCY_AMOUNT_RE.lastIndex = 0;
    const votes: WindowVerdict[] = [];
    let m: RegExpExecArray | null;
    while ((m = CURRENCY_AMOUNT_RE.exec(msg)) !== null) {
        const start = m.index + m[0].length;
        const verdict = directionFromWindow(msg.slice(start, start + 62));
        if (verdict) votes.push(verdict);
    }
    if (votes.length === 0) return { dir: null, possessive: false };

    // A single possessive vote decides it outright.
    const poss = votes.filter(v => v.possessive);
    if (poss.length > 0) {
        const sent = poss.filter(v => v.dir === 'sent').length;
        if (sent !== poss.length - sent) {
            return { dir: sent > poss.length - sent ? 'sent' : 'received', possessive: true };
        }
    }

    const sent = votes.filter(v => v.dir === 'sent').length;
    const received = votes.length - sent;
    if (sent === received) return { dir: null, possessive: false }; // conflicting — stay unresolved
    return { dir: sent > received ? 'sent' : 'received', possessive: false };
}

export function extractDirection(msg: string): DirectionResult {
    const structural = structuralDirection(msg);

    // 0 — a possessive "to/from your account" beats the verb vocabulary.
    if (structural.dir && structural.possessive) {
        return { type: structural.dir, confidence: 90, source: 'structural' };
    }

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

    // 2 — structural inference from a bare preposition
    if (structural.dir) return { type: structural.dir, confidence: 75, source: 'structural' };

    // 3 — genuinely unresolved. `type` is a neutral best guess; the caller
    // must treat confidence 30 / source 'unresolved' as "we do not know",
    // NOT as sent.
    return { type: 'sent', confidence: 30, source: 'unresolved' };
}
