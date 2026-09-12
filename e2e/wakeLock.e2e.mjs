import { launch, openActiveMode, reporter } from './harness.mjs';

// Screen Wake Lock in Active Mode, in a real page.
//
// Headless Chromium does not grant a real screen lock, so navigator.wakeLock is
// stubbed before the app loads — with a stub that behaves the way the spec says
// a real one does, including releasing itself when the tab is backgrounded.
// What is being checked is this app's wiring: that it asks on arrival, gives it
// back on leaving, asks again on return, and renders nothing at all where the
// API is absent.

const { check, finish } = reporter();
const browser = await launch();

const STUB = () => {
    const calls = { request: 0, release: 0 };
    // Every sentinel ever handed out, so "how many locks are actually live"
    // can be counted directly. A browser-initiated release does not go through
    // release(), so counting calls would miss it.
    const all = [];
    let live = null;
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
            request: async () => {
                calls.request++;
                const listeners = [];
                const sentinel = {
                    released: false,
                    type: 'screen',
                    async release() { calls.release++; sentinel.released = true; listeners.forEach(l => l()); },
                    addEventListener: (_t, l) => listeners.push(l),
                    removeEventListener: () => {},
                    __browserRelease() { sentinel.released = true; listeners.forEach(l => l()); },
                };
                live = sentinel;
                all.push(sentinel);
                return sentinel;
            },
        },
    });
    window.__wake = { calls, current: () => live, liveCount: () => all.filter(s => !s.released).length };
};

// ── Supported ──
{
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(STUB);

    await openActiveMode(page);
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(400);

    // React StrictMode double-invokes effects in dev (mount, clean up, mount),
    // so raw request counts are not the invariant worth asserting — "exactly
    // one lock outstanding" is, and it also proves the cleanup releases.
    const outstanding = async () => page.evaluate(() => ({
        ...window.__wake.calls, live: window.__wake.liveCount(),
    }));
    const afterOpen = await outstanding();
    check('opening Active Mode takes the lock, and holds exactly one',
        afterOpen.request >= 1 && afterOpen.live === 1, JSON.stringify(afterOpen));
    check('the indicator appears and reads as held',
        await page.locator('[data-wake-lock="held"]').count() === 1);

    // Tapping it explains itself in one line.
    await page.getByRole('button', { name: 'Screen stays on' }).click();
    await page.waitForTimeout(200);
    check('tapping the indicator explains what it does',
        /Your screen will stay on while this is open/.test(await page.locator('header').innerText()));

    // ── Background, then return ──
    await page.evaluate(() => {
        window.__wake.current().__browserRelease();
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(250);
    check('the browser dropping the lock is reflected, not treated as an error',
        await page.locator('[data-wake-lock="idle"]').count() === 1);

    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(350);
    const afterReturn = await outstanding();
    check('returning re-takes the lock with no user action',
        afterReturn.request === afterOpen.request + 1 && afterReturn.live === 1,
        JSON.stringify(afterReturn));
    check('and the indicator is held again',
        await page.locator('[data-wake-lock="held"]').count() === 1);

    // ── Leaving releases it ──
    await page.getByRole('button', { name: 'Close Active Mode' }).click();
    await page.waitForTimeout(400);
    const afterLeave = await outstanding();
    check('leaving Active Mode gives the lock back, holding none',
        afterLeave.live === 0, JSON.stringify(afterLeave));
    check('and Active Mode is no longer on screen',
        await page.locator('.active-mode').count() === 0);

    check('no console errors along the way', errors.length === 0, errors.join(' | '));
    await page.close();
}

// ── Unsupported ──
{
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // A browser with no Wake Lock at all.
    await page.addInitScript(() => {
        delete Navigator.prototype.wakeLock;
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    });

    await openActiveMode(page);
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(300);

    check('no indicator is shown where the API is absent',
        await page.locator('[data-wake-lock]').count() === 0
        && await page.getByRole('button', { name: 'Screen stays on' }).count() === 0);
    check('no error is raised', errors.length === 0, errors.join(' | '));

    // And the screen still works in every other respect.
    await page.getByRole('button', { name: /New bucket/ }).click();
    await page.getByPlaceholder('Bucket name').fill('Combo sales');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check('Active Mode is otherwise completely unaffected',
        (await page.locator('.am-chips').innerText()).includes('Combo sales')
        && await page.locator('.am-input').count() === 1);

    await page.close();
}

await browser.close();
finish();
