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

// ── 5. The bacon-and-groceries message, from the screenshot ──
//
// Three items, three amounts, not one currency token, one typo and one merged
// word. It extracted nothing and the bot replied "How much was it?". Replayed
// through the real chat because the bug was only ever visible as which
// question came next.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('hi so, i spent quite a lot today. i boought somebacon and pork cuts for 3100, '
    + 'then i rode a bus to a neighborhood where i bought tomatoes, ginger, chapati, onions, '
    + 'and garlic at 400. then i bought airtime worth 30');

const afterBacon = await transcript();
check('the bot does not ask for an amount it was already given',
    !/How much was it\?/.test(afterBacon), afterBacon.slice(-160));
check('nor asks what was bought', !/What did they buy\?|Who was it paid to\?/.test(afterBacon));
check('and never claims it understood nothing',
    !/couldn.t pick anything out/i.test(afterBacon));
check('the three amounts and their total are on screen',
    /3,100/.test(afterBacon) && /400/.test(afterBacon) && /3,530/.test(afterBacon),
    afterBacon.slice(-200));

// ── 6. A genuinely unparseable message gets an honest answer ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('zxcv qwer asdf');
const firstMiss = await lastBotLine();
check('says plainly that it did not follow, rather than asking for one field',
    /couldn.t pick anything out/i.test(firstMiss), firstMiss.slice(0, 120));
check('and does not ask "How much was it?" about it', !/How much was it\?/.test(firstMiss));

await say('qwer zxcv asdf');
const secondMiss = await lastBotLine();
check('the second time is worded differently', secondMiss !== firstMiss, secondMiss.slice(0, 120));

await say('asdf qwer zxcv');
const thirdMiss = await transcript();
check('the third offers a way out instead of asking again',
    /Paste the message instead/.test(thirdMiss) && /Skip this one/.test(thirdMiss),
    thirdMiss.slice(-200));

// ── 7. A merely-incomplete message still gets its targeted question ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('bought bacon');
const incomplete = await transcript();
check('an item with no price is still asked about specifically',
    !/couldn.t pick anything out/i.test(incomplete), incomplete.slice(-160));

// ── 8. Cancel, which had no handling at all before ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('never mind');
check('a cancel with nothing captured is taken at once, with no extra tap',
    /scrapped/i.test(await lastBotLine()), (await lastBotLine()).slice(0, 120));

// With real progress behind it, it asks first.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('bought bacon for 3100');
await say('cancel');
const cancelAsk = await transcript();
check('a cancel with progress names what is at stake', /3,100/.test(cancelAsk), cancelAsk.slice(-200));
check('and offers both ways out',
    /Discard everything/.test(cancelAsk) && /Keep what I have/.test(cancelAsk));

await page.getByRole('button', { name: 'Keep what I have' }).click();
await page.waitForTimeout(900);
check('keeping what is there goes to the confirmation, not back to questions',
    /Right\?$/.test(await lastBotLine()), (await lastBotLine()).slice(0, 120));

// And the words must not fire inside an ordinary sentence.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('bought a stop sign for 400 and a cancel culture book for 900');
check('"stop" and "cancel" inside a real sentence do not scrap the document',
    !/scrapped|Discard everything/i.test(await transcript()), (await transcript()).slice(-160));

// ── 9. A correction at the confirmation, which used to wipe the draft ──
//
// Anything that wasn't "yes" at the confirm step reset the whole draft and
// restarted from the date question, so "actually it was 3500" threw away a
// correct amount, date and item list.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('i bought bacon for 3100, tomatoes for 400 and airtime for 30 today');
check('the itemised message needs no further questions',
    /Right\?$/.test(await lastBotLine()), (await lastBotLine()).slice(0, 140));

await say('the bacon was actually 3500');
const corrected = await transcript();
check('the correction names what it changed', /3,100\s*→\s*Ksh\s*3,500/.test(corrected), corrected.slice(-260));
check('and states the new total', /3,930/.test(corrected));
check('it does not restart from the date question',
    !/let.s go through it/i.test(corrected), corrected.slice(-200));
check('the other items survive', /Tomatoes/.test(corrected) && /Airtime/.test(corrected));

// An unreferenced correction over several items asks rather than guessing.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('i bought bacon for 3100, tomatoes for 400 and airtime for 30 today');
await say('actually it was 3500');
const asked = await transcript();
check('an ambiguous correction asks which item', /Which one/.test(asked), asked.slice(-200));

await page.getByRole('button', { name: /^Tomatoes/ }).click();
await page.waitForTimeout(900);
const afterPick = await transcript();
check('picking the item applies the change to that one', /400\s*→\s*Ksh\s*3,500/.test(afterPick), afterPick.slice(-220));

// ── 10. A message that says two things at once ──
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('bought bacon for 3100 today, also can you tell me what currencies you support');
const both = await transcript();
// The amount landed: the flow moved on to the one thing it genuinely lacks
// rather than asking for a figure the message already gave.
check('the purchase is captured, not re-asked about',
    !/How much was it\?/.test(both), both.slice(-260));
check('and the question is answered in the same turn',
    /To answer your question/.test(both) && /Shillings/.test(both), both.slice(-260));
check('the question clause is not mined for an amount', !/Ksh 0\b/.test(both));

await say('bacon');
check('and the captured figure reaches the confirmation intact',
    /3,100/.test(await lastBotLine()), (await lastBotLine()).slice(0, 140));

// ── 11. A question asked in the middle of being asked something ──
//
// The interruption must not count as an answer to anything, and the parked
// question has to come back verbatim.
await startChat();
await page.getByRole('button', { name: 'My own spending' }).click();
await page.waitForTimeout(800);
await say('bought bacon');
const parked = await lastBotLine();
check('a question is on the table', /When was that\?/.test(parked), parked.slice(0, 100));

await say('wait, what currencies do you support?');
const answered = await lastBotLine();
check('the question is answered', /Shillings/.test(answered), answered.slice(0, 160));
check('and the parked question comes straight back', /Anyway —/.test(answered) && /when was that/i.test(answered));
check('it is not treated as gibberish', !/couldn.t pick anything out/i.test(await transcript()));

await say('yesterday');
const resumed = await transcript();
check('the interruption did not consume the date question',
    !/When was that\?[^]*When was that\?[^]*When was that\?/.test(resumed));
check('the flow resumed exactly where it was',
    /How much was it\?/.test(resumed), resumed.slice(-160));

await browser.close();
finish();
