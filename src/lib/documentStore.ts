import type { TrackedDocument } from '../types';
import {
    MTRACK_DB_NAME,
    DOCUMENTS_STORE,
    applyUpgrade,
} from './dbUpgrade';

// Persistence layer for finished (and in-progress) documents. Supersedes
// receiptStore as the store the app reads from — receiptStore is kept only so
// the one-time receipts -> documents migration in dbUpgrade stays recoverable.

// Shared with receiptStore.ts, chatSessionStore.ts and allTimeStore.ts — all
// four open the SAME 'mtrack-db'. Bump every one of these in lockstep, never
// alone (see dbUpgrade.ts).
const DB_VERSION = 4;

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(MTRACK_DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => applyUpgrade(request.result, request.transaction);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveDocument(doc: TrackedDocument): Promise<void> {
    try {
        const db = await initDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(DOCUMENTS_STORE, 'readwrite');
            tx.objectStore(DOCUMENTS_STORE).put(doc);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // IndexedDB unavailable or the write failed (quota, private browsing).
        // The caller keeps its in-memory copy; nothing is thrown upward.
    }
}

export async function getAllDocuments(): Promise<TrackedDocument[]> {
    try {
        const db = await initDB();
        return await new Promise<TrackedDocument[]>((resolve, reject) => {
            const tx = db.transaction(DOCUMENTS_STORE, 'readonly');
            const request = tx.objectStore(DOCUMENTS_STORE).getAll();
            request.onsuccess = () => {
                const docs = request.result as TrackedDocument[];
                docs.sort((a, b) => b.updatedAt - a.updatedAt);
                resolve(docs);
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return [];
    }
}

export async function getDocument(id: string): Promise<TrackedDocument | undefined> {
    try {
        const db = await initDB();
        return await new Promise<TrackedDocument | undefined>((resolve, reject) => {
            const tx = db.transaction(DOCUMENTS_STORE, 'readonly');
            const request = tx.objectStore(DOCUMENTS_STORE).get(id);
            request.onsuccess = () => resolve(request.result as TrackedDocument | undefined);
            request.onerror = () => reject(request.error);
        });
    } catch {
        return undefined;
    }
}

export async function deleteDocument(id: string): Promise<void> {
    try {
        const db = await initDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(DOCUMENTS_STORE, 'readwrite');
            tx.objectStore(DOCUMENTS_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // no-op — see saveDocument
    }
}

export async function getDrafts(): Promise<TrackedDocument[]> {
    const all = await getAllDocuments();
    return all.filter(d => d.status === 'draft');
}
