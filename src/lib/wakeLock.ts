// Screen Wake Lock, wired the same way the service worker is: feature-detect
// first, degrade quietly, and keep the actual wiring free of environment
// assumptions so it can be tested directly.
//
// The point of the feature is narrow. A vendor running Active Mode on a
// counter all day should not have to poke the screen awake every two minutes.
// Outside Active Mode the lock is a battery cost with no benefit, so it is
// released the moment they leave.
//
// Support as of 2026: Android Chrome, and iOS Safari since 18.4. Everywhere
// else the screen dims exactly as the device settings say it should, which is
// the behaviour that has always existed — never an error, never a broken
// control.

export interface WakeLockSentinelLike {
    released: boolean;
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
    removeEventListener?(type: 'release', listener: () => void): void;
}

export interface WakeLockNavigatorLike {
    wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface VisibilityDocumentLike {
    visibilityState: DocumentVisibilityState;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export function isWakeLockSupported(nav: WakeLockNavigatorLike | undefined = globalNavigator()): boolean {
    return !!nav && 'wakeLock' in nav && typeof nav.wakeLock?.request === 'function';
}

function globalNavigator(): WakeLockNavigatorLike | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as WakeLockNavigatorLike);
}

function globalDocument(): VisibilityDocumentLike | undefined {
    return typeof document === 'undefined' ? undefined : (document as VisibilityDocumentLike);
}

export type WakeLockState = 'unsupported' | 'idle' | 'held' | 'unavailable';

export interface WakeLockController {
    // Ask for the lock and keep re-acquiring it for as long as the caller
    // wants it held.
    acquire(): Promise<void>;
    // Give it up and stop wanting it.
    release(): Promise<void>;
    // Tear down listeners. Releases too — leaving a screen pinned awake after
    // its screen has gone is the one outcome worth being careful about.
    dispose(): void;
    state(): WakeLockState;
}

export interface WakeLockOptions {
    navigator?: WakeLockNavigatorLike;
    document?: VisibilityDocumentLike;
    // Called whenever the state changes, so a UI can show whether the screen
    // is actually being held awake rather than claiming it unconditionally.
    onChange?: (state: WakeLockState) => void;
}

export function createWakeLock(options: WakeLockOptions = {}): WakeLockController {
    const nav = options.navigator ?? globalNavigator();
    const doc = options.document ?? globalDocument();
    const supported = isWakeLockSupported(nav);

    let sentinel: WakeLockSentinelLike | null = null;
    // What the caller wants, which is not the same as what the browser is
    // currently granting — the difference is the whole reason for the
    // visibilitychange handler below.
    let wanted = false;
    let disposed = false;
    let state: WakeLockState = supported ? 'idle' : 'unsupported';

    const setState = (next: WakeLockState) => {
        if (state === next) return;
        state = next;
        options.onChange?.(next);
    };

    const request = async (): Promise<void> => {
        if (!supported || disposed || !wanted || sentinel) return;
        try {
            const granted = await nav!.wakeLock!.request('screen');
            // Released, disposed, or navigated away while the request was in
            // flight — hand it straight back rather than holding one nobody
            // asked for any more.
            if (!wanted || disposed) {
                await granted.release().catch(() => {});
                return;
            }
            sentinel = granted;
            granted.addEventListener('release', () => {
                sentinel = null;
                // The browser drops the lock on its own when the tab is
                // backgrounded or the screen turns off. That is documented and
                // expected; it becomes 'idle' (still wanted, not currently
                // held) and visibilitychange re-takes it.
                if (wanted && !disposed) setState('idle');
            });
            setState('held');
        } catch {
            // A denied or failed request is not an error condition for the
            // vendor — the screen simply behaves as it always did.
            setState('unavailable');
        }
    };

    const handleVisibility = () => {
        if (!wanted || disposed) return;
        // Back in the foreground after a switch to the SMS app: the lock the
        // browser took away is re-taken silently, with nothing asked of the
        // user.
        if (doc?.visibilityState === 'visible') void request();
    };

    doc?.addEventListener('visibilitychange', handleVisibility);

    const releaseNow = async (): Promise<void> => {
        wanted = false;
        const current = sentinel;
        sentinel = null;
        if (current && !current.released) await current.release().catch(() => {});
        if (supported) setState('idle');
    };

    return {
        async acquire() {
            if (disposed) return;
            wanted = true;
            await request();
        },
        release: releaseNow,
        dispose() {
            if (disposed) return;
            disposed = true;
            doc?.removeEventListener('visibilitychange', handleVisibility);
            void releaseNow();
        },
        state: () => state,
    };
}
