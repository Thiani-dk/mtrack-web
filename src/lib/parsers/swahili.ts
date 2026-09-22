// Swahili and Sheng, at the vocabulary level and no further.
//
// This is not a second NLU system and does not try to be. The actual need is
// recognising a small, stable set of transaction-shaped words — the verbs, two
// numerals, two prepositions — not open-ended bilingual understanding. A
// translation layer would cost far more and add a failure mode of its own, and
// mistranslating a financial record is worse than not reading it.
//
// Matching is at the TOKEN level, never the message level. Code-switching is
// the normal case here, not an edge case: "Nilinunua bacon na pork cuts for
// elfu tatu" is one sentence with a Swahili verb, English items, an English
// preposition and a Swahili numeral, and a per-message language classifier
// would have to pick one and be wrong about the rest.
//
// Anything beyond this vocabulary fails the same way an unrecognised English
// sentence does — into the honest "I didn't follow" fallback — rather than
// being half-read and quietly mishandled.

// ── Verbs ────────────────────────────────────────────────────────────────────

// Tense prefixes are spelled out rather than generated, so the vocabulary
// stays a fixed list that can be read and checked. ni-li- is past, ni-me- is
// perfect, na- is present.
export const SWAHILI_VERBS: readonly string[] = [
    // bought
    'nilinunua', 'nimenunua', 'nanunua', 'kununua',
    // paid
    'nililipa', 'nimelipa', 'nalipa', 'kulipa',
    // received
    'nilipokea', 'nimepokea', 'napokea', 'kupokea',
    // sold
    'niliuza', 'nimeuza', 'nauza', 'kuuza',
    // spent
    'nilitumia', 'nimetumia', 'natumia',
    // gave
    'nilipatia', 'nimempea', 'nilimpa', 'nimempatia',
];

// Which English verb each maps to, for direction inference. Only the
// distinction that matters — money in or money out — is modelled.
const RECEIVED_VERBS = /^(?:nili|nime|na|ku)(?:pokea|uza)$/;

export function swahiliVerbDirection(token: string): 'sent' | 'received' | null {
    const word = token.toLowerCase();
    if (!SWAHILI_VERBS.includes(word)) return null;
    return RECEIVED_VERBS.test(word) ? 'received' : 'sent';
}

// ── Numerals ─────────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
    moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5,
    sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
    ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50,
};

// "elfu tatu" is three thousand, "mia tano" five hundred — the multiplier
// leads and the count follows, the opposite of English.
//
// Rewritten into the form the amount extractor already understands ("3 elfu"),
// rather than straight to 3000, because `elfu` then works exactly as `k` does:
// a bare number carrying a multiplier is a quantity of money by construction,
// which is the signal that lets it be read without a currency token beside it.
const SWAHILI_NUMERAL_RE = new RegExp(
    String.raw`\b(elfu|mia)\s+(${Object.keys(UNITS).join('|')})\b`, 'gi',
);

// And the digit form people mix in freely: "elfu 3", "mia 5".
const SWAHILI_DIGIT_RE = /\b(elfu|mia)\s+(\d+)\b/gi;

export function normalizeSwahiliNumerals(text: string): string {
    return text
        .replace(SWAHILI_NUMERAL_RE, (whole, mult: string, unit: string) => {
            const n = UNITS[unit.toLowerCase()];
            return n ? `${n} ${mult.toLowerCase()}` : whole;
        })
        .replace(SWAHILI_DIGIT_RE, (_w, mult: string, digits: string) => `${digits} ${mult.toLowerCase()}`);
}

// ── Prepositions ─────────────────────────────────────────────────────────────

// Extends the existing structural direction inference rather than needing a
// grammar: "kutoka" is "from" and "kwa" is "to", which is the same signal the
// English path already reads.
export const SWAHILI_FROM_RE = /\bkutoka\b/i;
export const SWAHILI_TO_RE = /\bkwa\b/i;

// "na" is "and" — a list separator between items, exactly like the English one.
export const SWAHILI_AND = 'na';
