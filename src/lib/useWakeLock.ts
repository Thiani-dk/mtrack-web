import { useEffect, useState } from 'react';
import { createWakeLock, isWakeLockSupported, type WakeLockState } from './wakeLock';

// Holds the screen awake for as long as the calling screen is mounted and
// `active` is true, and gives it straight back when it isn't.
//
// `supported` is what the UI should gate its indicator on: a control that
// permanently reads "off" is worse than no control, so on a browser without
// the API there is simply nothing to show.
export function useWakeLock(active: boolean): { supported: boolean; state: WakeLockState } {
    const [supported] = useState(() => isWakeLockSupported());
    const [state, setState] = useState<WakeLockState>(supported ? 'idle' : 'unsupported');

    useEffect(() => {
        if (!supported || !active) return;
        const lock = createWakeLock({ onChange: setState });
        void lock.acquire();
        // Unmount — navigating away, Finish, or backing out — hands the lock
        // back. Holding one anywhere else in the app is battery spent for
        // nothing.
        return () => lock.dispose();
    }, [supported, active]);

    return { supported, state };
}
