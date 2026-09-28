import { join } from 'node:path';
import { launch, reporter, SHOT_DIR } from './harness.mjs';

// One real capture on a phone-sized viewport, with an off-topic detour in the
// middle of it and a correction at the end.
//
// The unit scenarios drive the engine directly, which is the right level for
// what the bot says. What this cannot test is the wiring: that a turn reaches
// the screen, that the composer hint tracks the pending question, that a
// detour does not cost the user their place once React state and IndexedDB are
// in the loop, and that the document ends up holding the corrected figure.

const { check, finish } = reporter();

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));

const transcript = async () =>
    (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');

// Each bubble has a short typing beat in front of it, so a fixed wait races
// the last one. Wait for the transcript to stop changing instead.
async function settled(ceilingMs = 9000) {
    const started = Date.now();
    let previous = null;
    let stable = 0;
    while (Date.now() - started < ceilingMs) {
        await page.waitForTimeout(300);
        const now = await transcript();
        stable = now === previous ? stable + 1 : 0;
        previous = now;
        if (stable >= 3 && Date.now() - started >= 1200) return;
    }
}

const say = async (text) => {
    const box = page.getByRole('textbox').last();
    await box.fill(text);
    await box.press('Enter');
    await settled();
};

const hint = () => page.getByRole('textbox').last().getAttribute('placeholder');

await page.goto(process.env.E2E_BASE_URL ?? 'http://localhost:5173/');
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForTimeout(700);

await page.getByRole('button', { name: /New receipt|Start|Make a receipt|Begin/i }).first().click()
    .catch(() => page.getByRole('button').first().click());
await settled();

// ── Reach the capture ──
await page.locator('button:not([disabled])').filter({ hasText: 'My own spending' }).first().click();
await settled();
check('the mode choice leads into capture', /Paste your M-Pesa/i.test(await transcript()));

// ── A line that leaves the date open ──
await say('bought bacon for 3100');
const askedDate = await transcript();
check('it asks only for what is missing, naming what it is about',
    /When was the bacon\?/.test(askedDate), askedDate.slice(-160));
check('the composer hint tracks the pending question',
    /rough date/i.test(await hint() ?? ''), String(await hint()));

// ── An off-topic detour, mid-question ──
await say("what's the capital of France?");
const afterDetour = await transcript();
check('the detour gets an honest limit, not a guess',
    /outside what I know|can't help with that|Not something I can answer/i.test(afterDetour),
    afterDetour.slice(-220));
check('and the parked question comes straight back',
    /When was the bacon\?/.test(afterDetour.split("capital of France?").pop() ?? ''),
    afterDetour.slice(-160));
check('the detour did not answer the date question',
    /rough date/i.test(await hint() ?? ''), String(await hint()));

// ── Answer it, then correct the figure in one message ──
await say('yesterday');
const confirmed = await transcript();
check('the date is said back, in words', /27 September 2026/.test(confirmed), confirmed.slice(-200));
check('and the confirmation reads as English, not as a form',
    /for bacon/.test(confirmed) && !/to Bacon/.test(confirmed), confirmed.slice(-200));
check('the composer hint says how to confirm, here and only here',
    /yes.*confirm/i.test(await hint() ?? ''), String(await hint()));

await say('actually it was 3500');
const corrected = await transcript();
check('the correction lands in one message', /3,500/.test(corrected), corrected.slice(-220));
check('and it shows the change, before and after',
    /3,100[^\d]{1,24}3,500/.test(corrected), corrected.slice(-220));

await say('yes');
const saved = await transcript();
// Read the document itself, not the transcript: the correction echo quotes
// the old figure by design ("Ksh 3,100 is now Ksh 3,500"), so a substring
// check over the whole conversation proves nothing about what was saved.
const documentText = await page.locator('[data-receipt], .glass-card').last().innerText()
    .catch(() => saved);
check('the line reaches the document with the corrected figure',
    /3,500/.test(documentText) && !/3,100/.test(documentText), documentText.slice(0, 260));
check('and the turn ends with somewhere to go',
    /Add another|Paste a message|tap Approve/i.test(saved), saved.slice(-200));

await page.screenshot({ path: join(SHOT_DIR, 'conversation-final.png'), fullPage: false });

await browser.close();
finish();
