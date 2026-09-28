import { join } from 'node:path';
import { launch, reporter, SHOT_DIR } from './harness.mjs';

// The guided demo, replayed on a phone-sized viewport, including one of the
// side chips.
//
// What this is really testing is that the showcase moments run through the
// PRODUCTION conversation engine and not through a demo-shaped imitation of
// it. The one-sentence chip sends a sentence a person would actually type; if
// the engine could not read it, this replay is where that shows up.

const { check, finish } = reporter();

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));

const transcript = async () =>
    (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');

// Waits for the reply to finish arriving. Each bubble has a short typing beat
// in front of it (lib/conversation/pacing), so a fixed timeout races the last
// one.
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

// Scoped to enabled buttons. An answered question leaves its options locked
// but still on screen, so the same label can appear twice and only the live
// one is tappable.
const tap = async (name) => {
    await page.locator('button:not([disabled])')
        .filter({ hasText: name }).first().click();
    await settled();
};

// Taps whichever option is offered first, for the steps where the demo's own
// wording is not what this replay is about.
const tapFirstOption = async () => {
    const before = await transcript();
    // Answered questions leave their buttons locked, so only enabled ones count.
    const options = page.locator('button:not([disabled])');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
        const label = (await options.nth(i).innerText()).trim();
        if (!label || /something else|menu|back|new|paste|copy/i.test(label)) continue;
        if (!before.includes(label)) continue;
        await options.nth(i).click();
        await settled();
        return label;
    }
    throw new Error('no option to tap');
};

await page.goto(process.env.E2E_BASE_URL ?? 'http://localhost:5173/');
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForTimeout(600);

await page.getByRole('button', { name: /Try it with sample data first/i }).click();
await settled();
check('the demo opens with the claim opener', /claim for money you spent/i.test(await transcript()));

let taps = 0;
const countedTap = async (name) => { taps += 1; await tap(name); };

// ── The shortest path, in taps ──
await countedTap('Your boss');
taps += 1;
await tapFirstOption();              // whichever errand is offered first
check('the spending questions begin', /What did you spend on\?/i.test(await transcript()));

// ── Moment 1: say it in one sentence ──
await countedTap('Say it in one sentence');
const afterSentence = await transcript();
check('the sentence is sent as the user would have typed it',
    /Team lunch at Java House, 2,400, yesterday/.test(afterSentence));
check('every field comes back out of it',
    /2,400/.test(afterSentence) && /Java House/i.test(afterSentence)
    && /September/i.test(afterSentence), afterSentence.slice(-220));

// ── Moment 2: a one-step correction, shown before and after ──
//
// OFF the shortest path: the sentence can be accepted as it stands. Counted
// separately so the shortest-path figure stays honest.
let optionalTaps = 0;
optionalTaps += 1;
await tap('Actually it was 2,600');
const afterFix = await transcript();
check('the correction is applied in one message', /2,600/.test(afterFix), afterFix.slice(-200));
check('and it says what changed, before and after',
    /2,400/.test(afterFix) && /2,600/.test(afterFix), afterFix.slice(-200));

await countedTap("Yes, that's it");
check('the line joins the claim', /Added|on the document/i.test(await transcript()));

// ── A side chip, off the shortest path, resuming where it was ──
const beforeSide = await transcript();
optionalTaps += 1;
await tap('Is my data safe?');
const afterSide = await transcript();
check('the side chip gets an honest answer',
    /stays on this phone/i.test(afterSide) && /no account/i.test(afterSide), afterSide.slice(-260));
check('and the demo resumes exactly where it was',
    /Added\. Another one, or is that enough\?|That's plenty to work with/i.test(afterSide));
check('the side chip did not advance the claim',
    (afterSide.match(/Ksh 2,600/g) ?? []).length === (beforeSide.match(/Ksh 2,600/g) ?? []).length);

// ── Finish the claim ──
await countedTap("That's enough");
check('the purpose walk begins', /what each line was for/i.test(await transcript()));

taps += 1;
await tapFirstOption();              // whichever purpose is offered first
const afterPurpose = await transcript();
check('the paste lesson follows', /copy the actual M-Pesa message|Copy that and send it back/i.test(afterPurpose));

// The paste lesson is the one step that is not a tap, by design: it exists to
// show what pasting a real message does. Counted separately from the tap path.
// Sent rather than clipboard-pasted: the clipboard path has its own suite
// (paste.e2e.mjs), and what this replay is about is the demo completing.
const sample = await page.locator('pre, code, .font-mono').first().innerText();
const box = page.getByRole('textbox').last();
await box.fill(sample.trim());
await box.press('Enter');
await settled(14000);

const final = await transcript();
check('the claim renders at the end', /Here's the claim you just built|That's everything/i.test(final));
check('the closing summary names the sentence moment',
    /one sentence/i.test(final), final.slice(-420));
check('and names the correction moment', /changed a figure/i.test(final), final.slice(-420));
check('and names the side chip that was used', /off the subject/i.test(final), final.slice(-420));

// Seven was the shortest path before this pass: party, errand, category,
// place, amount, "that's enough", purpose. The one-sentence chip replaces
// three of those with one.
check('the shortest tap path is no longer than it was', taps <= 7, `taps: ${taps}`);
console.log(`demo shortest path: ${taps} taps to the claim (${optionalTaps} optional taps also used), `
    + 'plus the paste lesson');

await page.screenshot({ path: join(SHOT_DIR, 'demo-final.png'), fullPage: false });

await browser.close();
finish();
