import type { ParsedTransaction } from '../../types';
import { bucketOf, isCashSale, UNSORTED } from '../activeMode/session';
import { fmtAmountProse } from '../transactionDisplay';

// The day card's data: everything the layout in dayCardLayout.ts needs, and
// nothing it has to compute itself. Every adaptive rule in the design (Phase
// 3.4 — swap the tile, collapse to one line, degrade the hero) is decided
// HERE, from the real transactions, so the layout only ever draws what it is
// told rather than re-deriving a judgement call from raw data of its own.
//
// Degrades, never breaks: a sparse day, a single bucket, everything in
// Unsorted, no clock times at all — every one of these produces a complete,
// correct DayCardData, never a missing field or a thrown error. See the tests
// for the fixture matching each row of Phase 3.4's table.

export interface DayCardBucketRow {
    label: string;
    amount: string;
    // 0–1, this bucket's share of the day's total — the bar's fill fraction.
    share: number;
}

export type PrimaryTile =
    | { kind: 'peakHour'; label: string }
    | { kind: 'biggestSale'; label: string };

export interface DayCardData {
    // ── Header ──
    // null -> "Today's sales" in the layout. Never asked for; set only by
    // tapping the card afterwards (Phase 1.6).
    stallName: string | null;
    // "Sat 26 Sep", or "Sat 26 to Sun 27 Sep" for a session that crossed
    // midnight. Never a relative label.
    dateLabel: string;

    // ── Hero ──
    hasCash: boolean;
    heroLabel: string; // "M-PESA SALES TODAY" or "SALES TODAY"
    heroAmount: string; // exact, comma-grouped, never rounded
    // null when there is nothing to show under the hero (no cash).
    paymentSplitLine: string | null;

    // ── Tiles ──
    saleCountLabel: string;
    averageLabel: string;
    averageExcludesNote: string | null; // shown ON the card, per 2.2.7
    primaryTile: PrimaryTile;

    // ── Bucket section ──
    // Both null together means "collapse to the single-bucket line" (3.4).
    buckets: DayCardBucketRow[] | null;
    otherBucketsLabel: string | null; // "3 other buckets", already summed into a row above if present — see buildBucketRows
    singleBucketLine: string | null; // "All in Combo sales."
    topBucketSentence: string | null; // "Combo sales were 58% of the day."

    // ── Footer ──
    footerLine: string;

    // ── Private notes (Phase 3.5) — shown above the preview, NEVER exported ──
    unsortedNote: { count: number; amountLabel: string } | null;
    missingTimesNote: { count: number } | null;
    duplicatesNote: { count: number } | null;
    balanceNote: BalanceNote | null;

    currency: string;
    saleCount: number;
    totalAmount: number;
}

export type BalanceNote =
    | { kind: 'match' }
    | { kind: 'surplus'; amountLabel: string }
    | { kind: 'shortfall'; amountLabel: string };

// ── Whole-shilling formatting, for the Average tile only — every other
// figure on the card is exact (fmtAmountProse), but 3.1 explicitly wants the
// average in whole currency units. ──
function fmtWhole(n: number, currency: string): string {
    return fmtAmountProse(Math.round(n), currency);
}

// ── Counting rules (Phase 2.2.7 / 3.4) ──────────────────────────────────────
//
// A lump sum with no stated count contributes its money to the hero (every
// shilling is real) but not to the sale count or the average — counting it as
// "one sale" would understate the day as badly as guessing a count would
// invent one.
function countedSaleCount(t: ParsedTransaction): number {
    if (!t.isLumpSum) return 1;
    return t.lumpSumCount ?? 0;
}

function excludesLumpSum(transactions: ParsedTransaction[]): boolean {
    return transactions.some(t => t.isLumpSum && t.lumpSumCount == null);
}

// ── Date range ───────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDayShort(d: Date): string {
    return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

export function dayCardDateLabel(transactions: ParsedTransaction[], now: Date): string {
    const dated = transactions.filter(t => Number.isFinite(t.date?.getTime?.()));
    if (dated.length === 0) return fmtDayShort(now);
    const times = dated.map(t => t.date.getTime()).sort((a, b) => a - b);
    const from = new Date(times[0]);
    const to = new Date(times[times.length - 1]);
    const sameDay = from.toDateString() === to.toDateString();
    return sameDay ? fmtDayShort(from) : `${fmtDayShort(from)} to ${fmtDayShort(to)}`;
}

// ── Peak hour / biggest sale (Phase 3.4's tile swap) ─────────────────────────
//
// "30% or more of the counted sales have no clock time" swaps the Peak hour
// tile for Biggest sale. A lump sum never carries a time (Phase 2.2.6) and is
// itself excluded from the sale count when uncounted, so it is judged by the
// same rule as everything else: does IT have a usable time to contribute.

function hasTime(t: ParsedTransaction): boolean {
    return !!t.time && t.time.trim().length > 0;
}

function fmtHourRange(hour: number, compact: boolean): string {
    const to12 = (h: number) => {
        const period = h < 12 ? 'AM' : 'PM';
        const twelveHour = h % 12 === 0 ? 12 : h % 12;
        return { twelveHour, period };
    };
    const a = to12(hour);
    const b = to12((hour + 1) % 24);
    if (compact) return `${a.twelveHour}-${b.twelveHour}${b.period}`;
    // Same period ("1 to 2 PM") vs crossing noon/midnight ("11 AM to 12 PM").
    return a.period === b.period
        ? `${a.twelveHour} to ${b.twelveHour} ${b.period}`
        : `${a.twelveHour} ${a.period} to ${b.twelveHour} ${b.period}`;
}

function computePrimaryTile(
    transactions: ParsedTransaction[], counted: ParsedTransaction[], currency: string,
): PrimaryTile {
    const withTime = counted.filter(hasTime);
    const missingShare = counted.length === 0 ? 1 : 1 - withTime.length / counted.length;

    if (counted.length === 0 || missingShare >= 0.3) {
        // The single largest amount, lump sums included — a lump sum's total
        // is still real money that came in through one entry, and excluding
        // it could leave nothing to show at all on a day built entirely from
        // lump sums, which is exactly the kind of day this tile swap exists
        // for in the first place.
        const biggest = [...transactions].sort((a, b) => b.amount - a.amount)[0];
        return {
            kind: 'biggestSale',
            label: biggest ? fmtAmountProse(biggest.amount, currency) : fmtAmountProse(0, currency),
        };
    }

    const hourCounts = new Map<number, number>();
    for (const t of withTime) {
        const hour = parseHour(t.time);
        if (hour == null) continue;
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }
    if (hourCounts.size === 0) {
        return { kind: 'biggestSale', label: fmtAmountProse(transactions[0]?.amount ?? 0, currency) };
    }
    const [topHour] = [...hourCounts.entries()].sort(([, a], [, b]) => b - a)[0];
    // The compact form ("1-2 PM") is used only when the full one would not
    // fit — the layout decides that from the rendered width, so both forms
    // are computed here and the layout picks.
    return { kind: 'peakHour', label: fmtHourRange(topHour, false) };
}

// Parses M-Track's own "h:mm AM/PM" time string (see buildSelfReportedTransaction
// and the SMS date extractor, which both produce this exact shape) into a 24h
// hour. Returns null for anything that doesn't parse rather than guessing.
function parseHour(time: string): number | null {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/.exec(time.trim());
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const period = m[3]?.toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h;
}

export const dayCardCompactHourLabel = (label: string): string => {
    // Re-derives the compact form from the full one's hour numbers, for the
    // layout to fall back to when the full label doesn't fit. "1 to 2 PM" /
    // "11 AM to 12 PM" -> "1-2PM" / "11AM-12PM".
    const m = /^(\d{1,2})\s*(AM|PM)?\s*to\s*(\d{1,2})\s*(AM|PM)$/.exec(label);
    if (!m) return label;
    const [, a, aPeriod, b, bPeriod] = m;
    return aPeriod ? `${a}${aPeriod}-${b}${bPeriod}` : `${a}-${b}${bPeriod}`;
};

// ── Buckets (Phase 3.4: top 4, "N other", Unsorted always separate) ─────────

function buildBucketRows(
    transactions: ParsedTransaction[], currency: string,
): { rows: DayCardBucketRow[]; otherLabel: string | null; topLabel: string; topShare: number; count: number } {
    const groups = new Map<string, number>();
    for (const t of transactions) {
        const key = bucketOf(t);
        groups.set(key, (groups.get(key) ?? 0) + t.amount);
    }
    const total = [...groups.values()].reduce((s, v) => s + v, 0);

    const unsorted = groups.get(UNSORTED) ?? 0;
    const named = [...groups.entries()]
        .filter(([label]) => label !== UNSORTED)
        .sort(([, a], [, b]) => b - a);

    const shownNamed = named.slice(0, 4);
    const rest = named.slice(4);
    const restTotal = rest.reduce((s, [, v]) => s + v, 0);

    const rows: DayCardBucketRow[] = shownNamed.map(([label, amount]) => ({
        label, amount: fmtAmountProse(amount, currency), share: total > 0 ? amount / total : 0,
    }));
    let otherLabel: string | null = null;
    if (rest.length > 0) {
        otherLabel = `${rest.length} other bucket${rest.length === 1 ? '' : 's'}`;
        rows.push({ label: otherLabel, amount: fmtAmountProse(restTotal, currency), share: total > 0 ? restTotal / total : 0 });
    }
    // Unsorted is always listed on its own if non-zero, and always last —
    // it is a leftovers bin, not a category competing on amount.
    if (unsorted > 0) {
        rows.push({ label: UNSORTED, amount: fmtAmountProse(unsorted, currency), share: total > 0 ? unsorted / total : 0 });
    }

    const [topLabel, topAmount] = named[0] ?? [UNSORTED, unsorted];
    return { rows, otherLabel, topLabel, topShare: total > 0 ? topAmount / total : 0, count: groups.size };
}

// ── Balance check (Phase 3.5) ────────────────────────────────────────────────
//
// A simpler, purpose-built check rather than a reuse of the SMS pipeline's
// pairwise balance oracle (balanceOracle.ts) — that oracle answers "which
// direction does this ONE transaction's balance movement prove", a different
// question from "does the day's total money-in match what the vendor actually
// logged". Only runs when every M-Pesa sale carries a stored balance, which is
// the one precondition that makes the arithmetic honest.
export function computeBalanceNote(mpesaSales: ParsedTransaction[], currency: string): BalanceNote | null {
    const dated = mpesaSales.filter(t => Number.isFinite(t.date?.getTime?.())).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (dated.length < 2) return null;
    if (dated.some(t => t.balance == null)) return null;

    const first = dated[0];
    const last = dated[dated.length - 1];
    const actualMovement = (last.balance as number) - (first.balance as number);
    // The first sale's own amount already moved the balance before its own
    // reading, so the sales counted are every one AFTER the first.
    const loggedSum = dated.slice(1).reduce((s, t) => s + t.amount, 0);
    const diff = Math.round((actualMovement - loggedSum) * 100) / 100;

    if (Math.abs(diff) < 1) return { kind: 'match' };
    return diff > 0
        ? { kind: 'surplus', amountLabel: fmtAmountProse(diff, currency) }
        : { kind: 'shortfall', amountLabel: fmtAmountProse(Math.abs(diff), currency) };
}

// ── The whole thing ──────────────────────────────────────────────────────────

export interface BuildDayCardOptions {
    stallName: string | null;
    now: Date;
    duplicatesRemoved?: number;
}

export function buildDayCardData(transactions: ParsedTransaction[], opts: BuildDayCardOptions): DayCardData {
    const currency = transactions[0]?.currency ?? 'KES';
    const totalAmount = Math.round(transactions.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const hasCash = transactions.some(isCashSale);
    const counted = transactions.filter(t => countedSaleCount(t) > 0);
    const saleCount = transactions.reduce((s, t) => s + countedSaleCount(t), 0);

    const mpesaTotal = transactions.filter(t => !isCashSale(t)).reduce((s, t) => s + t.amount, 0);
    const cashTotal = transactions.filter(isCashSale).reduce((s, t) => s + t.amount, 0);

    const { rows, otherLabel, topLabel, topShare, count: bucketCount } = buildBucketRows(transactions, currency);
    // Collapse to the single-bucket line only when literally one bucket has
    // any money in it at all (3.4's "one bucket only" row).
    const singleBucket = bucketCount === 1;

    // The average divides by the SAME money the sale count represents — an
    // uncounted lump sum's total is in the hero (every shilling is real) but
    // must not inflate the average of the sales that WERE counted individually.
    const countedAmount = counted.reduce((s, t) => s + t.amount, 0);
    const average = saleCount > 0 ? countedAmount / saleCount : 0;
    const excludesLump = excludesLumpSum(transactions);

    const unsortedTxns = transactions.filter(t => bucketOf(t) === UNSORTED);
    const unsortedAmount = unsortedTxns.reduce((s, t) => s + t.amount, 0);

    const mpesaSales = transactions.filter(t => !isCashSale(t));
    const balanceNote = computeBalanceNote(mpesaSales, currency);

    const missingTimeCount = transactions.filter(t => !t.isLumpSum && !hasTime(t)).length;
    const handEnteredCount = transactions.filter(t => t.dataSource === 'self_reported').length;

    return {
        stallName: opts.stallName,
        dateLabel: dayCardDateLabel(transactions, opts.now),

        hasCash,
        heroLabel: hasCash ? 'SALES TODAY' : "M-PESA SALES TODAY",
        heroAmount: fmtAmountProse(totalAmount, currency),
        paymentSplitLine: hasCash
            ? `M-Pesa ${fmtAmountProse(mpesaTotal, currency)}  ·  Cash ${fmtAmountProse(cashTotal, currency)}`
            : null,

        saleCountLabel: String(saleCount),
        averageLabel: fmtWhole(average, currency),
        averageExcludesNote: excludesLump ? 'Average excludes cash entered as a lump sum.' : null,
        primaryTile: computePrimaryTile(transactions, counted, currency),

        buckets: singleBucket ? null : rows,
        otherBucketsLabel: singleBucket ? null : otherLabel,
        singleBucketLine: singleBucket ? `All in ${topLabel}.` : null,
        // The bucket's own name is whatever noun the vendor chose ("Combo
        // sales", "Drinks") — the sentence adds nothing after it, exactly
        // matching the design's own example ("Combo sales were 58% of the
        // day.", not "Combo sales sales were...").
        topBucketSentence: !singleBucket && bucketCount >= 2 && topLabel !== UNSORTED
            ? `${topLabel} were ${Math.round(topShare * 100)}% of the day.`
            : null,

        footerLine: footerLine(hasCash, handEnteredCount),

        unsortedNote: unsortedTxns.length > 0
            ? { count: unsortedTxns.length, amountLabel: fmtAmountProse(unsortedAmount, currency) }
            : null,
        missingTimesNote: missingTimeCount > 0 ? { count: missingTimeCount } : null,
        duplicatesNote: opts.duplicatesRemoved ? { count: opts.duplicatesRemoved } : null,
        balanceNote: balanceNote && balanceNote.kind !== 'match' ? balanceNote : null,

        currency,
        saleCount,
        totalAmount,
    };
}

function footerLine(hasCash: boolean, handEnteredCount: number): string {
    const base = hasCash
        ? 'Includes cash entered by the seller'
        : 'M-Pesa sales only';
    const hand = handEnteredCount > 0 && !hasCash
        ? ` · Includes ${handEnteredCount} sale${handEnteredCount === 1 ? '' : 's'} entered by hand`
        : '';
    return `${base}${hand}  ·  Made with M-Track`;
}
