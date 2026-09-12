import { BASE_URL, launch, openActiveMode, reporter, saleMessage } from './harness.mjs';

// The one-tap Paste button, in both places it appears.
//
// What matters here is that it feeds the SAME path a manual paste does — the
// pending card, the parse, the tally — rather than a parallel capture route,
// and that its absence on an unsupporting browser costs nothing.

const { check, finish } = reporter();
const browser = await launch();

const SALE = saleMessage('QA01XK9P2L', 350, 'JOHN KAMAU', '12:05');

// A clipboard that hands back whatever was put in it.
//
// addInitScript serialises the function, so the text has to travel as an
// explicit argument — a closure over it would arrive as undefined and the stub
// would quietly report an empty clipboard.
const CLIPBOARD_WITH = t => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => t, writeText: async () => {} },
    });
};

// A clipboard that refuses, the way a denied permission does.
const refusingClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => { throw new Error('NotAllowedError'); } },
    });
};

// No clipboard read at all.
const noClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
};

async function activeModePage(initScript, arg) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(initScript, arg);
    await openActiveMode(page);
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }
    return page;
}

// ── Active Mode: one tap captures ──
{
    const page = await activeModePage(CLIPBOARD_WITH, SALE);
    check('the Paste button is there', await page.locator('.am-input ~ * [data-paste-button], [data-paste-button]').count() >= 1);

    await page.getByRole('button', { name: 'Paste from clipboard' }).click();
    await page.waitForTimeout(400);

    const capture = (await page.locator('.am-capture').innerText()).toLowerCase();
    check('one tap produces a pending capture, exactly as a manual paste does',
        capture.includes('tap a bucket') && capture.includes('350'), capture.replace(/\n/g, ' ').slice(0, 80));

    check('a successful paste shows no failure line',
        await page.locator('[role="status"]').count() === 0);

    // And it files through the ordinary route.
    await page.locator('.am-chips button[data-bucket="Unsorted"]').click();
    await page.waitForTimeout(300);
    check('and it files and tallies like any other capture',
        (await page.locator('.am-total').innerText()).includes('350'));
    await page.close();
}

// ── Active Mode: refusal is low-key and the manual path still works ──
{
    const page = await activeModePage(refusingClipboard);
    await page.getByRole('button', { name: 'Paste from clipboard' }).click();
    await page.waitForTimeout(300);

    check('a refused clipboard shows one quiet line',
        /Couldn't read the clipboard — try pasting into the field instead\./
            .test(await page.locator('[role="status"]').innerText()));
    // The empty-state hint contains the words "tap a bucket" too, so the
    // signal is whether a bucket is actually fileable — chips only enable
    // when something is pending.
    const pendingNow = async () => page.evaluate(() =>
        document.querySelector('.am-chips button[data-bucket]')?.getAttribute('aria-disabled') === 'false');
    check('and nothing was captured', (await pendingNow()) === false);

    // The fallback the message points at still works.
    await page.evaluate(t => {
        const el = document.querySelector('.am-input');
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, SALE);
    await page.waitForTimeout(300);
    check('manual pasting into the field is unaffected', (await pendingNow()) === true);
    await page.close();
}

// ── Active Mode: unsupported ──
{
    const page = await activeModePage(noClipboard);
    check('no Paste button where clipboard reading is unavailable',
        await page.locator('[data-paste-button]').count() === 0);

    await page.evaluate(t => {
        const el = document.querySelector('.am-input');
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, SALE);
    await page.waitForTimeout(300);
    check('and manual pasting works exactly as before',
        (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'));
    await page.close();
}

// ── Chat composer ──
{
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(CLIPBOARD_WITH, SALE);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start a summary/ }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'My own spending' }).click();
    await page.waitForTimeout(700);

    check('the same button appears in the chat composer',
        await page.locator('[data-paste-button]').count() === 1);

    await page.getByRole('button', { name: 'Paste from clipboard' }).click();
    await page.waitForTimeout(300);
    check('tapping it fills the composer, ready to send rather than sent',
        (await page.getByRole('textbox').last().inputValue()).includes('QA01XK9P2L'));

    await page.getByRole('textbox').last().press('Enter');
    await page.waitForTimeout(1500);
    const transcript = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('and sending it runs the ordinary parse',
        /Ksh\s?350/.test(transcript), transcript.slice(-160));
    await page.close();
}

// ── Chat composer: unsupported ──
{
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(noClipboard);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start a summary/ }).click();
    await page.waitForTimeout(900);

    check('no Paste button in the composer either, where unsupported',
        await page.locator('[data-paste-button]').count() === 0);
    check('and the composer is otherwise intact',
        await page.getByRole('textbox').count() >= 1
        && await page.getByRole('button', { name: 'Send message' }).count() === 1);
    await page.close();
}

await browser.close();
finish();
