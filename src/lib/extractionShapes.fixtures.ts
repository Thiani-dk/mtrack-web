import type { DocumentType } from '../types';
import type { CaptureSlot } from './conversationalCapture';

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
    // Which way the money went, where the wording settles it. A sales receipt
    // and a reimbursement claim describing the same goods do not agree about
    // this, so it is per type rather than per shape.
    direction?: 'sent' | 'received';
}

// The dimensions below were added after the flow sweep. Each one models
// something a shape can get wrong that the original harness could not see:
// what the document actually draws, which way the money went, and whether the
// flow is right to still be asking something.
export interface ShapeExpectations {
    // The itemisation rows the shared document model draws for this shape, as
    // "<text>  <amount>". Checked for point_of_sale, where the customer is
    // holding the thing. An empty array means no itemisation row at all.
    documentRows?: string[];
    // Slots the flow SHOULD still be asking about once the date is settled.
    // Almost always none — a question about something already said is the bug
    // this whole file exists for — but a message priced in two currencies has
    // no honest total, and asking is the correct outcome.
    stillOpen?: CaptureSlot[];
    // Set when the message prices things in more than one currency, listing
    // them in the order they appeared.
    mixedCurrencies?: string[];
}

export interface ExtractionShape {
    name: string;
    // The report it came from, and what went wrong.
    report: string;
    // Defaults for every type, overridable per case. null where the message
    // deliberately leaves no total — two currencies cannot be added up.
    amount: number | null;
    items: string[] | null;
    currency?: string;
    // Whether the message itself settles the date. Most of these do not, and
    // the harness answers "yesterday" before checking that nothing else is
    // still being asked.
    datedInMessage?: boolean;
    // Applies to every type unless a case overrides the pieces it can.
    expect?: ShapeExpectations;
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
        name: 'a bare count between the verb and the price',
        report: 'Found by the flow sweep. "sold 3 chapati for 150" was read as three '
            + 'shillings — the cue-word rule cannot tell a count from a sum, and the 3 '
            + 'sits right after "sold". A receipt for that sale read TOTAL PAID Ksh 3.00.',
        amount: 150,
        // Three of them, so the count earns a line of its own — see Phase 1.
        items: ['Chapati'],
        byType: {
            expense_summary: { message: 'bought 3 chapati for 150', description: 'Chapati' },
            personal_note: { message: 'bought 3 chapati for 150', description: 'Chapati' },
            point_of_sale: { message: 'sold 3 chapati for 150', description: 'Chapati' },
            on_behalf_of: { message: 'paid for 3 chapati for 150', description: 'Chapati' },
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
    {
        name: 'two currencies in one message',
        report: 'Found by the flow sweep. The itemisation was correctly refused — '
            + 'dollars and shillings do not add up without a rate — but the amount fell '
            + 'back to whichever single figure scored highest, so the flow confirmed '
            + '"$200. Right?" for a message that described two purchases.',
        amount: null,
        items: null,
        expect: {
            // No honest total exists, so asking is the correct outcome — the
            // one shape in this file where a remaining question is right.
            stillOpen: ['amount'],
            mixedCurrencies: ['USD', 'KES'],
            documentRows: [],
        },
        byType: {
            expense_summary: { message: 'a chip for 200 USD and lunch for 500 bob', description: 'Chip, Lunch' },
            personal_note: { message: 'a chip for 200 USD and lunch for 500 bob', description: 'Chip, Lunch' },
            point_of_sale: { message: 'they took a chip for 200 USD and lunch for 500 bob', description: 'Chip, Lunch' },
            on_behalf_of: { message: 'i paid for a chip for 200 USD and lunch for 500 bob', description: 'Chip, Lunch' },
        },
    },
    {
        name: 'a Kenyan price written with a trailing slash',
        report: 'Found by the flow sweep. The rule for "500/=" was written and never '
            + 'once fired: the date-separator guard was tested first and a slash after a '
            + 'number matched it, so the branch below was unreachable and the message '
            + 'extracted no amount at all.',
        amount: 800,
        items: ['Lunch', 'Beer'],
        expect: { documentRows: ['Lunch  Ksh 500.00', 'Beer  Ksh 300.00'] },
        byType: {
            expense_summary: { message: 'lunch 500/= and beer 300/=', description: 'Lunch, Beer' },
            personal_note: { message: 'lunch 500/= and beer 300/=', description: 'Lunch, Beer' },
            point_of_sale: { message: 'they took lunch 500/= and beer 300/=', description: 'Lunch, Beer' },
            on_behalf_of: { message: 'i paid lunch 500/= and beer 300/=', description: 'Lunch, Beer' },
        },
    },
    {
        name: 'a party named by relationship, in lower case',
        report: 'Found by the flow sweep, and the shape most likely to be common. '
            + 'Capitalisation is the only signal a name gives and most people typing on '
            + 'a phone give none, so "gave mum 2000" lost the recipient AND the amount — '
            + 'the cue word could not reach across a span it did not recognise.',
        amount: 2000,
        items: null,
        expect: { documentRows: [] },
        byType: {
            expense_summary: { message: 'gave mum 2000', description: 'Mum', direction: 'sent' },
            personal_note: { message: 'gave mum 2000', description: 'Mum', direction: 'sent' },
            point_of_sale: { message: 'sold goods to mum for 2000', description: 'Mum', direction: 'received' },
            on_behalf_of: { message: 'paid my landlord 2000', description: 'My landlord', direction: 'sent' },
        },
    },
    {
        name: 'a count between the verb and the price, rendered',
        report: 'The receipt half of the bare-count defect. With the figure read '
            + 'correctly the count lands where it belongs, and the row the customer '
            + 'reads carries the quantity and the unit price.',
        amount: 150,
        items: ['Chapati'],
        expect: { documentRows: ['Chapati (3 x Ksh 50.00)  Ksh 150.00'] },
        byType: {
            expense_summary: { message: 'bought 3 chapati for 150', description: 'Chapati' },
            personal_note: { message: 'bought 3 chapati for 150', description: 'Chapati' },
            point_of_sale: { message: 'sold 3 chapati for 150', description: 'Chapati', direction: 'received' },
            on_behalf_of: { message: 'paid for 3 chapati for 150', description: 'Chapati' },
        },
    },
];
