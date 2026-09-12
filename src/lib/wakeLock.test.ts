import { describe, expect, it, vi } from 'vitest';
import {
    createWakeLock, isWakeLockSupported,
    type VisibilityDocumentLike, type WakeLockNavigatorLike, type WakeLockSentinelLike,
} from './wakeLock';

// A fake screen lock that behaves the way a real one does — including the part
// that matters most: the browser takes it away on its own when the tab is
// backgrounded, and the page is expected to notice and ask again.

function fakeSentinel(): WakeLockSentinelLike & { fireBrowserRelease(): void; releaseCalls: number } {
    const listeners: Array<() => void> = [];
    const s = {
        released: false,
        releaseCalls: 0,
        async release() {
            s.releaseCalls++;
            s.released = true;
            for (const l of [...listeners]) l();
        },
        addEventListener(_type: 'release', listener: () => void) { listeners.push(listener); },
        // What the browser does when the tab goes away.
        fireBrowserRelease() {
            s.released = true;
            for (const l of [...listeners]) l();
        },
    };
    return s;
}

function fakeEnv(opts: { supported?: boolean; failRequest?: boolean } = {}) {
    const sentinels: ReturnType<typeof fakeSentinel>[] = [];
    let visibility: DocumentVisibilityState = 'visible';
    const visibilityListeners: Array<() => void> = [];

    const nav: WakeLockNavigatorLike = opts.supported === false ? {} : {
        wakeLock: {
            request: vi.fn(async () => {
                if (opts.failRequest) throw new Error('NotAllowedError');
                const s = fakeSentinel();
                sentinels.push(s);
                return s;
            }),
        },
    };

    const doc: VisibilityDocumentLike = {
        get visibilityState() { return visibility; },
        addEventListener(_t, l) { visibilityListeners.push(l); },
        removeEventListener(_t, l) {
            const i = visibilityListeners.indexOf(l);
            if (i >= 0) visibilityListeners.splice(i, 1);
        },
    };

    return {
        nav, doc, sentinels,
        requestCount: () => (nav.wakeLock ? (nav.wakeLock.request as ReturnType<typeof vi.fn>).mock.calls.length : 0),
        current: () => sentinels[sentinels.length - 1],
        listenerCount: () => visibilityListeners.length,
        async background() {
            visibility = 'hidden';
            // The browser releases the lock of its own accord.
            sentinels.filter(s => !s.released).forEach(s => s.fireBrowserRelease());
            for (const l of [...visibilityListeners]) l();
        },
        async foreground() {
            visibility = 'visible';
            for (const l of [...visibilityListeners]) l();
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

describe('feature detection', () => {
    it('sees the API when it is there', () => {
        expect(isWakeLockSupported({ wakeLock: { request: async () => fakeSentinel() } })).toBe(true);
    });

    it('says no when it is not, without throwing', () => {
        expect(isWakeLockSupported({})).toBe(false);
        expect(isWakeLockSupported(undefined)).toBe(false);
        // A navigator carrying the property but not a usable request function.
        expect(isWakeLockSupported({ wakeLock: undefined })).toBe(false);
    });
});

describe('holding the screen awake', () => {
    it('takes the lock when asked', async () => {
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();

        expect(env.requestCount()).toBe(1);
        expect(lock.state()).toBe('held');
    });

    it('gives it back on release', async () => {
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        await lock.release();

        expect(env.current().releaseCalls).toBe(1);
        expect(lock.state()).toBe('idle');
    });

    it('gives it back on dispose, and stops listening', async () => {
        // Leaving Active Mode must not leave a screen pinned awake for the
        // rest of the app.
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        expect(env.listenerCount()).toBe(1);

        lock.dispose();
        await Promise.resolve();
        expect(env.current().releaseCalls).toBe(1);
        expect(env.listenerCount()).toBe(0);
    });

    it('does not stack locks when asked twice', async () => {
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        await lock.acquire();
        expect(env.requestCount()).toBe(1);
    });
});

describe('backgrounding and coming back', () => {
    it('re-takes the lock the browser took away, with nothing asked of the user', async () => {
        // The documented behaviour: a wake lock is released when the tab loses
        // visibility. A vendor switching to their SMS app and back must not
        // have to do anything about that.
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        expect(lock.state()).toBe('held');

        await env.background();
        expect(lock.state()).toBe('idle');

        await env.foreground();
        expect(env.requestCount()).toBe(2);
        expect(lock.state()).toBe('held');
    });

    it('does not re-take it after the screen was left', async () => {
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        lock.dispose();

        await env.foreground();
        expect(env.requestCount()).toBe(1);
    });

    it('does not re-take it after an explicit release', async () => {
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await lock.acquire();
        await lock.release();

        await env.foreground();
        expect(env.requestCount()).toBe(1);
    });
});

describe('where the API is missing or refuses', () => {
    it('is inert on a browser without Wake Lock, and never throws', async () => {
        const env = fakeEnv({ supported: false });
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });

        expect(lock.state()).toBe('unsupported');
        await expect(lock.acquire()).resolves.toBeUndefined();
        await expect(lock.release()).resolves.toBeUndefined();
        expect(() => lock.dispose()).not.toThrow();
        // Nothing to re-acquire on a visibility change either.
        await env.foreground();
        expect(lock.state()).toBe('unsupported');
    });

    it('treats a denied request as "screen behaves normally", not an error', async () => {
        const env = fakeEnv({ failRequest: true });
        const lock = createWakeLock({ navigator: env.nav, document: env.doc });
        await expect(lock.acquire()).resolves.toBeUndefined();
        expect(lock.state()).toBe('unavailable');
    });

    it('reports state changes so the indicator can tell the truth', async () => {
        const seen: string[] = [];
        const env = fakeEnv();
        const lock = createWakeLock({ navigator: env.nav, document: env.doc, onChange: s => seen.push(s) });

        await lock.acquire();
        await env.background();
        await env.foreground();

        expect(seen).toEqual(['held', 'idle', 'held']);
    });
});
