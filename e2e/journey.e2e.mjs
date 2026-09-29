import { join } from 'node:path';
import { launch, openActiveMode, pasteInto, pendingCapture, reporter, saleMessage, SHOT_DIR } from './harness.mjs';

// The whole Active Mode journey, in a real browser, on a fresh profile:
// HomeScreen -> first-run walkthrough with a real practice capture -> buckets
// created on the fly -> captures filed in two actions -> auto-file to Unsorted
// -> duplicate warning -> a mid-paste reload -> Finish -> the saved document.
//
// These are the checks that unit tests cannot make, because what they are
// really testing is the wiring: focus, persistence timing, app routing after a
// reload, and whether the figures on screen match the ones in IndexedDB. Two of
// the bugs this caught (landing on HomeScreen after a backgrounded reload, and
// the constrained-viewport layout) were invisible to the unit suite.
//
// Requires a running dev server — see README.

const { check, finish } = reporter();
const sale = saleMessage;
const paste = (page, text) => pasteInto(page, '.am-input', text);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 400 } });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));


// ── 1. Reach Active Mode from HomeScreen and get the first-run walkthrough ──
check('first-ever open shows the walkthrough', await openActiveMode(page));
const dialog = page.getByRole('dialog', { name: 'How Active Mode works' });

// Step through: what -> sharing -> buckets
await page.getByRole('button', { name: 'Next' }).click();
const sharingText = await dialog.innerText();
check('screen-sharing step leads with the floating window',
    sharingText.indexOf('floating window') < sharingText.indexOf('split screen'));
check('screen-sharing step offers all three paths',
    /floating window \(recommended\)/i.test(sharingText)
    && /Or try split screen/i.test(sharingText)
    && /swap between apps/i.test(sharingText));
check('split screen is scoped to the platforms that have it',
    /On Android/.test(sharingText)
    && /iPhones don.t support this/.test(sharingText)
    && /iPads have a similar Split View/.test(sharingText));
await page.getByRole('button', { name: 'Next' }).click();

// Suggested buckets + add your own
await dialog.getByRole('button', { name: 'Combo sales' }).click();
await dialog.getByRole('button', { name: 'Dessert sales' }).click();
await dialog.getByLabel('Add your own').fill('Drinks');
await dialog.getByRole('button', { name: 'Add', exact: true }).click();
check('walkthrough seeds buckets, suggested and own', (await dialog.innerText()).includes('Combo sales, Dessert sales, Drinks'));
await page.getByRole('button', { name: 'Next' }).click();

// ── 2. Practice round ──
const practiceMsg = await dialog.locator('p.text-xs.text-\\[var\\(--text-secondary\\)\\]').first().innerText();
check('practice message looks like a real M-Pesa sale', /^[A-Z0-9]{10} Confirmed\./.test(practiceMsg) && /received/.test(practiceMsg), practiceMsg.slice(0, 45));
await page.evaluate(t => {
  const el = document.querySelector('[aria-label="Practice paste field"]');
  el.focus();
  const dt = new DataTransfer(); dt.setData('text', t);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, practiceMsg);
await page.waitForTimeout(200);
check('practice capture appears, awaiting a bucket', (await dialog.innerText()).toLowerCase().includes('now tap a bucket'));
await dialog.getByRole('button', { name: /Combo sales/ }).click();
await page.waitForTimeout(200);
check('practice sale files and the tally moves', (await dialog.innerText()).includes("won't be saved"));
await page.getByRole('button', { name: 'Done practising' }).click();
await page.getByRole('button', { name: 'Start tracking' }).click();
await page.waitForTimeout(400);

check('walkthrough closes to a clean, empty session', (await page.locator('.am-total').innerText()).trim() === 'Ksh 0.00');
check('practice capture contributed nothing', (await page.locator('.am-header').innerText()).includes('0 sales'));
check('chosen buckets carried over', (await page.locator('.am-chips').innerText()).includes('Drinks'));

// ── 3. Two-action capture ──
await paste(page, sale('QA01XK9P2L', 350, 'JOHN KAMAU', '12:05'));
// Read as a value. The substring "tap a bucket" appears in the empty-state
// hint as well as the pending card; this script only ever distinguished them
// because a media query hides that hint below 460px, which is an accident of
// responsive design and not something this assertion should depend on.
check('paste alone produces a pending capture (action 1)', (await pendingCapture(page))?.amount === 350);
await page.locator('.am-chips button', { hasText: 'Combo sales' }).click();
await page.waitForTimeout(150);
check('one tap files it (action 2)', (await page.locator('.am-total').innerText()).includes('350'));
const focused = await page.evaluate(() => document.activeElement?.classList.contains('am-input'));
check('paste field is re-focused straight after filing', focused === true);

// ── 4. Auto-file to Unsorted ──
await paste(page, sale('QA02XK9P2L', 700, 'MARY WANJIKU', '12:11'));
await paste(page, sale('QA03XK9P2L', 150, 'PETER OTIENO', '12:19'));  // arrives before the first was filed
await page.waitForTimeout(200);
const chipsText = await page.locator('.am-chips').innerText();
check('unfiled capture auto-files to Unsorted rather than being lost', /Unsorted[\s\S]*?700/.test(chipsText.replace(/\n/g, ' ')), chipsText.replace(/\n/g, ' ').slice(0, 90));

// ── 5. Duplicate warning, non-blocking ──
await page.locator('.am-chips button', { hasText: 'Dessert sales' }).click();
await page.waitForTimeout(150);
await paste(page, sale('QA03XK9P2L', 150, 'PETER OTIENO', '12:19'));  // exact same message
await page.waitForTimeout(150);
const dupText = await page.locator('.am-capture').innerText();
check('a duplicate paste warns without blocking', /same (message as )?sale #/i.test(dupText), dupText.replace(/\n/g, ' ').slice(0, 80));
check('the duplicate can still be filed anyway', await page.locator('.am-chips button', { hasText: 'Combo sales' }).isEnabled());

// ── 6. New bucket on the fly, and a scrolling chip row ──
for (const name of ['Snacks', 'Bottled water', 'Ice cream', 'Chips', 'Tea']) {
  await page.getByRole('button', { name: /New bucket/ }).click();
  await page.getByPlaceholder('Bucket name').fill(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
}
const chipMetrics = await page.evaluate(() => {
  const c = document.querySelector('.am-chips');
  c.scrollLeft = c.scrollWidth;
  const kids = [...c.children];
  const last = kids[kids.length - 1].getBoundingClientRect();
  const box = c.getBoundingClientRect();
  return { count: kids.length, scrollable: c.scrollWidth > c.clientWidth, wrap: getComputedStyle(c).flexWrap, lastRight: +last.right.toFixed(1), containerRight: +box.right.toFixed(1), rowHeight: +box.height.toFixed(1) };
});
check('chip row scrolls sideways instead of wrapping', chipMetrics.scrollable && chipMetrics.wrap === 'nowrap', JSON.stringify(chipMetrics));
check('the last chip is fully reachable, not clipped', chipMetrics.lastRight <= chipMetrics.containerRight + 0.5);

// ── 7. Simulated keyboard: shrink the viewport, everything stays reachable ──
for (const [w, h, label] of [[360, 400, 'narrow split'], [640, 280, 'landscape split'], [360, 210, 'split + keyboard open']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(200);
  const vis = await page.evaluate(({ h }) => {
    const b = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; };
    const finishEl = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Finish');
    const fr = finishEl.getBoundingClientRect();
    const ok = x => x && x.bottom <= h + 0.5 && x.top >= -0.5 && x.h > 0;
    return { input: ok(b('.am-input')), chips: ok(b('.am-chips')), total: ok(b('.am-total')), finish: ok({ top: fr.top, bottom: fr.bottom, h: fr.height }), overflow: document.documentElement.scrollHeight > h + 1, rootH: document.querySelector('.active-mode').getBoundingClientRect().height };
  }, { h });
  check(`${label} (${w}x${h}): input, chips, total and Finish all on screen`,
    vis.input && vis.chips && vis.total && vis.finish && !vis.overflow, JSON.stringify(vis));
}
await page.setViewportSize({ width: 360, height: 400 });

// ── 8. Mid-pending reload ──
await paste(page, sale('QA09XK9P2L', 1250, 'GRACE ATIENO', '12:44'));
await page.waitForTimeout(200);
const beforeTotal = (await page.locator('.am-total').innerText()).trim();
const beforeChips = (await page.locator('.am-chips').innerText()).replace(/\s+/g, ' ');
check('a capture is pending before the reload', (await pendingCapture(page))?.amount === 1250);
await page.waitForTimeout(900);   // let the debounced write land
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const helpVisible = await page.getByRole('dialog', { name: 'How Active Mode works' }).count();
check('the walkthrough does not re-trigger on a later open', helpVisible === 0);
check('the pending, unfiled capture survives the reload',
  (await pendingCapture(page))?.amount === 1250, JSON.stringify(await pendingCapture(page)));
check('the running total survives the reload', (await page.locator('.am-total').innerText()).trim() === beforeTotal, `${beforeTotal} -> ${(await page.locator('.am-total').innerText()).trim()}`);
const afterChips = (await page.locator('.am-chips').innerText()).replace(/\s+/g, ' ');
check('every bucket subtotal and count survives the reload', afterChips === beforeChips, afterChips.slice(0, 120));

// ── 9. Help icon re-opens the walkthrough ──
await page.getByRole('button', { name: 'How Active Mode works' }).click();
await page.waitForTimeout(300);
check('the help icon re-opens the walkthrough on demand', await page.getByRole('dialog', { name: 'How Active Mode works' }).count() === 1);
await page.getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(200);

// ── 10. Focus is not stolen on returning from another app ──
const scrollBefore = await page.evaluate(() => document.querySelector('.am-capture').scrollTop);
await page.evaluate(() => { document.querySelector('.am-input').blur(); });
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(150);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(300);
const afterSwitch = await page.evaluate(() => ({ focused: document.activeElement?.classList.contains('am-input'), scroll: document.querySelector('.am-capture').scrollTop }));
check('switching back does not force-focus the field', afterSwitch.focused === false, JSON.stringify(afterSwitch));
check('switching back does not jump the scroll position', afterSwitch.scroll === scrollBefore);

// ── 11. Finish, and check the stored document against the screen ──
//
// The bucket-by-bucket rendering checks that used to live here (report vs.
// raw record vs. on-screen chips vs. an independently-computed total) tested
// documentLayout.ts's now-removed Active Mode bucket-breakdown section — see
// Phase 1 of the cash/day-card/receipt pass, which gave Active Mode its own
// daily_sales document type and its own card layout instead of reusing
// expense_summary's. That new layout (dayCardLayout.ts) is a Phase 3
// deliverable; the equivalent "renderer agrees with the stored record and
// with what the vendor saw on screen" coverage is re-established there, for
// the real day card, once it exists — not faked here against a layout that no
// longer runs.
//
// What stays here, unchanged in spirit, is the part that has nothing to do
// with bucket rendering: that Finish produces an approved daily_sales
// document, that every sale the vendor filed is in it, that the stored total
// matches what was on screen, and that nothing is left pending.
await page.locator('.am-chips button', { hasText: 'Drinks' }).click();
await page.waitForTimeout(200);
const finalTotal = (await page.locator('.am-total').innerText()).trim();
const finalCount = (await page.locator('.am-header').innerText()).match(/(\d+) sales/)[1];
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForTimeout(1200);
const doc = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('mtrack-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await new Promise((res, rej) => { const t = db.transaction('documents', 'readonly'); const q = t.objectStore('documents').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const d = all.filter(x => x.documentType === 'daily_sales').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!d) return null;
  return { status: d.status, type: d.documentType, active: d.capturedViaActiveMode, n: d.transactions.length, total: d.transactions.reduce((s, t) => s + t.amount, 0), pending: d.activeMode?.pending ?? null };
});
check('Finish produces an approved daily_sales document from Active Mode', doc && doc.status === 'approved' && doc.type === 'daily_sales' && doc.active === true, JSON.stringify({ status: doc?.status, type: doc?.type }));
check('every captured sale is in the document', String(doc.n) === finalCount, `${doc.n} vs ${finalCount} on screen`);
check('the document total matches the screen total', `Ksh ${doc.total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d)\.)/g, ',')}` === finalTotal, `${doc.total} vs ${finalTotal}`);
check('nothing is left pending on a finished document', doc.pending === null);

await page.screenshot({ path: join(SHOT_DIR, 'journey-final.png') });
await browser.close();

console.log(`\nScreenshots: ${SHOT_DIR}`);
finish();
