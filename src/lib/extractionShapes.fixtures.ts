import type { DocumentType } from '../types';

// Every real-world message shape that has broken extraction in this project,
// with what it should extract to.
//
// Each of these was found the same way: a user screenshotted a conversation in
// which the bot asked for something the message had already said. Three of
// them in a row, in three different document types, each fixed in the one mode
// it was reported in — which is why they kept coming back wearing different
// clothes.
//
// So the shapes live here rather than in one mode's test file, and
// extractionShapes.test.ts drives every one of them through every document
// type. Adding a shape here tests it in all four modes at once, and the next
// bug of this class is a failing test rather than a screenshot.
//
// The messages are worded per type, because a reimbursement claim does not say
// "they bought". The STRUCTURE is what is held constant; the wording is what a
// real user of that type would plausibly type.

export interface ShapeCase {
    // What the user typed.
    message: string;
    // The description the flow must end up with — the answer to "what was
    // this?", which is the thing every one of these bugs threw away.
    description: string;
    // Item descriptions when the message is a genuine itemisation; null when it
    // is one purchase and must stay one line rather than a one-row table.
    items?: string[] | null;
    // Overrides, where a type's wording genuinely carries a different figure.
    amount?: number;
}

export interface ExtractionShape {
    name: string;
    // The report it came from, and what went wrong.
    report: string;
    // Defaults for every type, overridable per case.
    amount: number;
    items: string[] | null;
    currency?: string;
    // Whether the message itself settles the date. Most of these do not, and
    // the harness answers "yesterday" before checking that nothing else is
    // still being asked.
    datedInMessage?: boolean;
    byType: Record<DocumentType, ShapeCase>;
}

const WINGS = '2 buckets of chicken wings, one spicy, one sweet(honey dipped). worth 2999 ksh';
const WINGS_DESC = '2 buckets of chicken wings, one spicy, one sweet (honey dipped)';

export const EXTRACTION_SHAPES: readonly ExtractionShape[] = [
    {
        name: 'single item with descriptive sub-clauses, price at the end',
        report: 'point_of_sale, the chicken wings. The amount read; the description '
            + 'did not, so the flow asked what they bought after being told in six words. '
            + 'One price meant no itemisation, and the itemisation was the only reader '
            + 'of item text in the whole flow.',
        amount: 2999,
        items: null,
        byType: {
            expense_summary: { message: WINGS, description: WINGS_DESC },
            personal_note: { message: WINGS, description: WINGS_DESC },
            point_of_sale: { message: WINGS, description: WINGS_DESC },
            on_behalf_of: {
                message: '2 crates of milk for the office, one full cream, one skimmed. worth 2999 ksh',
                description: '2 crates of milk for the office, one full cream, one skimmed',
            },
        },
    },
    {
        name: 'several items, bare numerals, no currency token anywhere',
        report: 'expense_summary, the bacon and groceries. Requiring a currency token '
            + 'reduced a message carrying three prices to nothing, so the flow asked '
            + 'how much about a message that had said so three times.',
        amount: 3530,
        items: ['Bacon, pork cuts', 'Tomatoes, garlic', 'Airtime'],
        byType: {
            expense_summary: {
                message: 'hi so, i spent quite a lot today. i boought somebacon and pork cuts for 3100, '
                    + 'tomatoes and garlic at 400. then i bought airtime worth 30',
                description: 'Bacon, pork cuts, Tomatoes, garlic, Airtime',
            },
            personal_note: {
                message: 'i boought somebacon and pork cuts for 3100, tomatoes and garlic at 400. '
                    + 'then i bought airtime worth 30',
                description: 'Bacon, pork cuts, Tomatoes, garlic, Airtime',
            },
            point_of_sale: {
                message: 'they took bacon and pork cuts for 3100, tomatoes and garlic at 400. '
                    + 'then airtime worth 30',
                description: 'Bacon, pork cuts, Tomatoes, garlic, Airtime',
            },
            on_behalf_of: {
                message: 'i paid for bacon and pork cuts for 3100, tomatoes and garlic at 400. '
                    + 'then airtime worth 30',
                description: 'Bacon, pork cuts, Tomatoes, garlic, Airtime',
            },
        },
    },
    {
        name: 'price stated before the item',
        report: 'on_behalf_of, the Sambonani transcript. The extractor only ever read '
            + 'the words BEFORE a price, so every item phrased the other way round was '
            + 'silently dropped.',
        amount: 750,
        currency: 'USD',
        items: ['Call time', 'Sms time'],
        byType: {
            expense_summary: {
                message: 'I spent on credits to keep chatting. 500 USD on call time. And 250 USD on sms time.',
                description: 'Call time, Sms time',
            },
            personal_note: {
                message: 'I spent on credits to keep chatting. 500 USD on call time. And 250 USD on sms time.',
                description: 'Call time, Sms time',
            },
            point_of_sale: {
                message: 'They bought credits to continue chatting on my platform. '
                    + '500 USD on call time. And 250 USD on sms time.',
                description: 'Call time, Sms time',
            },
            on_behalf_of: {
                message: 'I covered their credits on my platform. 500 USD on call time. And 250 USD on sms time.',
                description: 'Call time, Sms time',
            },
        },
    },
    {
        name: 'code-switched Swahili and English, with numeral shorthand',
        report: 'Working when it was built. Here so it stays working: Swahili verb, '
            + 'English items, Swahili numerals, no currency token and no per-message '
            + 'language detection.',
        amount: 3500,
        items: ['Bacon', 'Mkate'],
        byType: {
            expense_summary: {
                message: 'nilinunua bacon kwa elfu tatu, mkate kwa mia tano',
                description: 'Bacon, Mkate',
            },
            personal_note: {
                message: 'nimenunua bacon kwa elfu tatu, mkate kwa mia tano',
                description: 'Bacon, Mkate',
            },
            point_of_sale: {
                message: 'niliuza bacon kwa elfu tatu, mkate kwa mia tano',
                description: 'Bacon, Mkate',
            },
            on_behalf_of: {
                message: 'nililipa bacon kwa elfu tatu, mkate kwa mia tano',
                description: 'Bacon, Mkate',
            },
        },
    },
    {
        name: 'a numeral inside a relative-date phrase, alongside a real amount',
        report: 'Fixed after "3 days ago" was confirmed back as "Ksh 3". Here as a '
            + 'guard in both directions: the date phrase owns its numeral, and the '
            + 'real amount beside it still lands.',
        amount: 120,
        items: null,
        datedInMessage: true,
        byType: {
            expense_summary: {
                message: '3 days ago i bought milk for 120',
                description: 'Milk',
            },
            personal_note: {
                message: '3 days ago i bought milk for 120',
                description: 'Milk',
            },
            point_of_sale: {
                message: '3 days ago they bought milk for 120',
                description: 'Milk',
            },
            on_behalf_of: {
                message: '3 days ago i paid for their milk for 120',
                description: 'Milk',
            },
        },
    },
];
