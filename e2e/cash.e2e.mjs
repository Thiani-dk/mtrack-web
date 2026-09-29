import { join } from 'node:path';
import { launch, openActiveMode, pasteInto, reporter, saleMessage, SHOT_DIR } from './harness.mjs';

// Cash sales in Active Mode, in a real browser: the three-tap flow, presets
// drawn from the day's real history, "Same again" in one tap, Undo, the
// entries list, and a lump sum — each checked against the actual stored
// IndexedDB record, not just what is on screen.

const { check, finish } = reporter();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));

const chip = name => page.locator(`.am-chips button[data-bucket="${name}"]`);
const storedTransactions = () => page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mtrack-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res, rej) => { const t = db.transaction('documents', 'readonly'); const q = t.objectStore('documents').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const d = all.filter(x => x.documentType === 'daily_sales').sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return d ? d.transactions : [];
});

await openActiveMode(page);
const skip = page.getByRole('button', { name: 'Skip' });
if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }

for (const name of ['Combo sales', 'Drinks']) {
    await page.getByRole('button', { name: /New bucket/ }).click();
    await page.getByPlaceholder('Bucket name').fill(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
}

// ── The M-Pesa path is still exactly two actions ──
await pasteInto(page, '.am-input', saleMessage('QA01XK9P2L', 350, 'JOHN KAMAU', '12:05'));
check('paste alone produces a pending capture (action 1 of 2)', (await page.locator('[data-pending-capture]').count()) === 1);
await chip('Combo sales').click();
await page.waitForTimeout(200);
check('one tap files it (action 2 of 2)', (await page.locator('[data-pending-capture]').count()) === 0);

// ── With no history, "Other" is the only amount option ──
await page.getByRole('button', { name: 'Cash', exact: true }).click();
await page.locator('[data-cash-bucket="Drinks"]').click();
const firstAmountStep = (await page.locator('[data-cash-panel]').innerText()).replace(/\s+/g, ' ');
check('with no history in that bucket, Other is the only option', firstAmountStep.includes('Other')
    && !/Ksh \d/.test(firstAmountStep.replace('Other', '')), firstAmountStep);
await page.getByRole('button', { name: 'Cancel' }).click();

// ── A typical cash sale: Cash, bucket, amount — three taps ──
await pasteInto(page, '.am-input', saleMessage('QA02XK9P2L', 100, 'MARY WANJIKU', '12:07'));
await chip('Drinks').click();
await page.waitForTimeout(200);
let taps = 0;
await page.getByRole('button', { name: 'Cash', exact: true }).click(); taps++;
await page.locator('[data-cash-bucket="Drinks"]').click(); taps++;
// A preset now exists (the Ksh 100 M-Pesa sale just filed into Drinks).
const presetVisible = await page.locator('[data-cash-amount="100"]').count();
check('presets reflect the bucket\'s real history (M-Pesa counts too)', presetVisible === 1);
await page.locator('[data-cash-amount="100"]').click(); taps++;
check('a typical cash sale is at most three taps', taps <= 3, `taps: ${taps}`);
await page.waitForTimeout(200);
check('the undo banner appears after a cash sale', /Added/.test(await page.locator('.am-capture').innerText()));

// Past the autosave write debounce (~500ms) before every IndexedDB read below
// — the on-screen state updates immediately, but the persisted copy this test
// actually checks lags behind it, same as every other e2e test in this suite
// that reads the store directly.
await page.waitForTimeout(900);
let stored = await storedTransactions();
check('the cash sale is stored correctly',
    stored.some(t => t.method === 'cash' && t.amount === 100 && t.bucketLabel === 'Drinks' && t.time),
    JSON.stringify(stored.filter(t => t.method === 'cash')));

// ── Undo restores the exact prior state ──
const beforeUndo = await storedTransactions();
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(900); // past the autosave debounce
const afterUndo = await storedTransactions();
check('undo removes exactly the one entry, nothing else',
    afterUndo.length === beforeUndo.length - 1
    && afterUndo.every(a => beforeUndo.some(b => b.transactionCode === a.transactionCode)),
    `before=${beforeUndo.length} after=${afterUndo.length}`);

// ── "Same again": one tap ──
await page.getByRole('button', { name: 'Cash', exact: true }).click();
await page.locator('[data-cash-bucket="Drinks"]').click();
await page.locator('[data-cash-amount="100"]').click();
await page.waitForTimeout(900);
const beforeSameAgain = (await storedTransactions()).length;
await page.getByRole('button', { name: /Same again/ }).click();
await page.waitForTimeout(900);
const afterSameAgain = await storedTransactions();
check('"Same again" is one tap and repeats the bucket and amount',
    afterSameAgain.length === beforeSameAgain + 1
    && afterSameAgain.filter(t => t.method === 'cash' && t.amount === 100 && t.bucketLabel === 'Drinks').length === 2,
    JSON.stringify(afterSameAgain.filter(t => t.method === 'cash')));

// ── The entries list, and removing one from it ──
await page.getByRole('button', { name: "Today's entries" }).click();
const entryCountBefore = await page.locator('[data-entry]').count();
check('the entries list shows both cash and M-Pesa entries', entryCountBefore >= 4);
await page.locator('[data-entry]').first().getByRole('button', { name: 'Remove entry' }).click();
await page.waitForTimeout(200);
check('removing an entry from the list takes it off the list', (await page.locator('[data-entry]').count()) === entryCountBefore - 1);

// ── A lump sum: one total per bucket, an optional count ──
await page.getByRole('button', { name: 'Add cash for the day' }).click();
await page.locator('input[data-lump-amount="Combo sales"]').fill('4040');
await page.locator('input[data-lump-count="Combo sales"]').fill('12');
await page.locator('input[data-lump-amount="Unsorted"]').fill('500');
// Unsorted's count left blank on purpose — "an optional count of sales".
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(900);

const withLumpSums = await storedTransactions();
const comboLump = withLumpSums.find(t => t.isLumpSum && t.bucketLabel === 'Combo sales');
const overallLump = withLumpSums.find(t => t.isLumpSum && t.bucketLabel === null);
check('a lump sum with a count saves correctly', comboLump?.amount === 4040 && comboLump?.lumpSumCount === 12, JSON.stringify(comboLump));
check('a lump sum with no count saves with lumpSumCount null, not a guess', overallLump?.amount === 500 && overallLump?.lumpSumCount === null, JSON.stringify(overallLump));
check('a lump sum has no clock time', comboLump?.time === '', JSON.stringify(comboLump?.time));

// ── The CSV export downloads, with no customer name in it ──
const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
]);
const csvPath = await download.path();
const csvContent = csvPath ? (await import('node:fs')).readFileSync(csvPath, 'utf8') : '';
check('the CSV download fires with a sensible filename', /mtrack-sales-.*\.csv/.test(download.suggestedFilename()), download.suggestedFilename());
check('the CSV has no customer name in it', csvContent.length > 0 && !/JOHN KAMAU|MARY WANJIKU/i.test(csvContent), csvContent.slice(0, 120));
check('the CSV has a header row and one row per transaction, no totals row',
    csvContent.trim().split(/\r\n/).length === withLumpSums.length + 1,
    `rows=${csvContent.trim().split(/\r\n/).length} txns=${withLumpSums.length}`);

await page.screenshot({ path: join(SHOT_DIR, 'cash-final.png') });

await browser.close();
finish();
