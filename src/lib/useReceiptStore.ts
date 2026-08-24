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

    // Saves a summary to history, skipping it if a receipt with the same
    // transaction fingerprint is already there — safe to call more than
    // once for the same summary (e.g. the user hits Save/Share a few times).
    const saveIfNew = useCallback(async (transactions: ParsedTransaction[], dateRangeLabel: string): Promise<void> => {
        try {
            const fingerprint = await getReceiptFingerprint(transactions);
            const current = await receiptStore.getAllReceipts();
            for (const existing of current) {
                if ((await getReceiptFingerprint(existing.transactions)) === fingerprint) return;
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
                id: crypto.randomUUID(),
                createdAt: Date.now(),
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
            // IndexedDB unavailable (e.g. private browsing) — app still works, just no history
        }
    }, [refresh]);

    return { receipts, isLoading, isAvailable, saveReceipt, deleteReceipt, saveIfNew };
}
