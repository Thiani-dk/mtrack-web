import type { DocumentType } from '../../types';

// Reading the front door.
//
// The mode question used to accept exactly three taps and nothing else. Every
// other opening move — saying hello, describing the purchase straight away,
// pasting an M-Pesa message, saying "it's for a customer" in words, or asking
// what the three options even mean — got the same reply: "Tap one of the
// options above so I know what we're making."
//
// That is the worst possible first impression for a thing that claims to
// understand what you type, and it is the first turn of every conversation.

// ── Greetings ───────────────────────────────────────────────────────────────

// English, Swahili and the Sheng greetings people actually open with.
// Whole-message only: "hi" is a greeting, "hi so I spent 3100 today" is a
// purchase with a greeting stuck on the front, and the purchase is the point.
const GREETING_RE =
    /^(?:hi+|hey+|hello+|yo|hola|good (?:morning|afternoon|evening)|habari|habari yako|hujambo|jambo|sasa|niaje|mambo|vipi|sema|uko aje|wassup|what'?s up)\b[\s!,.?]*$/i;

export function isGreeting(text: string): boolean {
    return GREETING_RE.test(text.trim());
}

// ── "What do these mean?" ───────────────────────────────────────────────────

const EXPLAIN_OPTIONS_RE =
    /\bwhat (?:do|does) (?:these|those|they|this|that|the options?|each)\b|\bwhat'?s the difference\b|\bwhich (?:one )?(?:should|do) i\b|\bexplain (?:these|those|the options?)\b|\bi don'?t (?:know|understand) (?:which|what)\b|\bwhat are my options\b/i;

export function asksWhatOptionsMean(text: string): boolean {
    return EXPLAIN_OPTIONS_RE.test(text.trim());
}

// ── The mode, said in the user's own words ──────────────────────────────────

// Order matters: the most specific reading wins. "Money I spent for my boss"
// mentions both a customer-less errand and a person, and it is a claim.
const MODE_PHRASES: ReadonlyArray<[RegExp, DocumentType]> = [
    // A claim: spent on someone else's behalf, to be paid back.
    [
        /\b(?:on behalf of|for my (?:boss|manager|employer|company|work|office|church|sacco|chama|landlord|mum|mom|dad|father|mother|friend|colleague)|for (?:the )?(?:boss|company|office|work)|reimburse\w*|claim(?:ing)? (?:from|back)|pay me back|paid? back|spent for someone|for someone else|someone owes me|work expense|expense claim)\b/i,
        'on_behalf_of',
    ],
    // A receipt handed to a customer.
    [
        /\b(?:for (?:a|my|the) (?:customer|client|buyer|shopper)|receipt for (?:a|my|the)? ?(?:customer|client|buyer)|i (?:sold|am selling|sell)\b|selling\b|a sale\b|for a sale\b|customer receipt|proof of purchase for)\b/i,
        'point_of_sale',
    ],
    // The user's own spending.
    [
        /\b(?:my own|mine|for me|for myself|my spending|my expenses|myself|own spending|just me|personal)\b/i,
        'expense_summary',
    ],
];

// Which mode a message names, or null when it names none.
export function readModeChoice(text: string): DocumentType | null {
    const t = text.trim();
    for (const [re, mode] of MODE_PHRASES) {
        if (re.test(t)) return mode;
    }
    return null;
}

// The option value the mode question passes back, for a document type.
export function modeValue(documentType: DocumentType): string {
    if (documentType === 'point_of_sale') return 'point_of_sale';
    if (documentType === 'on_behalf_of') return 'on_behalf_of';
    return 'own';
}
