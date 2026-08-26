import { useCallback, useEffect, useState } from 'react';
import type { ParsedTransaction, StoredReceipt } from '../types';
import * as receiptStore from './receiptStore';
import { getReceiptFingerprint } from './downloadUtils';

function rehydrate(receipt: StoredReceipt): StoredReceipt {
    return {
        ...receipt,
        transactions: receipt.transactions.map(t => ({ ...t, date: new Date(t.date) })),
    };
}

function topRecipientsByAmount(txns: ParsedTransaction[]): string[] {
    const totals = new Map<string, number>();
    for (const t of txns) {
        totals.set(t.recipient, (totals.get(t.recipient) ?? 0) + t.amount);
    }
    return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
}

function uniqueLabels(txns: ParsedTransaction[]): string[] {
    return [...new Set(txns.map(t => t.receiptLabel).filter((l): l is string => !!l))];
}

export function useReceiptStore() {
    const [receipts, setReceipts] = useState<StoredReceipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAvailable, setIsAvailable] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const all = await receiptStore.getAllReceipts();
            setReceipts(all.map(rehydrate));
            setIsAvailable(true);
        } catch {
            setReceipts([]);
            setIsAvailable(false);
        }
    }, []);

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            await refresh();
            setIsLoading(false);
        })();
    }, [refresh]);

    const saveReceipt = useCallback(async (receipt: StoredReceipt) => {
        try {
            await receiptStore.saveReceipt(receipt);
            await refresh();
        } catch {
            setIsAvailable(false);
        }
    }, [refresh]);

    const deleteReceipt = useCallback(async (id: string) => {
        try {
            await receiptStore.deleteReceipt(id);
            await refresh();
        } catch {
            setIsAvailable(false);
        }
    }, [refresh]);

    // Saves a summary to history — or, if a receipt with the same
    // transaction-set fingerprint is already there, updates that entry in
    // place instead of skipping. The fingerprint is keyed on transaction
    // codes/amounts/dates only (see getReceiptFingerprint), not labels, so
    // labeling transactions after the first save doesn't change the
    // fingerprint — re-saving (e.g. pressing Save/Share again after
    // labeling) refreshes the existing history entry's content rather than
    // silently leaving it stale or creating a duplicate.
    const saveIfNew = useCallback(async (transactions: ParsedTransaction[], dateRangeLabel: string): Promise<void> => {
        try {
            const fingerprint = await getReceiptFingerprint(transactions);
            const current = await receiptStore.getAllReceipts();
            let existingId: string | null = null;
            let existingCreatedAt = Date.now();
            for (const existing of current) {
                if ((await getReceiptFingerprint(existing.transactions)) === fingerprint) {
                    existingId = existing.id;
                    existingCreatedAt = existing.createdAt;
                    break;
                }
            }

            const activeTxns = transactions.filter(t => !t.excludedFromReceipt);
            const totalFees = activeTxns.reduce((s, t) => s + (t.transactionCost ?? 0), 0);
            const totalReceived = activeTxns
                .filter(t => t.type === 'received')
                .reduce((s, t) => s + t.amount, 0);
            const totalSpent = activeTxns
                .filter(t => t.type === 'sent' && t.subType !== 'mshwari' && t.subType !== 'investment')
                .reduce((s, t) => s + t.amount, 0);

            const receipt: StoredReceipt = {
                id: existingId ?? crypto.randomUUID(),
                createdAt: existingCreatedAt,
                dateRange: dateRangeLabel,
                transactionCount: activeTxns.length,
                totalSpent,
                totalReceived,
                totalFees,
                transactions,
                topRecipients: topRecipientsByAmount(activeTxns),
                labels: uniqueLabels(activeTxns),
            };
            await receiptStore.saveReceipt(receipt);
            await refresh();
        } catch {
            // IndexedDB unavailable, or the write itself failed (e.g. quota
            // exceeded) — app still works, but the caller needs to know the
            // summary was NOT actually saved to history, not silently drop it.
            setIsAvailable(false);
        }
    }, [refresh]);

    return { receipts, isLoading, isAvailable, saveReceipt, deleteReceipt, saveIfNew };
}
