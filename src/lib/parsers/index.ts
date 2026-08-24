import type { ParsedTransaction, TransactionSubType, ParseStats } from './types';
import { preprocessToBlocks, dedupeTransactions } from './preprocess';
import { extractAmount, extractFee, extractBalance } from './extractors/amount';
import { extractDate } from './extractors/date';
import { extractCode } from './extractors/code';
import { extractParties } from './extractors/parties';
import { extractDirection } from './extractors/direction';
import { extractChannel } from './extractors/channel';
import { extractMerchant } from './extractors/merchant';
import { scoreTransaction } from './confidence';
import { applyProviderHint } from './hints/providerHints';

export type { ParseStats };

function fallbackNameForMethod(method: string): string | null {
    switch (method) {
        case 'airtime': return 'Airtime';
        case 'data': return 'Data Bundle';
        case 'cash': return 'Cash Withdrawal';
        case 'savings': return 'Savings';
        default: return null;
    }
}

// Bridges the rich `method` field back onto the legacy, fixed TransactionSubType
// enum the rest of the app (receiptGenerator, chat) already switches on —
// nothing downstream needs to change.
function deriveSubType(
    method: string,
    type: 'sent' | 'received',
    isBusiness: boolean,
    name: string | null
): TransactionSubType {
    const lower = (name ?? '').toLowerCase();

    if (type === 'received') {
        if (method === 'savings') {
            if (lower.includes('shwari')) return 'mshwari';
            if (lower.includes('ziidi')) return 'investment';
        }
        return 'person_receive';
    }

    switch (method) {
        case 'airtime': return 'airtime';
        case 'data': return 'data';
        case 'cash': return 'withdrawal';
        case 'paybill':
        case 'till':
        case 'card':
            return 'paybill';
        case 'savings':
            if (lower.includes('shwari')) return 'mshwari';
            if (lower.includes('ziidi') || lower.includes('kcb m-pesa')) return 'investment';
            return 'unknown';
        case 'p2p':
            return isBusiness ? 'pochi_send' : 'person_send';
        default:
            return 'unknown';
    }
}

interface BlockResult {
    transaction: ParsedTransaction | null;
}

function processBlock(rawBlock: string): BlockResult {
    const amount = extractAmount(rawBlock);
    const fee = extractFee(rawBlock);
    const dateResult = extractDate(rawBlock);
    const direction = extractDirection(rawBlock);
    const parties = extractParties(rawBlock);
    const channel = extractChannel(rawBlock);
    const merchant = extractMerchant(rawBlock, parties.recipient);
    const isoDate = dateResult ? dateResult.date.toISOString() : null;
    const codeResult = extractCode(rawBlock, {
        merchant: merchant?.name ?? null,
        amount: amount?.amount ?? null,
        isoDate,
    });

    const failed = /was declined|declined|unsuccessful|failed/i.test(rawBlock);
    const isHold = amount != null && amount.amount === 0;

    // Amount and date are structurally required — nothing else can substitute.
    if (!amount || !dateResult) return { transaction: null };

    const displayName =
        merchant?.name ??
        parties.recipient ??
        parties.sender ??
        fallbackNameForMethod(channel.method) ??
        'Unknown';

    const isBusiness = (merchant?.isBusiness ?? false) || ['till', 'paybill', 'card'].includes(channel.method);
    const subType = deriveSubType(channel.method, direction.type, isBusiness, displayName);
    const senderField = direction.type === 'received' ? (parties.sender ?? displayName) : null;

    const partial: Partial<ParsedTransaction> = {
        amount: amount.amount,
        date: dateResult.date,
        type: direction.type,
        sender: senderField,
        recipient: displayName,
        transactionCode: codeResult.code,
        codeIsSynthetic: codeResult.synthetic,
        provider: channel.provider,
        method: channel.method,
    };

    const base = scoreTransaction(partial);
    const boost = applyProviderHint(rawBlock, channel.provider);
    const score = Math.min(100, base.score + boost);
    const level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 75 ? 'medium' : 'low';

    // Below this, the extracted fields aren't trustworthy enough to keep.
    if (score < 40) return { transaction: null };

    const transaction: ParsedTransaction = {
        date: dateResult.date,
        time: dateResult.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
        type: direction.type,
        subType,
        amount: amount.amount,
        recipient: displayName,
        transactionCode: codeResult.code,
        balance: extractBalance(rawBlock),
        transactionCost: fee,
        rawLine: rawBlock,
        label: null,
        customLabel: null,
        receiptLabel: null,
        excludedFromReceipt: false,

        currency: amount.currency,
        sender: senderField,
        account: parties.account,
        provider: channel.provider,
        method: channel.method,
        merchant: merchant?.name ?? null,
        merchantCategory: merchant?.category ?? null,
        location: merchant?.location ?? null,
        isBusiness,

        confidence: score,
        confidenceLevel: level,
        missingFields: base.missing,
        codeIsSynthetic: codeResult.synthetic,
        dateAmbiguous: dateResult.ambiguous,
        failed,
        isHold,
    };

    return { transaction };
}

export function parseAllMessages(raw: string): { transactions: ParsedTransaction[]; stats: ParseStats } {
    const blocks = preprocessToBlocks(raw);
    const results = blocks.map(processBlock);

    const successfulTransactions = results
        .map(r => r.transaction)
        .filter((t): t is ParsedTransaction => t !== null);

    const rejectedBlocks = blocks.filter((_, i) => results[i].transaction === null);

    const { unique, duplicatesRemoved } = dedupeTransactions(successfulTransactions);
    unique.sort((a, b) => a.date.getTime() - b.date.getTime());

    const stats: ParseStats = {
        totalBlocks: blocks.length,
        parsed: unique.length,
        rejected: rejectedBlocks.length,
        duplicatesRemoved,
        byProvider: {},
        byMethod: {},
        byConfidence: { high: 0, medium: 0, low: 0 },
        ambiguousDates: 0,
        syntheticCodes: 0,
        holds: 0,
        failed: 0,
        unparsedSamples: rejectedBlocks.slice(0, 3).map(b => b.slice(0, 120)),
    };

    for (const t of unique) {
        stats.byProvider[t.provider] = (stats.byProvider[t.provider] ?? 0) + 1;
        stats.byMethod[t.method] = (stats.byMethod[t.method] ?? 0) + 1;
        stats.byConfidence[t.confidenceLevel]++;
        if (t.dateAmbiguous) stats.ambiguousDates++;
        if (t.codeIsSynthetic) stats.syntheticCodes++;
        if (t.isHold) stats.holds++;
        if (t.failed) stats.failed++;
    }

    return { transactions: unique, stats };
}

export function parseAllSMS(raw: string): ParsedTransaction[] {
    return parseAllMessages(raw).transactions;
}
