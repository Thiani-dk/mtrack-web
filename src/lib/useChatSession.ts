import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatSession } from '../types';
import * as chatSessionStore from './chatSessionStore';

const DEBOUNCE_MS = 500;

// Message ids created live via addMessage during this app run — lets a
// message component (e.g. ChatReceipt) tell "just created, play the entrance
// animation" apart from "loaded from IndexedDB history, show final state".
// Deliberately in-memory only (never persisted): ids from loadSession were
// never added here, so reopening an old session never replays anything.
const newlyCreatedMessageIds = new Set<string>();

// Pure read — safe to call from a render-phase state initializer.
export function wasNewlyCreatedMessage(id: string): boolean {
    return newlyCreatedMessageIds.has(id);
}

// Idempotent — safe to call more than once (e.g. StrictMode's mount/cleanup/
// mount dance). Clears the flag so a later remount of the same message id
// (switching sessions and back, without a page reload) never replays.
export function clearNewlyCreatedMessage(id: string): void {
    newlyCreatedMessageIds.delete(id);
}

function rehydrate(session: ChatSession): ChatSession {
    return {
        ...session,
        messages: session.messages.map(m => ({
            ...m,
            transactions: m.transactions
                ? m.transactions.map(t => ({ ...t, date: new Date(t.date) }))
                : m.transactions,
        })),
    };
}

function makeTitle(): string {
    const now = new Date();
    return `Expense Summary — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function makeSession(): ChatSession {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        title: makeTitle(),
        messages: [],
        transactionCount: 0,
        totalSpent: 0,
        isComplete: false,
        sessionStatus: 'awaiting_input',
    };
}

export function useChatSession() {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAvailable, setIsAvailable] = useState(true);

    const activeSessionRef = useRef<ChatSession | null>(null);
    useEffect(() => {
        activeSessionRef.current = activeSession;
    }, [activeSession]);

    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const refresh = useCallback(async () => {
        try {
            const all = await chatSessionStore.getAllSessions();
            setSessions(all.map(rehydrate));
            setIsAvailable(true);
        } catch {
            setSessions([]);
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

    // Flush any pending debounced writes on unmount so nothing is lost.
    useEffect(() => {
        const timers = saveTimers.current;
        return () => {
            timers.forEach(t => clearTimeout(t));
            timers.clear();
        };
    }, []);

    const persistNow = useCallback(async (session: ChatSession) => {
        try {
            await chatSessionStore.saveSession(session);
            setIsAvailable(true);
        } catch {
            setIsAvailable(false);
        }
    }, []);

    const persistDebounced = useCallback((session: ChatSession) => {
        const timers = saveTimers.current;
        const existing = timers.get(session.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            timers.delete(session.id);
            persistNow(session);
        }, DEBOUNCE_MS);
        timers.set(session.id, timer);
    }, [persistNow]);

    const upsertSessionList = useCallback((session: ChatSession) => {
        setSessions(prev => {
            const idx = prev.findIndex(s => s.id === session.id);
            if (idx === -1) return [session, ...prev];
            const next = [...prev];
            next[idx] = session;
            return next;
        });
    }, []);

    const newSession = useCallback(() => {
        const session = makeSession();
        setActiveSession(session);
        upsertSessionList(session);
        persistNow(session);
    }, [persistNow, upsertSessionList]);

    const loadSession = useCallback((id: string) => {
        const found = sessions.find(s => s.id === id);
        if (found) setActiveSession(found);
    }, [sessions]);

    const deleteSession = useCallback(async (id: string) => {
        try {
            await chatSessionStore.deleteSession(id);
            setSessions(prev => prev.filter(s => s.id !== id));
            if (activeSessionRef.current?.id === id) {
                setActiveSession(null);
            }
        } catch {
            setIsAvailable(false);
        }
    }, []);

    // Returns the generated message id synchronously (the id/timestamp are
    // created up front, outside the state updater) so callers can immediately
    // target it with updateMessage — e.g. converting a "thinking" bubble into
    // its final content once work finishes.
    const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>): string => {
        const id = crypto.randomUUID();
        const timestamp = Date.now();
        newlyCreatedMessageIds.add(id);
        setActiveSession(prev => {
            if (!prev) return prev;
            const message: ChatMessage = { ...msg, id, timestamp };
            const updated: ChatSession = {
                ...prev,
                messages: [...prev.messages, message],
                updatedAt: Date.now(),
            };
            upsertSessionList(updated);
            persistDebounced(updated);
            return updated;
        });
        return id;
    }, [persistDebounced, upsertSessionList]);

    const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
        setActiveSession(prev => {
            if (!prev) return prev;
            const updated: ChatSession = {
                ...prev,
                messages: prev.messages.map(m => (m.id === id ? { ...m, ...patch } : m)),
                updatedAt: Date.now(),
            };
            upsertSessionList(updated);
            persistDebounced(updated);
            return updated;
        });
    }, [persistDebounced, upsertSessionList]);

    // Session-level (not per-message) status update — e.g. flipping out of
    // 'awaiting_input' once the user sends their first message.
    const updateSessionStatus = useCallback((id: string, status: ChatSession['sessionStatus']) => {
        setActiveSession(prev => {
            if (!prev || prev.id !== id) return prev;
            const updated: ChatSession = { ...prev, sessionStatus: status, updatedAt: Date.now() };
            upsertSessionList(updated);
            persistDebounced(updated);
            return updated;
        });
    }, [persistDebounced, upsertSessionList]);

    return {
        sessions,
        activeSession,
        isLoading,
        isAvailable,
        newSession,
        loadSession,
        deleteSession,
        addMessage,
        updateMessage,
        updateSessionStatus,
    };
}
