// Currency token recognition, shared by the SMS pipeline and conversational
// capture.
//
// This map and the token pattern were previously private to the amount
// extractor, which is why typed input had no way to see a currency the user
// had plainly stated. There is one recognition table now and both paths read
// it — the currency the SMS path retains on a card payment is the same
// currency conversational capture locks onto when someone types "10k USD".
//
// Everything normalises to an ISO 4217 code internally. How a code is then
// displayed is a separate decision (KES prints as "Ksh" — see fmtCurrency).

export const DEFAULT_CURRENCY = 'KES';

const CURRENCY_MAP: Record<string, string> = {
    ksh: 'KES', kshs: 'KES', kes: 'KES', shilling: 'KES', shillings: 'KES',
    '$': 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD',
    eur: 'EUR', '€': 'EUR', euro: 'EUR', euros: 'EUR',
    gbp: 'GBP', '£': 'GBP', pound: 'GBP', pounds: 'GBP',
    tzs: 'TZS', ugx: 'UGX', rwf: 'RWF',
};

function esc(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest-first, so "kshs" is never read as "ksh" with a stray "s", and
// "dollars" never as "dollar".
const TOKENS = Object.keys(CURRENCY_MAP).sort((a, b) => b.length - a.length);
const WORDS = TOKENS.filter(t => /^[a-z]+$/.test(t)).map(esc).join('|');
const SYMBOLS = TOKENS.filter(t => !/^[a-z]+$/.test(t)).map(esc).join('|');

// A code written as its own word ("10k USD"), a code written hard against the
// number ("5000USD" — so no leading \b, which a digit-to-letter transition
// does not provide), or a bare symbol. The trailing guard stops a longer word
// registering: "pounded" is not GBP.
const WORD_SOURCE = `(?:${WORDS})(?![A-Za-z])`;
export const CURRENCY_SUFFIX_SOURCE = `(?:${WORD_SOURCE}|${SYMBOLS})`;
export const CURRENCY_TOKEN_SOURCE = `(?:(?:^|[^A-Za-z])${WORD_SOURCE}|${SYMBOLS})`;

// Capturing form, for scanning text for mentions.
const SCAN_RE = new RegExp(`(?:^|[^A-Za-z])(${WORDS})(?![A-Za-z])|(${SYMBOLS})`, 'gi');

// Normalises one recognised token ("usd", "Ksh.", "$") to its ISO code.
// Returns null for anything unrecognised — never a silent fallback to KES,
// because "nothing was said" and "Shillings was said" are different facts and
// only the caller knows what to do about the difference.
export function normalizeCurrency(token: string): string | null {
    const key = token.trim().toLowerCase().replace(/\.$/, '');
    return CURRENCY_MAP[key] ?? null;
}

// Every distinct currency explicitly mentioned, in order of first appearance.
export function detectCurrencies(text: string): string[] {
    const out: string[] = [];
    SCAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SCAN_RE.exec(text)) !== null) {
        const code = normalizeCurrency(m[1] ?? m[2] ?? '');
        if (code && !out.includes(code)) out.push(code);
        // A zero-length match cannot happen here, but a symbol match can be
        // adjacent to the next token; lastIndex already handles that.
    }
    return out;
}

// The first currency explicitly mentioned in some text, or null if none is.
export function detectCurrency(text: string): string | null {
    return detectCurrencies(text)[0] ?? null;
}
