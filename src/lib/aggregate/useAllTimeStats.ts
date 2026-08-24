import { useCallback, useEffect, useState } from 'react';
import type { ParsedTransaction } from '../../types';
import * as store from './allTimeStore';
import type { AllTimeStats, RecordSessionResult } from './allTimeStore';

export type { AllTimeStats, RecordSessionResult };

export function useAllTimeStats() {
    const [stats, setStats] = useState<AllTimeStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAvailable, setIsAvailable] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const loaded = await store.getAllTimeStats();
            setStats(loaded ?? null);
            setIsAvailable(true);
        } catch {
            setStats(null);
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

    // Demo sessions are excluded entirely — callers should never invoke this
    // for demo data, but the guard is here too so it's impossible to get wrong.
    // Returns the full result (including newly-earned badges) so callers can
    // announce it, or null if skipped/unavailable.
    const recordSession = useCallback(async (transactions: ParsedTransaction[], isDemo: boolean): Promise<RecordSessionResult | null> => {
        if (isDemo) return null;
        try {
            const result = await store.recordSession(transactions);
            setStats(result.stats);
            setIsAvailable(true);
            return result;
        } catch {
            setIsAvailable(false);
            return null;
        }
    }, []);

    const resetAll = useCallback(async () => {
        try {
            await store.resetAllTime();
            await refresh();
        } catch {
            setIsAvailable(false);
        }
    }, [refresh]);

    return { stats, isLoading, isAvailable, recordSession, resetAll };
}
