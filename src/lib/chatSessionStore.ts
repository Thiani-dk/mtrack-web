import type { ChatSession } from '../types';

const DB_NAME = 'mtrack-db';
// Shared with receiptStore.ts and aggregate/allTimeStore.ts — see the
// comment on DB_VERSION in receiptStore.ts. All three must stay in sync.
const DB_VERSION = 3;
const RECEIPTS_STORE = 'receipts';
const SESSIONS_STORE = 'sessions';
const AGGREGATE_STORE = 'aggregate';

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            // Preserve existing stores — only create what's missing,
            // regardless of which module happens to run first.
            if (!db.objectStoreNames.contains(RECEIPTS_STORE)) {
                const store = db.createObjectStore(RECEIPTS_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt');
            }
            if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
                const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt');
            }
            if (!db.objectStoreNames.contains(AGGREGATE_STORE)) {
                db.createObjectStore(AGGREGATE_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveSession(session: ChatSession): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SESSIONS_STORE, 'readwrite');
        tx.objectStore(SESSIONS_STORE).put(session);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getAllSessions(): Promise<ChatSession[]> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SESSIONS_STORE, 'readonly');
        const request = tx.objectStore(SESSIONS_STORE).getAll();
        request.onsuccess = () => {
            const sessions = request.result as ChatSession[];
            sessions.sort((a, b) => b.updatedAt - a.updatedAt);
            resolve(sessions);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SESSIONS_STORE, 'readonly');
        const request = tx.objectStore(SESSIONS_STORE).get(id);
        request.onsuccess = () => resolve(request.result as ChatSession | undefined);
        request.onerror = () => reject(request.error);
    });
}

export async function deleteSession(id: string): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SESSIONS_STORE, 'readwrite');
        tx.objectStore(SESSIONS_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
