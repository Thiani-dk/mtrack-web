import type { ChatSession } from '../types';
import { applyUpgrade } from './dbUpgrade';

const DB_NAME = 'mtrack-db';
// Shared with receiptStore.ts, aggregate/allTimeStore.ts and documentStore.ts
// — see the comment on DB_VERSION in receiptStore.ts. All four must stay in
// sync. Shared schema: dbUpgrade.ts / applyUpgrade.
const DB_VERSION = 4;
const SESSIONS_STORE = 'sessions';

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => applyUpgrade(request.result, request.transaction);
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
