import { join } from 'node:path';
import { launch, openActiveMode, pasteInto, reporter, saleMessage, SHOT_DIR } from './harness.mjs';

// Long-press to rename or delete a bucket.
//
// The gesture is the part that can only be checked in a browser: that holding a
// chip opens the menu without also firing the tap that files a sale, that
// Unsorted has no such menu, and that a delete moves its sales rather than
// taking them with it.

const { check, finish } = reporter();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));

const chip = name => page.locator(`.am-chips button[data-bucket="${name}"]`);

// Hold a chip past the long-press threshold using real pointer events.
async function longPress(name, ms = 800) {
    const target = chip(name);
    await target.waitFor({ state: 'visible' });
    await target.scrollIntoViewIfNeeded();
    // Let any layout settle before measuring — a box read mid-reflow puts the
    // press somewhere the chip no longer is.
    await page.waitForTimeout(200);
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(300);
}

// Keyed on the panel itself, not its text — its contents change as the
// menu moves between actions, rename and confirm-delete.
const menuPanel = () => page.locator('[data-bucket-menu]');
const tallyOf = async name => {
    const text = await chip(name).innerText();
    return text.replace(/\s+/g, ' ').trim();
};

await openActiveMode(page);
const skip = page.getByRole('button', { name: 'Skip' });
if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }

// Two buckets, two sales filed into one of them.
for (const name of ['Combo sales', 'Dessert sales']) {
    await page.getByRole('button', { name: /New bucket/ }).click();
    await page.getByPlaceholder('Bucket name').fill(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
}
await pasteInto(page, '.am-input', saleMessage('QA01XK9P2L', 350, 'JOHN KAMAU', '12:05'));
await chip('Combo sales').click();
await page.waitForTimeout(150);
await pasteInto(page, '.am-input', saleMessage('QA02XK9P2L', 700, 'MARY WANJIKU', '12:11'));
await chip('Combo sales').click();
await page.waitForTimeout(150);

const comboBefore = await tallyOf('Combo sales');
check('two sales filed into Combo sales', /1,050|350/.test(comboBefore), comboBefore);

// ── Unsorted has no menu ──
await longPress('Unsorted');
check('long-pressing Unsorted opens nothing', await menuPanel().count() === 0);
check('Unsorted advertises no edit affordance',
    (await chip('Unsorted').getAttribute('aria-description')) === null);

// ── Any other bucket does ──
await longPress('Dessert sales');
check('long-pressing another bucket opens the menu', await menuPanel().count() === 1);
check('the menu uses the established glass-panel overlay',
    await page.locator('[data-bucket-menu].glass-panel').count() === 1);
check('the menu offers exactly Rename and Delete',
    await menuPanel().getByRole('button', { name: 'Rename' }).count() === 1
    && await menuPanel().getByRole('button', { name: 'Delete' }).count() === 1);

// Deleting an empty bucket goes straight through.
await menuPanel().getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(300);
check('an empty bucket deletes with no confirmation', await chip('Dessert sales').count() === 0);
check('the menu closed afterwards', await menuPanel().count() === 0);

// ── Rename preserves the figures ──
await longPress('Combo sales');
await menuPanel().getByRole('button', { name: 'Rename' }).click();
await page.waitForTimeout(150);
await page.getByLabel('Bucket name').fill('Meal deals');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(300);
check('the bucket is renamed', await chip('Meal deals').count() === 1 && await chip('Combo sales').count() === 0);
const renamed = await tallyOf('Meal deals');
check('rename preserves the subtotal and count',
    renamed.replace('Meal deals', '').trim() === comboBefore.replace('Combo sales', '').trim(),
    `${comboBefore}  ->  ${renamed}`);

// ── A long press must not also file a sale ──
await pasteInto(page, '.am-input', saleMessage('QA03XK9P2L', 150, 'PETER OTIENO', '12:19'));
const totalBeforeHold = (await page.locator('.am-total').innerText()).trim();
await longPress('Meal deals');
check('holding a chip does not also file the pending sale',
    (await page.locator('.am-total').innerText()).trim() === totalBeforeHold
    && (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'),
    totalBeforeHold);

// ── Delete with contents: confirm, then everything lands in Unsorted ──
await menuPanel().getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(200);
const confirmText = (await menuPanel().innerText()).replace(/\s+/g, ' ');
check('deleting a bucket with sales asks first, naming the count',
    /Move 2 sales to Unsorted and delete this bucket\?/.test(confirmText), confirmText);

const unsortedBefore = await tallyOf('Unsorted');
await menuPanel().getByRole('button', { name: 'Move and delete' }).click();
await page.waitForTimeout(400);

check('the bucket is gone', await chip('Meal deals').count() === 0);
const unsortedAfter = await tallyOf('Unsorted');
check('its sales reappear under Unsorted', /1,050/.test(unsortedAfter), `${unsortedBefore}  ->  ${unsortedAfter}`);
check('Unsorted count reflects them', /· 2/.test(unsortedAfter), unsortedAfter);

// Nothing was lost: the day total is untouched by any of the above.
// Past the autosave debounce first, so this reads the write the delete
// triggered rather than the one before it.
await page.waitForTimeout(900);
const filedTotal = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mtrack-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res, rej) => { const t = db.transaction('documents', 'readonly'); const q = t.objectStore('documents').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const d = all.filter(x => x.capturedViaActiveMode).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return { n: d.transactions.length, total: d.transactions.reduce((s, t) => s + t.amount, 0), labels: d.transactions.map(t => t.bucketLabel) };
});
check('every sale survived the rename and the delete', filedTotal.n === 2 && filedTotal.total === 1050, JSON.stringify(filedTotal));
check('and they are unlabelled, i.e. genuinely in Unsorted', filedTotal.labels.every(l => l === null), JSON.stringify(filedTotal.labels));

await page.screenshot({ path: join(SHOT_DIR, 'buckets-final.png') });
await browser.close();
finish();
