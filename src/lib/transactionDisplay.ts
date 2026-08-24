import type { ParsedTransaction } from '../types';

function commaGroup(n: number): string {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Prose-rounded Ksh amount, for insights and other conversational copy —
// deliberately coarser than the exact 2-decimal figures used on receipts.
//   < 1,000        exact          "Ksh 847"
//   1,000-99,999   nearest 10     "Ksh 26,270"
//   100,000-999,999 nearest 100   "Ksh 234,500"
//   1,000,000+     "X.XM" form    "Ksh 1.2M"
export function fmtProse(n: number): string {
    const abs = Math.abs(n);
    if (abs < 1000) return `Ksh ${commaGroup(abs)}`;
    if (abs < 1_000_000) {
        const unit = abs < 100_000 ? 10 : 100;
        return `Ksh ${commaGroup(Math.round(abs / unit) * unit)}`;
    }
    return `Ksh ${(abs / 1_000_000).toFixed(1)}M`;
}

// Whole-number percentage, no decimals — "63%"
export function fmtPercent(n: number): string {
    return `${Math.round(n)}%`;
}

// Shortened provider name for display — "Co-operative Bank" -> "Co-op",
// everything else as-is. Usable directly from an aggregate provider name
// (no transaction needed) as well as from providerChipLabel below.
export function shortProviderName(provider: string): string {
    if (provider === 'Co-operative Bank') return 'Co-op';
    return provider; // 'M-PESA' | 'Unknown' | other bank names as-is
}

// Small uppercase provider tag shown on a transaction row.
export function providerChipLabel(t: ParsedTransaction): string {
    if (t.method === 'card') return 'Card';
    return shortProviderName(t.provider);
}

// One-line reason shown when a transaction is excluded by default.
export function getExclusionReason(t: ParsedTransaction): string | null {
    if (t.isHold) return 'Authorisation hold';
    if (t.failed) return 'Payment declined';
    return null;
}

export function joinNatural(list: string[]): string {
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// "Found {n} transactions across {providerList}." — or the single-provider
// short form: "Found {n} M-PESA transactions."
export function buildFoundSummary(count: number, txns: ParsedTransaction[]): string {
    const buckets = new Set<string>();
    for (const t of txns) {
        if (t.method === 'card') buckets.add('card payments');
        else if (t.provider === 'M-PESA') buckets.add('M-PESA');
        else if (t.provider === 'Co-operative Bank') buckets.add('Co-op Bank');
        else if (t.provider !== 'Unknown') buckets.add(t.provider);
        else buckets.add('other sources');
    }
    const list = [...buckets];
    if (list.length <= 1) {
        const label = list[0];
        return label ? `Found ${count} ${label} transactions.` : `Found ${count} transactions.`;
    }
    return `Found ${count} transactions across ${joinNatural(list)}.`;
}
