// Service worker registration + update detection.
//
// public/sw.js deliberately does NOT skipWaiting on its own, so a new version
// installs and then waits. This module notices that waiting worker and hands
// the caller a `promote` function; the update banner calls it when the user
// taps Refresh. Promoting posts SKIP_WAITING, the new worker activates and
// claims the page, `controllerchange` fires, and we reload once so the page
// runs entirely on the new build.

type OnUpdateReady = (promote: () => void) => void;

let registered = false;

function promoteWaiting(registration: ServiceWorkerRegistration): void {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

// The actual wiring, with no environment or once-guard — exercised directly by
// tests. Production code goes through registerServiceWorker.
export function wireServiceWorker(onUpdateReady: OnUpdateReady): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // A controller present now means the page is already SW-controlled, so any
    // later controllerchange is a real update — not the first-install claim.
    const hadControllerAtStartup = !!navigator.serviceWorker.controller;
    let reloading = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadControllerAtStartup || reloading) return;
        reloading = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then(registration => {
                // Installed on an earlier visit, still waiting.
                if (registration.waiting && navigator.serviceWorker.controller) {
                    onUpdateReady(() => promoteWaiting(registration));
                }

                registration.addEventListener('updatefound', () => {
                    const installing = registration.installing;
                    if (!installing) return;
                    installing.addEventListener('statechange', () => {
                        // 'installed' + an existing controller = an update
                        // finished installing (not the first-ever install).
                        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                            onUpdateReady(() => promoteWaiting(registration));
                        }
                    });
                });
            })
            .catch(err => console.warn('SW registration failed:', err));
    });
}

export function registerServiceWorker(onUpdateReady: OnUpdateReady): void {
    // Only in a real build. During `vite dev` a worker would cache the dev
    // server's modules and break hot reload.
    if (!import.meta.env.PROD) return;
    if (registered) return;
    registered = true;
    wireServiceWorker(onUpdateReady);
}
