import type { ParsedTransaction, TransactionSubType, ParseStats, SkippedMessage } from './types';
import { preprocessToBlocks, dedupeTransactions } from './preprocess';
import { extractAmount, extractFee, extractBalance } from './extractors/amount';
import { extractDate } from './extractors/date';
import { extractCode } from './extractors/code';
import { extractParties } from './extractors/parties';
import { extractDirection } from './extractors/direction';
import { extractChannel, extractCardLast4 } from './extractors/channel';
import { extractMerchant } from './extractors/merchant';
import { scoreTransaction } from './confidence';
import { applyProviderHint } from './hints/providerHints';
import { classifyMessage } from './classify';
import { linkTransactions, type RawBlockResult } from './linkTransactions';
import { applyVerificationChargeDetection } from './verificationCharge';

export type { ParseStats, SkippedMessage };

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
// nothing downstream needs to change. Exported for the manual-entry recovery
// path (Part 6) so it derives subType the same way the main pipeline does.
export function deriveSubType(
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
        case 'virtual_card':
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

// Runs every extractor over one block without judging the result — amount
// and date may both come back null. Rejection only happens after linking,
// once a block has had the chance to inherit fields from a sibling sharing
// its transaction code (see linkTransactions.ts). Exported for Part 6's
// single-block recovery retry, which skips the cross-block linking step
// entirely (linking is a batch operation over multiple blocks — retrying
// one already-skipped block in isolation has nothing to link against).
export function extractRawBlock(rawBlock: string, index: number): RawBlockResult {
    const amount = extractAmount(rawBlock);
    const fee = extractFee(rawBlock);
    const balance = extractBalance(rawBlock);
    const dateResult = extractDate(rawBlock);
    const direction = extractDirection(rawBlock);
    const parties = extractParties(rawBlock);
    const channel = extractChannel(rawBlock);
    const merchant = extractMerchant(rawBlock, parties.recipient);
    const cardLast4 = extractCardLast4(rawBlock);
    const isoDate = dateResult ? dateResult.date.toISOString() : null;
    const codeResult = extractCode(rawBlock, {
        merchant: merchant?.name ?? null,
        amount: amount?.amount ?? null,
        isoDate,
    });
    const failed = /was declined|declined|unsuccessful|failed/i.test(rawBlock);

    return {
        index, rawBlock, amount, fee, balance, dateResult, direction, parties,
        channel, merchant, codeResult, cardLast4, failed,
    };
}

// Applies the amount/date requirement and confidence threshold to a
// (possibly already-merged) block result, and derives the full transaction
// record. Returns null if the record still isn't trustworthy enough to keep.
// minScore defaults to the normal pipeline's threshold (40); Part 6's
// recovery retry calls this directly with a temporarily loosened threshold
// (25) for one explicit, human-vouched-for block — never applied globally.
export function finalizeTransaction(r: RawBlockResult, minScore = 40): ParsedTransaction | null {
    const { amount, dateResult, direction, parties, channel, merchant, codeResult } = r;

    // Amount and date are structurally required — nothing else can substitute.
    if (!amount || !dateResult) return null;

    const displayName =
        merchant?.name ??
        parties.recipient ??
        parties.sender ??
        fallbackNameForMethod(channel.method) ??
        'Unknown';

    const isBusiness = (merchant?.isBusiness ?? false) || ['till', 'paybill', 'card', 'virtual_card'].includes(channel.method);
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
    const boost = applyProviderHint(r.rawBlock, channel.provider);
    const score = Math.min(100, base.score + boost);
    const level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 75 ? 'medium' : 'low';

    // Below this, the extracted fields aren't trustworthy enough to keep.
    if (score < minScore) return null;

    const isHold = amount.amount === 0;

    return {
        date: dateResult.date,
        time: dateResult.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
        type: direction.type,
        subType,
        amount: amount.amount,
        recipient: displayName,
        transactionCode: codeResult.code,
        balance: r.balance,
        transactionCost: r.fee,
        rawLine: r.rawBlock,
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
        failed: r.failed,
        isHold,
        isVerificationCharge: false,
        cardLast4: r.cardLast4,
    };
}

export function parseAllMessages(
    raw: string
): { transactions: ParsedTransaction[]; stats: ParseStats; skippedMessages: SkippedMessage[] } {
    const blocks = preprocessToBlocks(raw);

    let serviceNoticeCount = 0;
    let securityAlertCount = 0;
    const serviceNoticeSamples: string[] = [];
    const noiseSamples: string[] = [];
    const transactionBlocks: { block: string; index: number }[] = [];
    // Full (untruncated) text of every block that wasn't even classified as
    // a transaction — recoverable via Part 6's review UI, unlike the
    // 120-char *Samples above, which only exist for the stats summary.
    const notTransactionBlocks: string[] = [];

    blocks.forEach((block, index) => {
        const cls = classifyMessage(block);
        if (cls === 'transaction') {
            transactionBlocks.push({ block, index });
            return;
        }
        if (cls === 'service_notice') {
            serviceNoticeCount++;
            if (serviceNoticeSamples.length < 3) serviceNoticeSamples.push(block.slice(0, 120));
            notTransactionBlocks.push(block);
            return;
        }
        if (cls === 'security_alert') {
            securityAlertCount++;
            if (noiseSamples.length < 3) noiseSamples.push(block.slice(0, 120));
            notTransactionBlocks.push(block);
            return;
        }
        // 'promotional' and 'unknown' — set aside silently, same as before.
        if (noiseSamples.length < 3) noiseSamples.push(block.slice(0, 120));
        notTransactionBlocks.push(block);
    });

    const rawResults = transactionBlocks.map(({ block, index }) => extractRawBlock(block, index));
    const linked = linkTransactions(rawResults);

    const finalized = linked.map(r => finalizeTransaction(r));
    const successfulTransactions = finalized.filter((t): t is ParsedTransaction => t !== null);
    const failedToFinalize = linked.length - successfulTransactions.length;
    const unreadableBlocks = linked
        .filter((_r, i) => finalized[i] === null)
        .map(r => r.rawBlock);

    const withVerificationCharges = applyVerificationChargeDetection(successfulTransactions);

    const { unique, duplicatesRemoved, removed: duplicateTransactions } = dedupeTransactions(withVerificationCharges);
    unique.sort((a, b) => a.date.getTime() - b.date.getTime());

    const skippedMessages: SkippedMessage[] = [
        ...notTransactionBlocks.map((rawText): SkippedMessage => ({ rawText, reason: 'not-a-transaction' })),
        ...unreadableBlocks.map((rawText): SkippedMessage => ({ rawText, reason: 'unreadable' })),
        ...duplicateTransactions.map((t): SkippedMessage => ({ rawText: t.rawLine, reason: 'duplicate' })),
    ];

    const stats: ParseStats = {
        totalBlocks: blocks.length,
        parsed: unique.length,
        rejected: (blocks.length - transactionBlocks.length) + failedToFinalize,
        duplicatesRemoved,
        byProvider: {},
        byMethod: {},
        byConfidence: { high: 0, medium: 0, low: 0 },
        ambiguousDates: 0,
        syntheticCodes: 0,
        holds: 0,
        failed: 0,
        unparsedSamples: noiseSamples,
        serviceNoticeCount,
        securityAlertCount,
        serviceNoticeSamples,
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

    return { transactions: unique, stats, skippedMessages };
}

export function parseAllSMS(raw: string): ParsedTransaction[] {
    return parseAllMessages(raw).transactions;
}
