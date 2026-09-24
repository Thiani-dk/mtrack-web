// What a person's name looks like in typed input.
//
// Shared, because two stages need the same answer and had no way to agree. The
// amount reader needs it to let a cue word reach a figure across the person it
// was paid to ("paid Kevin 500"); the conversational recipient reader needs it
// to pick that person out. When they disagreed, "paid Kevin Ksh 500" was filed
// as money paid to someone called "Kevin Ksh".
//
// Capitalisation is the whole signal. It is a weak one — plenty of people type
// in lower case — but it is the only one available without a name list, and
// guessing more generously would let ordinary words become recipients.

// One to three capitalised words: "Kevin", "Mama Njeri", "Mary Wanjiku Kamau".
//
// A name word may not run into a digit. Without that, "Ref QGH4R7TY9P" reads as
// the two-word name "Ref QGH" with a stray 4 after it, and a reference code
// becomes a payment of four shillings.
const NAME_WORD = String.raw`[A-Z][a-zA-Z'’-]+(?![\w'’-])`;
export const PARTY_NAME_SOURCE = String.raw`${NAME_WORD}(?:\s+${NAME_WORD}){0,2}`;

// Capitalised words that are never the name of a party. Months and weekdays
// because "paid on Tuesday" is a date; currency words because "paid Kevin Ksh
// 500" ends in a unit of money, not in a surname.
const NOT_A_NAME = new Set([
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'today', 'yesterday', 'tomorrow',
    'ksh', 'kes', 'kshs', 'shillings', 'shilling', 'bob', 'usd', 'eur', 'gbp',
    'tzs', 'ugx', 'rwf', 'dollars', 'dollar', 'pounds', 'euros',
]);

export function isNameWord(word: string): boolean {
    return !NOT_A_NAME.has(word.toLowerCase().replace(/[^a-z]/gi, ''));
}

// A run of capitalised words with every one of them plausible as part of a
// name. An empty string is not a name; nor is "Ksh"; nor is "Kevin Ksh", which
// is a name with a currency token stuck to it — the currency is not part of
// who was paid, and the run is trimmed back to the words that are.
export function trimToName(raw: string): string | null {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    const kept: string[] = [];
    for (const word of words) {
        if (!isNameWord(word)) break;
        kept.push(word);
    }
    return kept.length > 0 ? kept.join(' ') : null;
}
