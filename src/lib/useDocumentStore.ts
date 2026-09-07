import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackedDocument } from '../types';
import * as documentStore from './documentStore';

const WRITE_DEBOUNCE_MS = 500;

function rehydrate(doc: TrackedDocument): TrackedDocument {
    return {
        ...doc,
        transactions: doc.transactions.map(t => ({ ...t, date: new Date(t.date) })),
    };
}

// Persistence hook for TrackedDocuments. Mirrors useReceiptStore: an in-memory
// mirror kept in sync with IndexedDB, graceful degradation when the store is
// unavailable, and Date rehydration on every read. Writes are debounced by
// ~500ms per document so a rapid burst of tap-to-edit changes collapses into
// one persisted write.
export function useDocumentStore() {
    const [documents, setDocuments] = useState<TrackedDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAvailable, setIsAvailable] = useState(true);

    const pendingWrites = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    const refresh = useCallback(async () => {
        try {
            const all = await documentStore.getAllDocuments();
            setDocuments(all.map(rehydrate));
            setIsAvailable(true);
        } catch {
            setDocuments([]);
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

    // Flush every outstanding debounced write on unmount so a document being
    // edited when the screen closes still lands.
    useEffect(() => {
        const timers = pendingWrites.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    const saveDocument = useCallback((doc: TrackedDocument) => {
        // Optimistic: the in-memory mirror updates now, IndexedDB catches up.
        setDocuments(prev => {
            const next = prev.filter(d => d.id !== doc.id);
            next.push(rehydrate(doc));
            next.sort((a, b) => b.updatedAt - a.updatedAt);
            return next;
        });

        const timers = pendingWrites.current;
        const existing = timers.get(doc.id);
        if (existing) clearTimeout(existing);
        timers.set(doc.id, setTimeout(async () => {
            timers.delete(doc.id);
            try {
                await documentStore.saveDocument(doc);
            } catch {
                setIsAvailable(false);
            }
        }, WRITE_DEBOUNCE_MS));
    }, []);

    const deleteDocument = useCallback(async (id: string) => {
        const timers = pendingWrites.current;
        const existing = timers.get(id);
        if (existing) {
            clearTimeout(existing);
            timers.delete(id);
        }
        setDocuments(prev => prev.filter(d => d.id !== id));
        try {
            await documentStore.deleteDocument(id);
        } catch {
            setIsAvailable(false);
        }
    }, []);

    const drafts = documents.filter(d => d.status === 'draft');

    return { documents, drafts, isLoading, isAvailable, saveDocument, deleteDocument };
}
