// Groups per-block extraction results by shared transaction code and merges
// siblings into one record before the amount/date requirement or confidence
// threshold is applied. This is what lets a card-approval confirmation (which
// carries the real merchant but no parseable date) contribute its fields to
// the M-PESA SMS it belongs with, instead of being dropped as unparseable.

import type { AmountResult, DateResult, DirectionResult, ChannelResult, MerchantResult, CodeResult, PartiesResult } from './types';

export interface RawBlockResult {
    index: number;
    rawBlock: string;
    amount: AmountResult | null;
    fee: number | null;
    balance: number | null;
    dateResult: DateResult | null;
    direction: DirectionResult;
    parties: PartiesResult;
    channel: ChannelResult;
    merchant: MerchantResult | null;
    codeResult: CodeResult;
    cardLast4: string | null;
    failed: boolean;
}

const GENERIC_PARTY_RE = /^M-PESA CARD$/i;

function moreDescriptive(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    const aGeneric = GENERIC_PARTY_RE.test(a);
    const bGeneric = GENERIC_PARTY_RE.test(b);
    if (aGeneric && !bGeneric) return b;
    if (bGeneric && !aGeneric) return a;
    return a.length >= b.length ? a : b;
}

function pickAmount(a: AmountResult | null, b: AmountResult | null): AmountResult | null {
    if (a && !b) return a;
    if (b && !a) return b;
    if (a && b) return a.confidence >= b.confidence ? a : b;
    return null;
}

function pickDate(a: DateResult | null, b: DateResult | null): DateResult | null {
    if (a && !b) return a;
    if (b && !a) return b;
    if (a && b) {
        if (a.ambiguous === b.ambiguous) return a;
        return a.ambiguous ? b : a;
    }
    return null;
}

function pickDirection(a: DirectionResult, b: DirectionResult): DirectionResult {
    return a.confidence >= b.confidence ? a : b;
}

function pickChannel(a: ChannelResult, b: ChannelResult): ChannelResult {
    const aVirtual = a.method === 'virtual_card';
    const bVirtual = b.method === 'virtual_card';
    if (aVirtual && !bVirtual) return a;
    if (bVirtual && !aVirtual) return b;
    return a.confidence >= b.confidence ? a : b;
}

function pickMerchant(a: MerchantResult | null, b: MerchantResult | null): MerchantResult | null {
    if (a && !b) return a;
    if (b && !a) return b;
    if (a && b) {
        if (a.location && !b.location) return a;
        if (b.location && !a.location) return b;
        return a;
    }
    return null;
}

function pickParties(a: PartiesResult, b: PartiesResult): PartiesResult {
    return {
        recipient: moreDescriptive(a.recipient, b.recipient),
        sender: moreDescriptive(a.sender, b.sender),
        account: a.account ?? b.account,
    };
}

function pickCode(a: CodeResult, b: CodeResult): CodeResult {
    if (a.synthetic && !b.synthetic) return b;
    return a;
}

function mergeTwo(a: RawBlockResult, b: RawBlockResult): RawBlockResult {
    // Keep original block order (earlier block first) so provider-hint
    // matching, which anchors on the start of the text, still works.
    const [first, second] = a.index <= b.index ? [a, b] : [b, a];

    return {
        index: first.index,
        rawBlock: `${first.rawBlock}\n\n${second.rawBlock}`,
        amount: pickAmount(a.amount, b.amount),
        fee: a.fee ?? b.fee,
        balance: a.balance ?? b.balance,
        dateResult: pickDate(a.dateResult, b.dateResult),
        direction: pickDirection(a.direction, b.direction),
        parties: pickParties(a.parties, b.parties),
        channel: pickChannel(a.channel, b.channel),
        merchant: pickMerchant(a.merchant, b.merchant),
        codeResult: pickCode(a.codeResult, b.codeResult),
        cardLast4: a.cardLast4 ?? b.cardLast4,
        failed: a.failed || b.failed,
    };
}

// Groups by transaction code and folds every group of 2+ into a single
// merged record. Groups of 1 pass through untouched.
export function linkTransactions(results: RawBlockResult[]): RawBlockResult[] {
    const groups = new Map<string, RawBlockResult[]>();
    for (const r of results) {
        const key = r.codeResult.code;
        const bucket = groups.get(key);
        if (bucket) bucket.push(r);
        else groups.set(key, [r]);
    }

    const merged: RawBlockResult[] = [];
    for (const bucket of groups.values()) {
        if (bucket.length === 1) {
            merged.push(bucket[0]);
            continue;
        }

        // Byte-identical repeats sharing a code (the same SMS pasted twice)
        // are duplicates, not siblings — leave them separate so the
        // downstream dedupeTransactions pass collapses them and counts
        // them correctly, instead of silently folding them into one here.
        const distinctTexts = new Set(bucket.map(r => r.rawBlock));
        if (distinctTexts.size === 1) {
            merged.push(...bucket);
            continue;
        }

        merged.push(bucket.reduce((acc, r) => (acc === r ? r : mergeTwo(acc, r))));
    }
    return merged;
}
