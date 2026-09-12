import { BASE_URL, launch, openActiveMode, reporter } from './harness.mjs';

// Onboarding for the two conveniences added alongside it: the screen staying
// on, and the Paste button.
//
// The rule being checked is that neither is ever described on a device that
// does not have it — so every case is run twice, once with the API stubbed in
// and once with it removed.

const { check, finish } = reporter();
const browser = await launch();

const WAKE_LINE = /screen stays on by itself/i;
const PASTE_LINE = /Paste button next to the message box/i;

const BOTH = () => {
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => ({ released: false, release: async () => {}, addEventListener: () => {} }) },
    });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => 'x', writeText: async () => {} },
    });
};

const NEITHER = () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
};

const WAKE_ONLY = () => {
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => ({ released: false, release: async () => {}, addEventListener: () => {} }) },
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
};

// The walkthrough's message-sharing step, where the two lines live.
async function sharingStepText(page) {
    const dialog = page.getByRole('dialog', { name: 'How Active Mode works' });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(300);
    return (await dialog.innerText()).replace(/\s+/g, ' ');
}

async function walkthroughPage(initScript) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(initScript);
    await openActiveMode(page);
    return page;
}

// ── Both APIs present ──
{
    const page = await walkthroughPage(BOTH);
    const text = await sharingStepText(page);

    check('the walkthrough mentions the screen staying on', WAKE_LINE.test(text), text.slice(-200));
    check('and mentions the Paste button', PASTE_LINE.test(text));
    check('both are one short line each, not a chapter',
        text.length < 1200, `step length ${text.length}`);
    await page.close();
}

// ── Neither API ──
{
    const page = await walkthroughPage(NEITHER);
    const text = await sharingStepText(page);

    check('neither line appears on a device with neither API',
        !WAKE_LINE.test(text) && !PASTE_LINE.test(text), text.slice(-160));
    check('and the whole block is skipped rather than left empty',
        await page.locator('[data-device-lines]').count() === 0);
    check('the rest of the step is untouched',
        /floating window \(recommended\)/i.test(text) && /swap between apps/i.test(text));
    await page.close();
}

// ── One API only ──
{
    const page = await walkthroughPage(WAKE_ONLY);
    const text = await sharingStepText(page);

    check('only the supported line appears',
        WAKE_LINE.test(text) && !PASTE_LINE.test(text), text.slice(-200));
    await page.close();
}

// ── The composer tip: once, then never ──
{
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(BOTH);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start a summary/ }).click();
    await page.waitForTimeout(900);

    check('the tip shows the first time the button is seen',
        await page.locator('[data-paste-tip]').count() === 1);
    check('it says one short thing',
        /Tip: tap here to paste a copied message directly\./
            .test(await page.locator('[data-paste-tip]').innerText()));

    // It must not be in the way of the conversation.
    check('the composer still works with the tip up',
        await page.getByRole('textbox').last().isEditable());

    await page.getByRole('button', { name: 'Dismiss tip' }).click();
    await page.waitForTimeout(200);
    check('dismissing removes it', await page.locator('[data-paste-tip]').count() === 0);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    check('and it never comes back', await page.locator('[data-paste-tip]').count() === 0);
    check('while the button itself remains', await page.locator('[data-paste-button]').count() === 1);
    await page.close();
}

// ── No tip where there is no button ──
{
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check('no uncaught page errors', false, e.message));
    await page.addInitScript(NEITHER);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start a summary/ }).click();
    await page.waitForTimeout(900);

    check('no tip where the button was never rendered',
        await page.locator('[data-paste-tip]').count() === 0
        && await page.locator('[data-paste-button]').count() === 0);
    await page.close();
}

await browser.close();
finish();
