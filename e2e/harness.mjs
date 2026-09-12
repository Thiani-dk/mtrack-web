import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

// Shared plumbing for the browser checks.
//
// playwright-core deliberately ships no browser binary, so these scripts use
// whatever Chromium is already on the machine: a Playwright-managed one if
// there is one, otherwise an installed Chrome. That keeps the dev dependency
// to a single small package rather than a few hundred megabytes nobody asked
// for — and is why this is not part of `npm test`. See README.

const CANDIDATE_CHROMES = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// A Playwright-managed headless shell, whichever build revision is installed.
function playwrightManagedChrome() {
    const root = join(homedir(), '.cache', 'ms-playwright');
    if (!existsSync(root)) return null;
    for (const dir of readdirSync(root)) {
        if (!dir.startsWith('chromium')) continue;
        for (const rel of [
            'chrome-headless-shell-linux64/chrome-headless-shell',
            'chrome-linux/chrome',
            'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        ]) {
            const full = join(root, dir, rel);
            if (existsSync(full)) return full;
        }
    }
    return null;
}

export function resolveChrome() {
    const fromEnv = process.env.CHROME_PATH;
    if (fromEnv) {
        if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH does not exist: ${fromEnv}`);
        return fromEnv;
    }
    const managed = playwrightManagedChrome();
    if (managed) return managed;
    const installed = CANDIDATE_CHROMES.find(p => existsSync(p));
    if (installed) return installed;
    throw new Error(
        'No Chromium found. Install one (npx playwright install chromium) '
        + 'or point CHROME_PATH at an existing Chrome binary.',
    );
}

// Vite takes the next free port when 5173 is busy, so the port is worth being
// able to override rather than guess.
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173/';

export const SHOT_DIR = process.env.E2E_SHOT_DIR ?? join(process.cwd(), 'e2e', 'screenshots');

export async function launch() {
    const executablePath = resolveChrome();
    try {
        await fetch(BASE_URL, { method: 'HEAD' });
    } catch {
        throw new Error(
            `Nothing is serving ${BASE_URL}. Start the app first (npm run dev), `
            + 'or set E2E_BASE_URL to wherever it is running.',
        );
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    return chromium.launch({ executablePath });
}

// A tiny result collector. These scripts assert on a real running app, so a
// failure needs to say enough to debug from the log alone.
export function reporter() {
    const results = [];
    return {
        check(name, pass, detail = '') {
            results.push({ name, pass, detail });
            console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
        },
        finish() {
            const failed = results.filter(r => !r.pass);
            console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
            if (failed.length > 0) {
                console.log('\nFailed:');
                for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ''}`);
            }
            process.exit(failed.length === 0 ? 0 : 1);
        },
    };
}

// Active Mode captures on the paste event itself, so a synthetic ClipboardEvent
// with a real DataTransfer is what exercises the actual code path — typing into
// the field would not.
export async function pasteInto(page, selector, text) {
    await page.evaluate(({ sel, t }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`no element for ${sel}`);
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { sel: selector, t: text });
    await page.waitForTimeout(120);
}

// The capture currently waiting for a bucket, as a value: { amount } or null.
//
// Active Mode's empty-state hint reads "...then tap a bucket", and the pending
// card is headed "Tap a bucket to file it" — so a substring match on "tap a
// bucket" is true either way and cannot distinguish a waiting sale from none.
// Two checks in this suite were written that way. Read the state instead.
export async function pendingCapture(page) {
    return page.evaluate(() => {
        const el = document.querySelector('[data-pending-capture]');
        return el ? { amount: Number(el.dataset.pendingAmount) } : null;
    });
}

// A realistic M-Pesa sale confirmation, parsed by the real pipeline.
export function saleMessage(code, amount, from, hhmm) {
    return `${code} Confirmed. You have received Ksh${amount.toFixed(2)} from ${from} 0712345678 `
        + `on 12/9/26 at ${hhmm} PM. New M-PESA balance is Ksh${(20000 + amount).toFixed(2)}.`;
}

// Reaches Active Mode from HomeScreen. Returns whether the first-run
// walkthrough appeared.
export async function openActiveMode(page) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByText('Track a busy day').click();
    await page.waitForTimeout(400);
    return (await page.getByRole('dialog', { name: 'How Active Mode works' }).count()) === 1;
}
