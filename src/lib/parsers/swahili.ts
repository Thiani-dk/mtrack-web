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

// ── Relative dates ───────────────────────────────────────────────────────────

// "leo" and "jana" are the two that actually turn up, and they resolve through
// the same conversational date parser as "today" and "yesterday" rather than a
// parallel one — so the bounds rules, the ambiguity handling and the "I'd
// rather leave it blank than guess" discipline all apply unchanged.
//
// Token-level like the rest of this file: "Nilinunua bacon for elfu tatu leo"
// needs no language detection, just the word.
// "juzi" is the day before yesterday — kept distinct from "jana" because a
// parser that conflated them would be off by a day, silently.
const DATE_WORDS: ReadonlyArray<[string, SwahiliRelativeDate]> = [
    ['leo', 'today'],
    ['juzi', 'day-before'],
    ['jana', 'yesterday'],
];

export type SwahiliRelativeDate = 'today' | 'yesterday' | 'day-before';

// Which relative day a message names in Swahili, if any.
//
// Case-sensitive on purpose, which the English words do not need to be.
// "Jana" is a real name, and "paid Jana 500" dated the record to yesterday —
// a wrong date applied silently, which is the worst shape a bug can take here.
// A capitalised occurrence mid-sentence is read as a name and ignored; at the
// very start of the message it is ordinary sentence capitalisation and says
// nothing either way, so it still counts.
//
// The residual case is a lowercase "jana" that really was meant as a name.
// Nothing distinguishes that from the date word, and reading it as the date is
// the better of the two guesses — the confirmation sentence states the date
// back before anything is saved.
export function swahiliRelativeDate(raw: string): SwahiliRelativeDate | null {
    for (const [word, meaning] of DATE_WORDS) {
        const re = new RegExp(String.raw`\b(${word})\b`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw)) !== null) {
            const token = m[1];
            const capitalised = token[0] !== token[0].toLowerCase();
            if (!capitalised || m.index === 0) return meaning;
        }
    }
    return null;
}
