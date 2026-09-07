import type { ParseStats } from './parsers';
import type { LinkEnrichment, NearDuplicatePair } from './parsers';
import { fmtProse } from './transactionDisplay';

// A word for a small count, so a sentence reads like a person wrote it
// ("five minutes apart") rather than a log line.
const SMALL_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spell(n: number): string {
    return n >= 0 && n < SMALL_WORDS.length ? SMALL_WORDS[n] : String(n);
}

export interface ParseNotice {
    id: string;
    text: string;
    // 'near-duplicate' notices are rendered as a tappable question rather than
    // a plain bubble, and carry the flagged pair.
    kind?: 'text' | 'near-duplicate';
    nearDuplicate?: NearDuplicatePair;
}

export interface BuildNoticesInput {
    outOfRangeCount?: number;
    linkEnrichments?: LinkEnrichment[];
    nearDuplicates?: NearDuplicatePair[];
}

// Every reconciliation situation the parser can surface routes through here so
// there is one place that decides what the bot says and in what order. The
// governing rule: report what was done and offer to undo it. Never call a
// linked pair a duplicate; never present a judgement call (a near-duplicate)
// as settled fact.
//
// Priority: nothing parsed > all out of range > combined messages > skipped
// (card notices, then anything else) > out of range > ambiguous dates > low
// confidence > card check left out > holds/failures > duplicate paste >
// near-duplicate question.
export function buildParseNotices(stats: ParseStats, input: BuildNoticesInput = {}): ParseNotice[] {
    const { outOfRangeCount = 0, linkEnrichments = [], nearDuplicates = [] } = input;

    if (stats.parsed === 0) {
        return [{
            id: 'nothing',
            text: "Nothing came through. Those might not be transaction messages, or they got mangled on the way over. Try copying them again straight from your SMS app.",
        }];
    }

    if (outOfRangeCount > 0 && outOfRangeCount === stats.parsed) {
        return [{
            id: 'all-out-of-range',
            text: `All ${stats.parsed} transactions fall outside your date range. Want to widen it?`,
        }];
    }

    const notices: ParseNotice[] = [];

    // ── Combined messages (never "duplicate") ──
    if (linkEnrichments.length > 0) {
        const named = linkEnrichments.filter(e => e.merchantName);
        const distinctNames = [...new Set(named.map(e => e.merchantName as string))];
        if (linkEnrichments.length === 1 && distinctNames.length === 1) {
            const gained = linkEnrichments[0].gainedMerchant;
            notices.push({
                id: 'linked',
                text: gained
                    ? `Two messages for the ${distinctNames[0]} payment. I've combined them, the card message had the merchant name.`
                    : `Two messages for the ${distinctNames[0]} payment. I've combined them into one.`,
            });
        } else if (distinctNames.length === 1) {
            const gained = linkEnrichments.some(e => e.gainedMerchant);
            notices.push({
                id: 'linked',
                text: gained
                    ? `Some ${distinctNames[0]} payments came through as two messages each. I've combined them, the card message carried the name.`
                    : `Some ${distinctNames[0]} payments came through as two messages each. I've combined each pair into one.`,
            });
        } else {
            notices.push({
                id: 'linked',
                text: `${linkEnrichments.length} payments arrived as two messages each. I've combined each pair into one.`,
            });
        }
    }

    // ── Skipped: card notices first, then anything else ──
    const cardNotices = stats.serviceNoticeCount;
    const otherRejected = Math.max(0, stats.rejected - cardNotices);
    if (cardNotices > 0) {
        notices.push({
            id: 'card-notices',
            text: `${spell(cardNotices).replace(/^\w/, c => c.toUpperCase())} of those were card notices rather than payments, so I skipped them.`,
        });
    }
    if (otherRejected > 0) {
        notices.push({
            id: 'partial',
            text: `I found ${stats.parsed} transaction${stats.parsed === 1 ? '' : 's'}. ${otherRejected} other message${otherRejected === 1 ? '' : 's'} didn't look like transactions, so I skipped ${otherRejected === 1 ? 'it' : 'them'}.`,
        });
    }

    if (outOfRangeCount > 0) {
        notices.push({
            id: 'out-of-range',
            text: `${outOfRangeCount} transaction${outOfRangeCount === 1 ? '' : 's'} fell outside your date range, so I've set them aside.`,
        });
    }

    if (stats.ambiguousDates > 0) {
        const n = stats.ambiguousDates;
        notices.push({
            id: 'ambiguous',
            text: `Heads up: ${n} date${n === 1 ? '' : 's'} could be read two ways. I've gone day-first, Kenyan style, worth a glance.`,
        });
    }

    if (stats.byConfidence.low > 0) {
        notices.push({
            id: 'lowconf',
            text: "A few of these I'm less sure about. They're marked so you can check them.",
        });
    }

    // ── Verification / card-check charge, explained ──
    if (stats.verificationChargesExcluded > 0) {
        const n = stats.verificationChargesExcluded;
        const amt = stats.verificationChargeAmount != null ? fmtProse(stats.verificationChargeAmount) : null;
        notices.push({
            id: 'verification',
            text: n === 1 && amt
                ? `Left out a ${amt} card check. That's a test charge, not a real payment. Add it back if you want it counted.`
                : `Left out ${n} card checks. Those are test charges, not real payments. Add them back if you want them counted.`,
        });
    }

    if (stats.holds > 0 || stats.failed > 0) {
        notices.push({
            id: 'holdsfailed',
            text: `I left out ${stats.holds} hold${stats.holds === 1 ? '' : 's'} and ${stats.failed} failed payment${stats.failed === 1 ? '' : 's'}. You can add them back if you want them counted.`,
        });
    }

    // ── True duplicate paste ──
    if (stats.duplicatesRemoved > 0) {
        const n = stats.duplicatesRemoved;
        notices.push({
            id: 'dupes',
            text: `Removed ${n} duplicate${n === 1 ? '' : 's'}. Looks like some messages got copied twice.`,
        });
    }

    // ── Near-duplicate: a question, never an assertion, never auto-removal ──
    for (const pair of nearDuplicates) {
        const party = pair.larger.merchant ?? pair.larger.recipient;
        const gap = `${spell(pair.minutesApart)} minute${pair.minutesApart === 1 ? '' : 's'} apart`;
        const amounts = `${fmtProse(pair.larger.amount)} and ${fmtProse(pair.smaller.amount)}`;
        const tail = pair.smallOneIsTrivial
            ? `The ${fmtProse(pair.smaller.amount)} looks like a card check. Keep both?`
            : `These might be the same payment twice. Keep both?`;
        notices.push({
            id: `near-duplicate:${pair.larger.transactionCode}:${pair.smaller.transactionCode}`,
            kind: 'near-duplicate',
            nearDuplicate: pair,
            text: `Two payments to ${party} ${gap}, ${amounts}. ${tail}`,
        });
    }

    return notices;
}
