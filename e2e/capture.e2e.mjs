import { join } from 'node:path';
import { BASE_URL, launch, reporter, SHOT_DIR } from './harness.mjs';

// The two conversational-capture transcripts from real device testing, replayed
// through the actual chat, not through the extractors in isolation.
//
//  1. A point-of-sale run where a message containing two priced items was
//     followed by "What did they buy?".
//  2. A date exchange where a rejected date was followed by a fresh valid one
//     that got discarded instead of disambiguated.
//
// Both are about wiring — which question the bot asks next — so the check has
// to go through the real flow.

const { check, finish } = reporter();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));

const transcript = async () => (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
// The last thing the BOT said, scoped to bot bubbles only.
//
// This used to select `[data-role="bot"], .whitespace-pre-wrap, p` and take the
// last match in DOM order. Two things were wrong with that: no data-role
// existed, and .whitespace-pre-wrap is on user bubbles too — so the selector
// fell through to "every paragraph on the page", which includes PasteButton's
// status note in the composer, rendered BELOW the transcript. A clipboard
// failure could therefore outrank the bot's actual last line.
const lastBotLine = async () => {
    const bubbles = page.locator('[data-role="bot"]');
    const n = await bubbles.count();
    if (n === 0) return '';
    return (await bubbles.nth(n - 1).innerText()).trim();
};

async function say(text) {
    const box = page.getByRole('textbox').last();
    await box.fill(text);
    await box.press('Enter');
    await page.waitForTimeout(900);
}

async function startChat() {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Start a summary/ }).click();
    await page.waitForTimeout(900);
}

// ── 1. The Sambonani point-of-sale transcript ──
await startChat();
await page.getByRole('button', { name: 'A receipt for a customer' }).click();
await page.waitForTimeout(800);
check('the receipt flow asks for the business name', (await transcript()).includes("What's the business name?"));

await say('Sambonani');
check('then asks what they bought and for how much',
    (await transcript()).includes('tell me what they bought and the amount'));

await say('They bought credits to continue chatting on my platform. 500 USD on call time. And 250 USD on sms time.');
const afterItems = await transcript();

// The date is the only thing genuinely missing from that message.
check('it asks for the date', /When was that\?/.test(afterItems), (await lastBotLine()).slice(0, 80));
check('it does NOT ask how much — it was told twice', !/How much was it\?/.test(afterItems));

await say('yesterday');
const afterDate = await transcript();
check('it does NOT go on to ask what they bought', !/What did they buy\?/.test(afterDate),
    (await lastBotLine()).slice(0, 120));

const confirm = await lastBotLine();
check('it confirms both items, in USD, totalling $750',
    /Call time \$500/.test(confirm) && /Sms time \$250/.test(confirm) && /total \$750/.test(confirm),
    confirm.slice(0, 160));
check('the confirmation says nothing about Shillings', !/Ksh/.test(confirm), confirm.slice(0, 160));

await page.screenshot({ path: join(SHOT_DIR, 'capture-sambonani.png'), fullPage: true });

// ── 2. The ambiguous-date retry transcript ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
// Something with no date in it, so the date question is the one left open.
await say('Sold a laptop for Ksh 45,000');
check('a described sale with no date asks for one', /When was that\?/.test(await transcript()));

await say('4/5/2025');
const afterOld = await lastBotLine();
check('4/5/2025 is rejected for being too old',
    /more than a year back/.test(afterOld), afterOld.slice(0, 100));

await say('4/5/2026');
const afterFresh = await lastBotLine();
check('4/5/2026 is disambiguated rather than discarded',
    /Is that 4 May 2026 or 5 April 2026\?/.test(afterFresh), afterFresh.slice(0, 120));
check('the date is not abandoned', !/leave the date off/.test(await transcript()));

await say('4 May 2026');
const settledTranscript = await transcript();
// The date is settled when the flow stops asking about it and moves on to
// whatever is genuinely still missing — here, who it was paid to.
check('answering the question settles the date and the flow moves on',
    !/Is that 4 May 2026 or 5 April 2026\?\s*4 May 2026\s*(When was that|Is that)/.test(settledTranscript)
    && !/leave the date off/.test(settledTranscript)
    && /Who was it paid to\?/.test(settledTranscript),
    (await lastBotLine()).slice(0, 100));

// And the date it settled on is the one that reaches the confirmation.
await say('Kevin');
const dateConfirm = await lastBotLine();
check('the confirmation carries 4 May 2026', /4 May 2026/.test(dateConfirm), dateConfirm.slice(0, 140));

await page.screenshot({ path: join(SHOT_DIR, 'capture-date-retry.png'), fullPage: true });

// ── 3. The cap still guards a real loop ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('Sold a laptop for Ksh 45,000');
await say('dunno');
check('one unreadable answer asks again', !/leave the date off/.test(await transcript()));
await say('cant remember');
check('two consecutive unreadable answers still give up on the date',
    /leave the date off/.test(await transcript()), (await lastBotLine()).slice(0, 120));

// ── 4. lastBotLine must not be outranked by the composer ──
//
// A permanent guard on the helper itself. PasteButton's failure note is a <p>
// with role="status", rendered in the composer BELOW the transcript; the
// previous selector took the last <p> on the page and so returned that instead
// of the bot's line. The check this protects is #2's "the confirmation carries
// 4 May 2026", which is the suite's closest guard on the date-discarding bug.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('Sold a laptop for Ksh 45,000');
await say('4 May 2026');
await say('Kevin');
const botLineBefore = await lastBotLine();
check('a bot confirmation is on screen', /Right\?$/.test(botLineBefore), botLineBefore.slice(0, 90));

// Force a clipboard failure so the status note renders beneath the transcript.
await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => { throw new Error('NotAllowedError'); } },
    });
});
const pasteBtn = page.getByRole('button', { name: 'Paste from clipboard' });
if (await pasteBtn.count()) {
    await pasteBtn.click();
    await page.waitForTimeout(400);
    check('the composer status note is rendered', await page.locator('[role="status"]').count() === 1);
    check('lastBotLine still returns the bot line, not the status note',
        (await lastBotLine()) === botLineBefore, (await lastBotLine()).slice(0, 90));
    check('and it is not the clipboard message',
        !/Couldn.t read the clipboard/.test(await lastBotLine()));
}

await browser.close();
finish();
