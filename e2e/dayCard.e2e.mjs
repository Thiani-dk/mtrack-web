import { join } from 'node:path';
import { launch, openActiveMode, pasteInto, reporter, SHOT_DIR } from './harness.mjs';

// harness.mjs's saleMessage resets the balance to a fixed 20000+amount on
// every call, independent of order — fine for tests that only look at one
// message at a time, but it fabricates a balance mismatch across a sequence
// of sales, which would trip this file's own balance-note check. A real
// running balance instead, so a fixture with no genuine problem produces no
// private note.
function realisticSale(code, amount, from, hhmm, runningBalance) {
    return `${code} Confirmed. You have received Ksh${amount.toFixed(2)} from ${from} 0712345678 `
        + `on 12/9/26 at ${hhmm} PM. New M-PESA balance is Ksh${runningBalance.toFixed(2)}.`;
}

// The day card (Phase 3): a finished shift lands on its own shareable
// preview rather than History, the private notes above it never leak into
// what gets exported, the stall name can be set afterwards, and every export
// action (PNG share/save, the sales-log PDF, the CSV) actually produces a
// file — checked against a real browser, not just the pure layout math
// (see src/lib/dayCard/layout.test.ts for that).

const { check, finish } = reporter();
const consoleErrors = [];
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await openActiveMode(page);
const skip = page.getByRole('button', { name: 'Skip' });
if (await skip.count()) { await skip.click(); await page.waitForTimeout(300); }

for (const name of ['Combo sales', 'Dessert sales']) {
    await page.getByRole('button', { name: /New bucket/ }).click();
    await page.getByPlaceholder('Bucket name').fill(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
}
const chip = name => page.locator(`.am-chips button[data-bucket="${name}"]`);
await pasteInto(page, '.am-input', realisticSale('QA01XK9P2L', 350, 'JOHN KAMAU', '1:05', 20350));
await chip('Combo sales').click();
await page.waitForTimeout(150);
await pasteInto(page, '.am-input', realisticSale('QA02XK9P2L', 700, 'JOHN KAMAU', '1:19', 21050));
await chip('Combo sales').click();
await page.waitForTimeout(150);
await pasteInto(page, '.am-input', realisticSale('QA03XK9P2L', 150, 'JOHN KAMAU', '2:24', 21200));
await chip('Dessert sales').click();
await page.waitForTimeout(300);

// ── Finish lands on the day card, not History ──
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForTimeout(1500);
check('finishing a shift lands on the day card preview', (await page.locator('[data-day-card-preview]').count()) === 1);

const cardText = (await page.locator('[data-day-card-preview]').innerText()).replace(/\s+/g, ' ');
check('the hero total is on the card', cardText.includes('Ksh 1,200'));
check('the customer name never reaches the card', !/JOHN KAMAU/.test(cardText));

// ── Private notes render above the card but not inside it ──
// (This shift has no Unsorted/missing-time/balance issues, so the private
// notes area is simply absent — a positive check that it doesn't render
// empty scaffolding.)
check('no private-notes block when there is nothing to flag', (await page.locator('[data-day-card-private-notes]').count()) === 0);

// ── Tap the card to set a stall name, which persists ──
await page.locator('[data-day-card-tap]').click();
await page.waitForTimeout(200);
await page.locator('input[placeholder="Mama Chapo"]').fill('Mama Chapo Stall');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);
const afterName = (await page.locator('[data-day-card-preview]').innerText()).replace(/\s+/g, ' ');
check('the stall name appears on the card after being set', afterName.includes('Mama Chapo Stall'));

await page.reload();
await page.waitForTimeout(1200);
// A reload with no open Active Mode draft (the shift is approved, not a
// draft) lands back on HomeScreen — the persisted name change itself is what
// is being checked, reached again via History's "View card" entry point.
await page.getByRole('button', { name: /Your documents/ }).click();
await page.waitForTimeout(400);
const viewCardBtn = page.getByRole('button', { name: 'View card' });
check('the finished shift is reachable again from History', (await viewCardBtn.count()) >= 1);
await viewCardBtn.first().click();
await page.waitForTimeout(1200);
const reopened = (await page.locator('[data-day-card-preview]').innerText()).replace(/\s+/g, ' ');
check('the stall name survives a reload, reopened from History', reopened.includes('Mama Chapo Stall'));

// ── Theme toggle changes the rendered card, not just an icon ──
const bgBefore = await page.locator('[data-day-card-preview]').evaluate(el => getComputedStyle(el).backgroundColor);
await page.getByLabel('Switch theme').click();
await page.waitForTimeout(600);
const bgAfter = await page.locator('[data-day-card-preview]').evaluate(el => getComputedStyle(el).backgroundColor);
check('switching theme actually changes the card background', bgBefore !== bgAfter, `${bgBefore} -> ${bgAfter}`);

// ── Save image (PNG) ──
const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save image' }).click(),
]);
check('Save image downloads a PNG', /mtrack-day-.*\.png/.test(pngDownload.suggestedFilename()), pngDownload.suggestedFilename());
const pngPath = await pngDownload.path();
const fs = await import('node:fs');
check('the PNG is a real, non-trivial file', !!pngPath && fs.statSync(pngPath).size > 5000);

// ── Sales log PDF: no customer name anywhere in the file ──
const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Sales log PDF' }).click(),
]);
check('Sales log PDF downloads a PDF', /mtrack-sales-log-.*\.pdf/.test(pdfDownload.suggestedFilename()), pdfDownload.suggestedFilename());
const pdfPath = await pdfDownload.path();
const pdfBuf = pdfPath ? fs.readFileSync(pdfPath) : Buffer.alloc(0);
check('the sales log PDF is non-trivial', pdfBuf.length > 5000);
check('the sales log PDF never contains the customer name', !pdfBuf.toString('latin1').includes('JOHN KAMAU'));

// ── CSV, same privacy guarantee, reachable from this screen too ──
const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
]);
check('Export CSV downloads a CSV', /mtrack-sales-.*\.csv/.test(csvDownload.suggestedFilename()), csvDownload.suggestedFilename());

check('no console errors across the whole day card flow', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));

await page.screenshot({ path: join(SHOT_DIR, 'day-card-final.png') });
await browser.close();
finish();
