import type { LineItem } from '../types';
import type { CaptureDraft } from './captureDraft';
import { lockCurrency, parseConversationalDate } from './conversationalCapture';
import { extractAmount } from './parsers/extractors/amount';
import { detectCurrency } from './parsers/extractors/currency';
import { fmtAmountProse } from './transactionDisplay';

// Working out WHICH fact a correction is about, and applying it visibly.
//
// A correction is the one case where a silently-applied change is worse than
// no change at all: if the wrong field is edited, the user has no way to
// notice — they said "actually 3500", something said "done", and the number
// they never meant to touch is now wrong in a saved document. So every
// correction here either names what it changed, or asks which thing was meant.
// It never guesses between two equally plausible targets.
//
// Before this, a correction at the confirmation step was not a correction at
// all: anything that wasn't "yes" wiped the entire draft and restarted from
// the date question, throwing away an amount, a date and an item list that
// were all perfectly correct.

export type CorrectionTarget =
    | { kind: 'line-item'; index: number }
    | { kind: 'amount' }
    | { kind: 'recipient' }
    | { kind: 'date' }
    | { kind: 'currency' };

export type CorrectionOutcome =
    // Applied, with the before-and-after to show the user.
    | { kind: 'applied'; draft: CaptureDraft; echo: string; target: CorrectionTarget }
    // More than one plausible target and no way to choose — ask. The figure
    // travels with the question: the answer names an item and nothing else, so
    // without this the new value would be lost between the two turns.
    | { kind: 'ambiguous'; text: string; amount: number; options: Array<{ id: string; label: string; value: string }> }
    // A correction marker, but nothing in the message to apply.
    | { kind: 'unresolved'; text: string };

// ── What the correction says the new value is ────────────────────────────────

// Words that belong to the correction itself rather than to the thing being
// corrected, so they never count as a reference to an item.
const CORRECTION_NOISE = new Set([
    'actually', 'no', 'wait', 'i', 'meant', 'ment', 'sorry', 'it', 'was', 'were',
    'that', 'this', 'the', 'a', 'an', 'make', 'scratch', 'not', 'but', 'is', 'and',
    'one', 'oh', 'also', 'should', 'be', 'to', 'my', 'we', 'they', 'for', 'of', 'at',
]);

function contentWords(text: string): string[] {
    return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter(w => w.length > 2 && !CORRECTION_NOISE.has(w));
}

// How strongly a correction refers to one already-captured item, by shared
// content words. "The pork cuts one was actually 3500" names item "Bacon, pork
// cuts" by two of its words.
function referenceScore(item: LineItem, words: string[]): number {
    const itemWords = new Set(contentWords(item.description));
    return words.filter(w => itemWords.has(w)).length;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function totalOf(items: LineItem[]): number {
    return round2(items.reduce((sum, i) => sum + i.amount, 0));
}

// ── The figure a correction is offering ──────────────────────────────────────

// Elsewhere a bare number only counts as money with a cue word beside it
// ("for 3100", "spent 45,000"), because most bare numbers in a payment message
// are something else. Inside a correction that rule is too strict and for the
// wrong reason: "actually it was 3500" is a message whose entire purpose is to
// state a new figure, and "was" is not in any cue vocabulary. So a bare figure
// here is taken at face value.
//
// Guarded by the date read: "actually it was on 4 May 2026" contains 4 and
// 2026 and is not an amount correction at all, so a message that resolved to a
// real date is never mined for digits.
const FIGURE_RE = /\d[\d,]*(?:\.\d{1,2})?/g;

function correctionAmount(text: string, dateIsExact: boolean): number | null {
    // A currency-tagged or cue-marked figure, by the ordinary rules first.
    const byRule = extractAmount(text, { allowBare: true })?.amount ?? null;
    if (byRule != null) return byRule;
    if (dateIsExact) return null;

    const figures = text.match(FIGURE_RE) ?? [];
    if (figures.length === 0) return null;
    // "not 3000, 3500" and "3000 should be 3500" both put the new value last.
    const parsed = parseFloat(figures[figures.length - 1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

// ── Resolving and applying ───────────────────────────────────────────────────

export function resolveCorrection(
    draft: CaptureDraft,
    text: string,
    now: Date = new Date(),
): CorrectionOutcome {
    const money = (n: number, code = draft.currency.code) => fmtAmountProse(n, code);

    const newCurrency = detectCurrency(text);
    const dateRead = parseConversationalDate(text, now);
    const newDate = dateRead.confidence === 'exact' ? dateRead.date : null;
    const newAmount = correctionAmount(text, newDate != null);

    const items = draft.lineItems ?? [];
    const words = contentWords(text);

    // 1. An explicit reference to something already captured wins outright.
    if (items.length > 0 && newAmount != null) {
        const scored = items
            .map((item, index) => ({ index, item, score: referenceScore(item, words) }))
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score);

        if (scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
            return applyToItem(draft, scored[0].index, newAmount, money);
        }
        if (scored.length > 1) return askWhich(scored.map(c => c.item), newAmount, money);

        // 2. No reference at all. One item is unambiguous; more than one is a
        //    coin toss, and a coin toss that edits a saved figure is not
        //    something to do quietly.
        if (items.length === 1) return applyToItem(draft, 0, newAmount, money);
        return askWhich(items, newAmount, money);
    }

    // 3. A plain amount, with no itemisation to disambiguate against.
    if (newAmount != null) {
        const before = draft.amount;
        return {
            kind: 'applied',
            target: { kind: 'amount' },
            draft: { ...draft, amount: newAmount },
            echo: before != null && before > 0
                ? `Updated — ${money(before)} → ${money(newAmount)}.`
                : `Got it — ${money(newAmount)}.`,
        };
    }

    // 4. A date.
    if (newDate) {
        return {
            kind: 'applied',
            target: { kind: 'date' },
            draft: { ...draft, date: newDate, dateInterpretation: dateRead.interpretation, dateAmbiguous: false },
            echo: `Updated — the date is ${dateRead.interpretation ?? 'changed'}.`,
        };
    }

    // 5. A currency on its own ("sorry, that was USD").
    if (newCurrency && newCurrency !== draft.currency.code) {
        const before = draft.currency.code;
        return {
            kind: 'applied',
            target: { kind: 'currency' },
            draft: { ...draft, currency: lockCurrency({ code: newCurrency, explicit: false }, text) },
            echo: `Updated — ${before} → ${newCurrency}.`,
        };
    }

    // 6. A name, where the correction offers one and nothing else.
    const name = text.match(/\b(?:meant|not|actually|it'?s|its)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/);
    if (name) {
        const before = draft.recipient;
        return {
            kind: 'applied',
            target: { kind: 'recipient' },
            draft: { ...draft, recipient: name[1] },
            echo: before ? `Updated — ${before} → ${name[1]}.` : `Got it — ${name[1]}.`,
        };
    }

    return {
        kind: 'unresolved',
        text: "I can tell something needs changing but not what to. What should it be instead?",
    };
}

function applyToItem(
    draft: CaptureDraft,
    index: number,
    amount: number,
    money: (n: number, code?: string) => string,
): CorrectionOutcome {
    const items = draft.lineItems ?? [];
    const before = items[index];
    const updated = items.map((item, i) => (i === index
        ? {
            ...item,
            amount,
            // A stated quantity makes the unit price a derived figure, so it
            // has to move with the line total rather than keep a stale value.
            unitPrice: item.quantity && item.quantity > 0 ? round2(amount / item.quantity) : item.unitPrice,
        }
        : item));

    return {
        kind: 'applied',
        target: { kind: 'line-item', index },
        draft: { ...draft, lineItems: updated, amount: totalOf(updated) },
        echo: `Updated — ${before.description}: ${money(before.amount)} → ${money(amount)}. `
            + `New total ${money(totalOf(updated))}.`,
    };
}

function askWhich(
    candidates: LineItem[],
    amount: number,
    money: (n: number, code?: string) => string,
): CorrectionOutcome {
    const shown = candidates.slice(0, 4);
    return {
        kind: 'ambiguous',
        amount,
        text: `Which one — ${shown.map(i => i.description).join(', or ')}?`,
        options: shown.map((item, i) => ({
            id: `correct-item-${i}`,
            label: `${item.description} (${money(item.amount)})`,
            // The description, so the follow-up runs back through the same
            // reference matching rather than a second, positional mechanism.
            value: `correction-target:${item.description}`,
        })),
    };
}

// Applying a correction whose target was settled by a tap rather than by words.
//
// The figure came from the earlier message and the item name from the answer,
// so neither is re-parsed: re-reading "Tomatoes" for an amount would find none
// and lose the correction entirely, which is exactly what happened before the
// figure was carried on the question.
export function applyNamedCorrection(
    draft: CaptureDraft,
    description: string,
    amount: number,
): CorrectionOutcome {
    const items = draft.lineItems ?? [];
    const index = items.findIndex(i => i.description.toLowerCase() === description.trim().toLowerCase());
    if (index < 0) {
        return { kind: 'unresolved', text: "I lost track of which one that was. Which item should change, and to what?" };
    }
    return applyToItem(draft, index, amount, (n, code) => fmtAmountProse(n, code ?? draft.currency.code));
}
