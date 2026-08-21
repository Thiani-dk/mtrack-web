import { useCallback, useEffect, useState } from 'react';
import type { StoredReceipt } from '../types';
import * as receiptStore from './receiptStore';

function rehydrate(receipt: StoredReceipt): StoredReceipt {
    return {
        ...receipt,
        transactions: receipt.transactions.map(t => ({ ...t, date: new Date(t.date) })),
    };
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

    return { receipts, isLoading, isAvailable, saveReceipt, deleteReceipt };
}
