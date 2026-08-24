import type { ParsedTransaction } from '../../types';
import type { Insight, InsightContext } from './types';
import { GENERATORS } from './generators';

export type { Insight, InsightContext, InsightKind } from './types';
export { detectRecurring } from './recurring';
export type { RecurringPattern } from './recurring';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Actual days spanned by a transaction set (inclusive), not the nominal
// window the user picked — the honest denominator for rate/projection math.
export function computeDaySpan(txns: ParsedTransaction[]): number {
    if (txns.length === 0) return 1;
    let min = txns[0].date.getTime();
    let max = min;
    for (const t of txns) {
        const time = t.date.getTime();
        if (time < min) min = time;
        if (time > max) max = time;
    }
    return Math.max(1, Math.round((max - min) / MS_PER_DAY) + 1);
}

// Runs every generator, drops nulls, sorts by priority, and caps the result
// at 5 — more than that is a wall of text, not a conversation. The fee
// insight (when it exists) is always kept even if it wouldn't otherwise make
// the cut, since it's the headline "oh" moment.
export function generateInsights(transactions: ParsedTransaction[], context: InsightContext): Insight[] {
    // Excluded transactions (failed, holds, user-removed) never contribute.
    const scoped = transactions.filter(t => !t.excludedFromReceipt);

    const results = GENERATORS
        .map(g => g(scoped, context))
        .filter((i): i is Insight => i !== null)
        .sort((a, b) => b.priority - a.priority);

    const feeInsight = results.find(i => i.kind === 'fee_total');
    const top = results.slice(0, 5);

    if (feeInsight && !top.includes(feeInsight)) {
        top.pop();
        top.push(feeInsight);
        top.sort((a, b) => b.priority - a.priority);
    }

    return top;
}

// A 3-4 line plain-text summary suitable for copying into WhatsApp.
export function summariseForShare(insights: Insight[]): string {
    const lines = insights
        .slice(0, 3)
        .map(i => `${i.emoji ? i.emoji + ' ' : ''}${i.headline}`);
    lines.push('— via M-Track');
    return lines.join('\n');
}

// Second-person -> first-person, so an insight headline reads like something
// the user would actually say about their own money ("You paid..." becomes
// "I paid..."). Order matters: contractions before the bare pronoun.
function toFirstPerson(text: string): string {
    return text
        .replace(/\bYou're\b/g, "I'm")
        .replace(/\bYou've\b/g, "I've")
        .replace(/\bYou\b/g, 'I')
        .replace(/\byour\b/g, 'my')
        .replace(/\byours\b/g, 'mine')
        .replace(/\byou\b/g, 'me');
}

// The actual viral unit — a single surprising number about the user's own
// money, framed as a quote they'd screenshot and post. A receipt is
// private; this is shareable.
export function buildInsightShareSnippet(insight: Insight): string {
    const parts = [toFirstPerson(insight.headline)];
    if (insight.detail) parts.push(toFirstPerson(insight.detail));
    return `"${parts.join(' ')}"\n— spotted with M-Track, mtrack.vercel.app`;
}
