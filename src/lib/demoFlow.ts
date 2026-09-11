import type { ChatOption, ParsedTransaction } from '../types';
import { buildSelfReportedTransaction } from './conversationalCapture';

// The guided demo builds one thing: a reimbursement claim (on_behalf_of) that
// the user co-authors tap by tap. This module holds the recognisably Kenyan
// option sets and the small pure helpers behind that flow. The conversation
// logic itself lives in ChatScreen, next to the real document flow.
//
// Every tapped transaction is built through buildSelfReportedTransaction — the
// exact helper the real conversational capture uses once its fields are
// gathered — so the demo exercises the same construction path as a real
// self-reported line rather than assembling ParsedTransaction objects here.

export type DemoStep =
    | 'party'      // who the claim is against
    | 'errand'     // what the trip / task was
    | 'category'   // what this line was spent on
    | 'place'      // where
    | 'amount'     // how much
    | 'loop'       // add another line, or move on
    | 'purpose'    // labelling each line, one at a time
    | 'paste'      // Pass 2: try a real pasted message
    | 'summary'    // Pass 3: what you just did
    | 'done';

export type DemoCategory = 'fuel' | 'food' | 'transport' | 'supplies' | 'stay';

export type DemoParty = 'boss' | 'client' | 'flatmate' | 'other';

interface CategoryConfig {
    label: string;      // the option card, and the line label
    spentOn: string;    // slots into "for ___" in the confirmation sentence
    account: string;    // the "for account ___" slot in a real M-Pesa message
    places: string[];
    amounts: number[];  // category-scaled, smallest first
    purposes: string[]; // what a line like this was for
}

export const DEMO_CATEGORIES: Record<DemoCategory, CategoryConfig> = {
    fuel: {
        label: 'Fuel',
        spentOn: 'fuel',
        account: 'FUEL',
        places: ['Shell Kilimani', 'Total Ngong Road', 'Rubis Westlands'],
        amounts: [2500, 4500, 6000],
        purposes: ['Return trip', 'Client pickup', 'Site runs'],
    },
    food: {
        label: 'Food',
        spentOn: 'food',
        account: 'MEALS',
        places: ['Java House', 'Galitos', 'Mama Mboga'],
        amounts: [450, 850, 1600],
        purposes: ['Client lunch', 'Team meal', 'Working late'],
    },
    transport: {
        label: 'Transport',
        spentOn: 'transport',
        account: 'TRANSPORT',
        places: ['Bolt ride', 'Matatu fare', 'Boda'],
        amounts: [150, 400, 900],
        purposes: ['Client pickup', 'Getting to site', 'Airport run'],
    },
    supplies: {
        label: 'Supplies',
        spentOn: 'supplies',
        account: 'SUPPLIES',
        places: ['Text Book Centre', 'Kisumu Hardware', 'Naivas'],
        amounts: [1200, 3400, 7500],
        purposes: ['Project materials', 'Office restock', 'Site supplies'],
    },
    stay: {
        label: 'Somewhere to stay',
        spentOn: 'a place to stay',
        account: 'ACCOMMODATION',
        places: ['Acacia Guesthouse', 'Sarova', 'An Airbnb'],
        amounts: [2800, 4500, 8000],
        purposes: ['Overnight for a site visit', 'Late finish', 'Early start the next day'],
    },
};

const CATEGORY_ORDER: DemoCategory[] = ['fuel', 'food', 'transport', 'supplies', 'stay'];

// The count at which the bot notes it has plenty to work with. The user is
// never blocked from adding more.
export const DEMO_PLENTY_COUNT = 6;

interface PartyConfig {
    key: DemoParty;
    label: string;      // the option card
    partyName: string;  // how it reads on the claim's "prepared for" line
}

const PARTIES: PartyConfig[] = [
    { key: 'boss', label: 'Your boss', partyName: 'My manager' },
    { key: 'client', label: 'A client', partyName: 'A client' },
    { key: 'flatmate', label: 'Your flatmate', partyName: 'My flatmate' },
];

export function demoPartyName(key: DemoParty): string {
    return PARTIES.find(p => p.key === key)?.partyName ?? 'Someone';
}

const ELSE_OPTION: ChatOption = { id: 'else', label: 'Something else', value: 'else' };

export function demoPartyOptions(): ChatOption[] {
    return [
        ...PARTIES.map(p => ({ id: p.key, label: p.label, value: p.key })),
        ELSE_OPTION,
    ];
}

export function demoErrands(party: DemoParty): string[] {
    return party === 'flatmate'
        ? ['Shared shopping', 'The house bill', 'A trip together']
        : ['Site visit to Kisumu', 'Office supplies run', 'Client meeting'];
}

export function demoErrandOptions(party: DemoParty): ChatOption[] {
    return [
        ...demoErrands(party).map((e, i) => ({ id: `errand-${i}`, label: e, value: e })),
        ELSE_OPTION,
    ];
}

export function demoCategoryOptions(): ChatOption[] {
    return [
        ...CATEGORY_ORDER.map(c => ({ id: c, label: DEMO_CATEGORIES[c].label, value: c })),
        ELSE_OPTION,
    ];
}

export function demoPlaceOptions(category: DemoCategory): ChatOption[] {
    return [
        ...DEMO_CATEGORIES[category].places.map((p, i) => ({ id: `place-${i}`, label: p, value: p })),
        ELSE_OPTION,
    ];
}

export function demoAmountOptions(category: DemoCategory): ChatOption[] {
    return [
        ...DEMO_CATEGORIES[category].amounts.map(a => ({
            id: `amount-${a}`,
            label: `Ksh ${a.toLocaleString('en-KE')}`,
            value: String(a),
        })),
        ELSE_OPTION,
    ];
}

export function demoPurposeOptions(category: DemoCategory | null): ChatOption[] {
    const purposes = category ? DEMO_CATEGORIES[category].purposes : ['A work errand', 'A client', 'A site visit'];
    return [
        ...purposes.map((p, i) => ({ id: `purpose-${i}`, label: p, value: p })),
        ELSE_OPTION,
    ];
}

// The loop control is a plain binary ("add another" / "that's enough"), not a
// data question, so it carries no free-text escape hatch.
export function demoLoopOptions(): ChatOption[] {
    return [
        { id: 'another', label: 'Add another', value: 'another' },
        { id: 'enough', label: "That's enough", value: 'enough' },
    ];
}

// Spread the lines across the last two weeks, one per distinct day, so the
// finished claim covers a real span rather than a single afternoon. Indexed by
// how many lines have been added so far.
const DAYS_AGO = [12, 10, 8, 6, 5, 3, 13, 9, 7, 4, 2, 11];

export function demoTxnDate(index: number): Date {
    const daysAgo = DAYS_AGO[index % DAYS_AGO.length];
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(9 + ((index * 3) % 8), (index * 13) % 60, 0, 0);
    return d;
}

// One tapped line -> one self-reported transaction, through the shared builder.
// The demo only ever records money the user spent, so the direction is known.
export function buildDemoTransaction(fields: { place: string; amount: number; index: number }): ParsedTransaction {
    return buildSelfReportedTransaction({
        amount: fields.amount,
        currency: 'KES',
        recipient: fields.place,
        date: demoTxnDate(fields.index),
        direction: { type: 'sent', confidence: 95, source: 'keyword' },
    });
}

// ── Pass 2: the one fake M-Pesa message the demo teaches the paste path with.
// Built from a line the user already tapped in, in exact M-Pesa paybill house
// style, so what the parser pulls out of it (amount, date, ref, fee) reads as
// their own data coming back richer than they typed it. ──

export const DEMO_PASTE_FEE = 29;

function fmtMoney2(n: number): string {
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMpesaDateTime(d: Date): string {
    const year = d.getFullYear() % 100;
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()}/${d.getMonth() + 1}/${year} at ${h}:${mm} ${ampm}`;
}

function fakeMpesaCode(): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '0123456789';
    let s = '';
    for (let i = 0; i < 10; i++) {
        s += i % 2 === 0
            ? letters[Math.floor(Math.random() * letters.length)]
            : digits[Math.floor(Math.random() * digits.length)];
    }
    return s;
}

export function buildDemoPasteMessage(fields: {
    recipient: string;
    amount: number;
    date: Date;
    category: DemoCategory | null;
    // Which way the money went. The claim demo teaches pasting an expense, so
    // 'sent' stays the default; Active Mode's practice round teaches pasting a
    // sale and asks for 'received'. Same generator either way — the code, the
    // date format and the balance line are what make a practice paste parse
    // like the real thing, and there must only be one of them.
    direction?: 'sent' | 'received';
}): string {
    const balance = 8000 + Math.round(fields.amount * 1.847);
    if (fields.direction === 'received') {
        return `${fakeMpesaCode()} Confirmed. You have received Ksh${fmtMoney2(fields.amount)} `
            + `from ${fields.recipient.toUpperCase()} 0712345678 on ${fmtMpesaDateTime(fields.date)}. `
            + `New M-PESA balance is Ksh${fmtMoney2(balance)}.`;
    }
    const account = fields.category ? DEMO_CATEGORIES[fields.category].account : 'EXPENSES';
    return `${fakeMpesaCode()} Confirmed. Ksh${fmtMoney2(fields.amount)} sent to ${fields.recipient.toUpperCase()} `
        + `for account ${account} on ${fmtMpesaDateTime(fields.date)}. New M-PESA balance is Ksh${fmtMoney2(balance)}. `
        + `Transaction cost, Ksh${fmtMoney2(DEMO_PASTE_FEE)}.`;
}
