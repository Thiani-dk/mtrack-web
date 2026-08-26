import type { StoredReceipt } from '../types';

const DB_NAME = 'mtrack-db';
// Shared with chatSessionStore.ts and aggregate/allTimeStore.ts — all three
// open the SAME underlying database by name. IndexedDB rejects an open()
// call whose requested version is lower than the database's current
// on-disk version, so every module touching 'mtrack-db' MUST request the
// same version number, or whichever module runs first (bumping the disk
// version) permanently breaks every other module's initDB() afterwards.
// Bump this alongside the other two files' DB_VERSION, never alone.
const DB_VERSION = 3;
const STORE_NAME = 'receipts';
const SESSIONS_STORE = 'sessions';
const AGGREGATE_STORE = 'aggregate';

export function initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            // Whichever of the three store modules happens to run its
            // initDB() first on a brand-new database creates the full
            // schema — the others then open the (already up to date)
            // database with nothing left to do.
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

// put(), not add() — callers (saveIfNew) intentionally reuse an existing
// receipt's id to update it in place (e.g. after a label change), which
// add() would reject with a ConstraintError on the duplicate key.
export async function saveReceipt(receipt: StoredReceipt): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(receipt);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getAllReceipts(): Promise<StoredReceipt[]> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
            const receipts = request.result as StoredReceipt[];
            receipts.sort((a, b) => b.createdAt - a.createdAt);
            resolve(receipts);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function deleteReceipt(id: string): Promise<void> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getReceipt(id: string): Promise<StoredReceipt | undefined> {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result as StoredReceipt | undefined);
        request.onerror = () => reject(request.error);
    });
}
