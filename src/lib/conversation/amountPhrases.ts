// The ways people say a figure that are not just a figure.
//
// Each of these was a real dead end. "We split 3000 between 3 of us" recorded
// 3,000 against one person. "850 plus 50 tip" recorded 850. "Three sodas at
// 150 each" recorded 150. "It was free" could not be recorded at all, because
// the amount question came back forever.
//
// Two shapes of answer come out of here:
//
//   - a REWRITE, where the message can be made to say the figure it meant and
//     handed to the ordinary extraction unchanged, plus the working to echo so
//     the user can catch a misreading;
//   - a QUESTION, where there genuinely are two honest readings and picking one
//     would be inventing a figure.
//
// Nothing here guesses. A phrase that does not match cleanly falls through to
// the extraction that was already there.

export interface AmountRewrite {
    kind: 'sum' | 'product' | 'selfCorrection';
    // The message, with the phrase replaced by the figure it works out to.
    text: string;
    // The working, in the user's own figures, for the acknowledgement. Null
    // when there is nothing worth showing (a self-correction shows the change
    // through the ordinary correction echo instead).
    working: string | null;
}

export interface AmountChoice {
    kind: 'range' | 'split';
    // The two honest readings, largest last, as plain numbers.
    values: [number, number];
    // Only for a split: how many people it was between.
    people?: number;
}

export type AmountPhrase =
    | { kind: 'rewrite'; rewrite: AmountRewrite }
    | { kind: 'choice'; choice: AmountChoice }
    | { kind: 'nothingPaid' }
    | null;

const FIGURE = String.raw`\d[\d,]*(?:\.\d{1,2})?`;

function num(raw: string): number {
    return parseFloat(raw.replace(/,/g, ''));
}

function money(n: number): string {
    return `Ksh ${n.toLocaleString('en-KE')}`;
}

// Words that already mark the number after them as money. The extractors need
// one: a bare number in free text is far more often a count, a time or a house
// number than a price.
const MONEY_CUE_BEFORE = /\b(?:for|of|at|was|is|were|cost|costs|spent|paid|bought|about|around|roughly|worth|totall?ing|came\s+to)\s*$/i;

// Puts a computed figure back into the sentence in a form the extractors will
// still read as money. Replacing "500 plus 300" with a bare "800" produced a
// message that no longer said a price at all, so the arithmetic worked and the
// amount came out empty.
function substituteFigure(text: string, re: RegExp, value: number): string {
    const m = re.exec(text);
    if (!m) return text;
    const before = text.slice(0, m.index);
    const cue = MONEY_CUE_BEFORE.test(before) ? '' : 'for ';
    return `${before}${cue}${value}${text.slice(m.index + m[0].length)}`;
}

// ── Nothing changed hands ───────────────────────────────────────────────────

// A zero-amount line is a line that says nothing. Saying so, and offering to
// record something else, beats printing "Ksh 0" on a document.
const NOTHING_PAID_RE =
    /\bit\s+was\s+free\b|\bwas\s+free\b|\bfor\s+free\b|\bthey\s+did\s*n'?t\s+charge\b|\bdid\s*n'?t\s+charge\s+me\b|\bno\s+charge\b|\bon\s+the\s+house\b|\bfree\s+of\s+charge\b/i;

// ── A range ─────────────────────────────────────────────────────────────────

// "400 or 500" is two figures and no way to choose. Guessing the smaller one is
// as wrong as guessing the larger.
const RANGE_RE = new RegExp(String.raw`\b(${FIGURE})\s*(?:or|/|-)\s*(${FIGURE})\b`, 'i');

// ── A split bill ────────────────────────────────────────────────────────────

const SPLIT_RE = new RegExp(
    String.raw`\bsplit\b[^\d]{0,20}(${FIGURE})\b[^\d]{0,20}\b(?:between|among|amongst|btwn)\b[^\d]{0,10}(\d{1,3})\b`,
    'i',
);

// ── An approximation ────────────────────────────────────────────────────────

// "about 500" is 500. The hedge is dropped rather than recorded: a document
// that says "about Ksh 500" is not a record of anything.
const APPROX_RE = new RegExp(
    String.raw`\b(?:about|around|roughly|approx(?:imately)?|circa|some)\s+(${FIGURE})|\b(${FIGURE})\s+(?:or\s+so|ish)\b`,
    'i',
);

// ── A sum ───────────────────────────────────────────────────────────────────

// Only "plus" and "+". Never a bare "and", which is the list separator that
// keeps "bacon and pork cuts for 3100" a single item list.
const SUM_RE = new RegExp(String.raw`\b(${FIGURE})\s*(?:plus|\+)\s*(${FIGURE})\b`, 'i');

// What the second figure was FOR, when the sentence says so straight after it
// ("plus 50 tip"). Looked at without being consumed, so the rewritten message
// keeps every word it had except the arithmetic itself. Prepositions and
// articles are not labels: "plus 300 for the matatu" is not a "for".
const SUM_LABEL_RE = /^\s+(?!for|to|at|on|in|of|the|a|an|and|yesterday|today)([a-z]{2,12})\b/i;

// ── A quantity at a unit price ──────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20,
};

// "three sodas" is a count. Only converted in front of a plural noun, so the
// pronoun "one" in "one of us" is left alone.
const WORD_COUNT_RE = new RegExp(
    String.raw`\b(${Object.keys(WORD_NUMBERS).join('|')})\s+(?=[a-z]+s\b)`, 'gi',
);

export function normalizeWordCounts(text: string): string {
    return text.replace(WORD_COUNT_RE, (_w, word: string) => `${WORD_NUMBERS[word.toLowerCase()]} `);
}

const PRODUCT_RE = new RegExp(
    String.raw`\b(\d{1,3})\s+[a-z][a-z\s]{0,24}?\s+(?:at|@|for)\s+(?:ksh\s*)?(${FIGURE})\s*(?:each|a\s+piece|apiece|per)\b`,
    'i',
);

// ── A figure corrected mid-sentence ─────────────────────────────────────────

// "500, no 600" and "500 sorry 600". The later figure is the one meant.
const SELF_CORRECTION_RE = new RegExp(
    String.raw`\b(${FIGURE})\s*,?\s*(?:no|nope|sorry|scratch\s+that|i\s+mean[t]?)\b[,\s]*(${FIGURE})\b`,
    'i',
);

// ── Reading one ─────────────────────────────────────────────────────────────

export function readAmountPhrase(text: string): AmountPhrase {
    // A self-correction is read first: it may contain any of the shapes below
    // on either side of itself, and the later figure is what the rest should
    // be looking at.
    const corrected = SELF_CORRECTION_RE.exec(text);
    if (corrected) {
        return {
            kind: 'rewrite',
            rewrite: {
                kind: 'selfCorrection',
                text: substituteFigure(text, SELF_CORRECTION_RE, num(corrected[2])),
                // Said back, like every other correction. A figure the user
                // changed mid-sentence is exactly the kind they will want to
                // see landed, and it may otherwise not surface until the
                // confirmation several questions later.
                working: `${money(num(corrected[2]))}, not ${money(num(corrected[1]))}`,
            },
        };
    }

    const split = SPLIT_RE.exec(text);
    if (split) {
        const total = num(split[1]);
        const people = parseInt(split[2], 10);
        if (people > 1 && Number.isFinite(total)) {
            const share = Math.round((total / people) * 100) / 100;
            return { kind: 'choice', choice: { kind: 'split', values: [share, total], people } };
        }
    }

    const nothing = NOTHING_PAID_RE.test(text);
    if (nothing) return { kind: 'nothingPaid' };

    // An approximation is settled before a range is looked for, so "about 500"
    // is not mistaken for anything ambiguous.
    const approx = APPROX_RE.exec(text);
    const withoutApprox = approx
        ? text.replace(APPROX_RE, (_w, a?: string, b?: string) => (a ?? b ?? ''))
        : text;

    const range = RANGE_RE.exec(withoutApprox);
    if (range) {
        const low = num(range[1]);
        const high = num(range[2]);
        // Two genuinely different figures, both plausible as money. A "range"
        // where one side is a date component or the two are equal is not one.
        if (Number.isFinite(low) && Number.isFinite(high) && low !== high && low > 0) {
            return {
                kind: 'choice',
                choice: { kind: 'range', values: low < high ? [low, high] : [high, low] },
            };
        }
    }

    const sum = SUM_RE.exec(withoutApprox);
    if (sum) {
        const a = num(sum[1]);
        const b = num(sum[2]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
            const after = withoutApprox.slice(sum.index + sum[0].length);
            const labelMatch = SUM_LABEL_RE.exec(after);
            const label = labelMatch ? ` ${labelMatch[1]}` : '';
            return {
                kind: 'rewrite',
                rewrite: {
                    kind: 'sum',
                    text: substituteFigure(withoutApprox, SUM_RE, a + b),
                    working: `${money(a)} plus ${money(b)}${label} is ${money(a + b)}`,
                },
            };
        }
    }

    const counted = normalizeWordCounts(withoutApprox);
    const product = PRODUCT_RE.exec(counted);
    if (product) {
        const quantity = parseInt(product[1], 10);
        const unit = num(product[2]);
        if (quantity > 1 && Number.isFinite(unit)) {
            return {
                kind: 'rewrite',
                rewrite: {
                    kind: 'product',
                    text: counted,
                    working: `${quantity} x ${money(unit)} is ${money(quantity * unit)}`,
                },
            };
        }
    }

    // A word count on its own ("three sodas at 150") still has to reach the
    // quantity extractor as digits. An approximation needs no rewrite at all:
    // "about" is exactly the cue the extractors want, and stripping it left a
    // bare number they would not read as money.
    const countsRewritten = normalizeWordCounts(text);
    if (countsRewritten !== text) {
        return { kind: 'rewrite', rewrite: { kind: 'sum', text: countsRewritten, working: null } };
    }
    return null;
}

// ── A shopping list ─────────────────────────────────────────────────────────

// "bacon 3100, tomatoes 400 and airtime 30" is an itemisation, and it was read
// as nothing at all.
//
// A bare number in typed text is not a price on its own, and rightly so: most
// bare numbers in a payment message are counts, times or reference numbers. But
// a comma-separated list where segment after segment reads "<thing> <number>"
// is a cue in itself. Nobody writes that shape except to price a list.
//
// So the LIST is the evidence, not any one number in it: the rewrite only
// happens when at least two segments have the shape, and each one gets the cue
// word it was missing. Everything downstream then works unchanged.

const LIST_SPLIT_RE = /\s*,\s*|\s+and\s+/i;
// <words, no digits> <figure> <nothing much>
const PRICED_SEGMENT_RE = new RegExp(
    String.raw`^\s*([a-z][a-z'\s-]{1,40}?)\s+(${FIGURE})\s*([a-z\s]{0,12})$`, 'i',
);
// What is allowed to trail the figure in the last segment: a date word, and
// nothing else.
const TRAILING_OK_RE = /^(?:yesterday|today|jana|leo|juzi|last night|this morning)?$/i;
// Words that are not a thing being bought. A segment naming one of these is
// context, not a line.
const NOT_AN_ITEM = /^(?:on|at|for|to|in|the|a|an|it|that|this|was|were|total|balance)$/i;
// A segment that already names a currency needs nothing from this rule, and
// must not be touched: "Ram Ksh 5000" would become "Ram Ksh for 5000", which
// breaks the figure away from the currency beside it and files the item as
// "Ram Ksh".
const NAMES_A_CURRENCY = /\b(?:ksh|kshs|kes|shs?|usd|eur|gbp|tzs|ugx|rwf|bob)\b|[$\u00A3\u20AC]/i;

// The same idea for a message that names one thing and one figure and nothing
// else: "lunch 850 yesterday". A bare number is not a price in general, but a
// message whose entire content is a thing and a number, inside a tool for
// recording money, is not saying anything else.
//
// Anchored to the WHOLE message on purpose. "I paid 3 people 850" has other
// words doing other work and is not this shape.
// A message with a transaction verb in it is already governed by rules that
// exist for good reasons: "paid rent 5000" and "paid kevin 500" deliberately
// do NOT read 5000 and 500 as amounts, because the word after the verb is as
// likely to be a party as a thing and a trailing bare number is as likely to
// be a reference. This rule is only for the verb-less shape, where there is
// nothing else the number could be.
const HAS_TRANSACTION_VERB =
    /\b(?:paid|pay|pays|bought|buy|buys|sent|send|sends|gave|give|gives|received|receive|got|withdrew|withdraw|deposited|deposit|sold|sell|sells|spent|spend|transferred|transfer|owe|owes|lent|borrowed|refunded|charged|nilinunua|nimenunua|nililipa|nimelipa|nilipokea|niliuza|nilitumia)\b/i;

const LONE_PRICED_RE = new RegExp(
    String.raw`^\s*([a-z][a-z'\s-]{1,40}?)\s+(${FIGURE})\s*((?:yesterday|today|jana|leo|juzi|last night|this morning)?)\s*$`,
    'i',
);

export function normalizeLonePricedThing(text: string): string {
    if (NAMES_A_CURRENCY.test(text)) return text;
    if (HAS_TRANSACTION_VERB.test(text)) return text;
    const m = LONE_PRICED_RE.exec(text);
    if (!m) return text;
    const thing = m[1].trim();
    if (MONEY_CUE_BEFORE.test(thing)) return text;
    if (thing.split(/\s+/).every(w => NOT_AN_ITEM.test(w))) return text;
    const tail = m[3] ? ` ${m[3]}` : '';
    return `${thing} for ${m[2]}${tail}`;
}

export function normalizePricedList(text: string): string {
    // A unit-price phrase is a different shape and is read elsewhere; rewriting
    // it here would price the count.
    if (PRODUCT_RE.test(normalizeWordCounts(text))) return text;

    const segments = text.split(LIST_SPLIT_RE);
    if (segments.length < 2) return text;

    const matched = segments.map(seg => {
        if (NAMES_A_CURRENCY.test(seg)) return null;
        const m = PRICED_SEGMENT_RE.exec(seg);
        if (!m) return null;
        if (!TRAILING_OK_RE.test((m[3] ?? '').trim())) return null;
        const words = m[1].trim().split(/\s+/);
        if (words.every(w => NOT_AN_ITEM.test(w))) return null;
        return m;
    });
    if (matched.filter(Boolean).length < 2) return text;

    return rebuild(text, segments, matched);
}

// Both list shapes, in the order that leaves each doing only its own job.
export function normalizePricedText(text: string): string {
    const asList = normalizePricedList(text);
    return asList === text ? normalizeLonePricedThing(text) : asList;
}

// Puts the list back together with the separators it arrived with, so nothing
// but the missing cue word changes.
function rebuild(text: string, segments: string[], matched: Array<RegExpExecArray | null>): string {
    const separators: string[] = [];
    let cursor = 0;
    for (let i = 0; i < segments.length - 1; i++) {
        cursor += segments[i].length;
        const rest = text.slice(cursor);
        const sep = /^(\s*,\s*|\s+and\s+)/i.exec(rest);
        separators.push(sep ? sep[1] : ', ');
        cursor += separators[i].length;
    }
    return segments
        .map((seg, i) => {
            const m = matched[i];
            return m ? seg.replace(PRICED_SEGMENT_RE, (_w, thing: string, fig: string, tail: string) => {
                // A segment that already said "for" keeps the one it has.
                const cue = MONEY_CUE_BEFORE.test(thing) ? '' : 'for ';
                return `${thing} ${cue}${fig}${tail ? ' ' + tail.trim() : ''}`;
            }) : seg;
        })
        .reduce((acc, seg, i) => (i === 0 ? seg : acc + separators[i - 1] + seg), '');
}
