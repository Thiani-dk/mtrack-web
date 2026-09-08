// Emoji stripping for anything that reaches a generated document.
//
// jsPDF measures text with the built-in AFM metrics, which have no glyphs for
// astral-plane characters. An emoji in a recipient name made getTextWidth
// under-report, so the right-aligned amount column was placed over the name
// and the two overlapped into unreadable garble. Cutting the characters out
// before layout is the fix; there is no font we can embed that would make an
// emoji meaningful on a receipt anyway.
//
// Applied at document assembly only. The live chat conversation keeps whatever
// the user typed.

// Unicode ranges and properties, not a hardcoded list of characters.
//
// Extended_Pictographic is the property that actually defines "is an emoji",
// and covers every pictographic block (1F300-1FAFF supplemental and extended-A,
// 2600-27BF misc symbols and dingbats, and the rest) without having to
// enumerate them.
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;
// Regional indicators — pairs of these are flags. Not pictographic themselves.
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/gu;
// Arrows and misc symbols, commonly used decoratively in a display name.
const DECORATIVE = /[\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
// Tag characters, used by subdivision flags.
const TAGS = /[\u{E0020}-\u{E007F}]/gu;
// The joiners, variation selectors and skin-tone modifiers that build compound
// emoji. Removing them is deliberate: they are left stranded once the
// pictographs themselves are gone. Built through the RegExp constructor because
// a literal class of combining marks is unreadable in source.
const MODIFIERS = new RegExp('\\uFE0F|\\uFE0E|\\u200D|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]', 'gu');

export function stripEmoji(input: string): string {
    if (!input) return input;
    return input
        .replace(PICTOGRAPHIC, '')
        .replace(REGIONAL, '')
        .replace(DECORATIVE, '')
        .replace(TAGS, '')
        .replace(MODIFIERS, '')
        // An emoji sitting between two words leaves a double space behind.
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// Same, but never returns an empty string — a name made entirely of emoji
// would otherwise leave a blank where a party should be.
export function stripEmojiOr(input: string | null | undefined, fallback: string): string {
    const cleaned = stripEmoji(input ?? '');
    return cleaned.length > 0 ? cleaned : fallback;
}

// Null-preserving variant for optional fields (purpose, contact, prepared-by).
export function stripEmojiOptional(input: string | null | undefined): string | null {
    if (input == null) return null;
    const cleaned = stripEmoji(input);
    return cleaned.length > 0 ? cleaned : null;
}
