import { join } from 'node:path';
import { BASE_URL, launch, reporter, SHOT_DIR } from './harness.mjs';

// The sales receipt (Phase 4): built through the real chat conversation (the
// "a receipt for a customer" mode), then reopened from History onto its own
// thermal-receipt-style screen — a different document type's worth of
// wiring than any other e2e file exercises, and the one place the printed
// receiptNumber, the reconciliation UI, and every export actually run
// end to end.

const { check, finish } = reporter();
const consoleErrors = [];
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => check('no uncaught page errors', false, e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const composer = () => page.locator('textarea, input[type="text"]').last();
const send = async (text) => {
    await composer().fill(text);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
};

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.getByText('Start a summary', { exact: true }).click();
await page.waitForTimeout(400);
await page.getByText('A receipt for a customer', { exact: true }).click();
await page.waitForTimeout(600);

await send('Mama Chapo');
await send('Sold 2 chapati at 20 each and a soda for 60, paid 100 cash');
await send('today');
await send('yes');
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Approve' }).click();
await page.waitForTimeout(800);

// ── Reopen from History, onto the dedicated receipt screen ──
await page.goto(BASE_URL);
await page.waitForTimeout(400);
await page.getByText(/Your documents/).click();
await page.waitForTimeout(500);
const viewReceiptBtn = page.getByRole('button', { name: 'View receipt' });
check('the approved receipt is reachable from History', (await viewReceiptBtn.count()) >= 1);
await viewReceiptBtn.first().click();
await page.waitForTimeout(1500);

check('lands on the dedicated receipt screen', (await page.locator('[data-receipt-preview]').count()) === 1);
const receiptText = (await page.locator('[data-receipt-preview]').innerText()).replace(/\s+/g, ' ');
check('the business name is on the receipt', receiptText.includes('MAMA CHAPO'));
check('the total is on the receipt', receiptText.includes('Ksh 200.00'));
check('the amount is spelled out in words', receiptText.includes('TWO HUNDRED SHILLINGS ONLY'));
check('a stable receipt number is printed, matching MT<date>-<code>', /MT\d{6}-[A-Z0-9]{5}/.test(receiptText));
check('no reconciliation prompt when the items already match the total', (await page.locator('[data-reconcile-panel]').count()) === 0);

// ── Editable fields: Served by ──
await page.getByText('Add who served this sale (optional)').click();
await page.waitForTimeout(200);
await page.locator('input').last().fill('Amina');
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
const afterServedBy = (await page.locator('[data-receipt-preview]').innerText()).replace(/\s+/g, ' ');
check('"Served by" appears on the receipt once set', afterServedBy.includes('Served by Amina'));

// ── Reload (drops back to History, since there is no open draft), reopen:
// the served-by edit and receipt number both persisted ──
await page.reload();
await page.waitForTimeout(1000);
await page.getByText(/Your documents/).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'View receipt' }).first().click();
await page.waitForTimeout(1200);
const reopened = (await page.locator('[data-receipt-preview]').innerText()).replace(/\s+/g, ' ');
check('the served-by edit survives a reload', reopened.includes('Served by Amina'));
const numberMatch = receiptText.match(/MT\d{6}-[A-Z0-9]{5}/);
check('the receipt number is exactly the same after a reload (stable, not clock-based)', numberMatch && reopened.includes(numberMatch[0]));

// ── Exports ──
const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save image' }).click(),
]);
check('Save image downloads a PNG', /mtrack-receipt-.*\.png/.test(pngDownload.suggestedFilename()));

const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as PDF' }).click(),
]);
check('Save as PDF downloads a PDF', /mtrack-receipt-.*\.pdf/.test(pdfDownload.suggestedFilename()));
const pdfPath = await pdfDownload.path();
const fs = await import('node:fs');
const pdfBuf = pdfPath ? fs.readFileSync(pdfPath) : Buffer.alloc(0);
check('the PDF is a real, non-trivial file', pdfBuf.length > 3000);

const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as web page' }).click(),
]);
check('Save as web page downloads an HTML file', /mtrack-receipt-.*\.html/.test(htmlDownload.suggestedFilename()));

check('no console errors across the whole receipt flow', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));

await page.screenshot({ path: join(SHOT_DIR, 'receipt-final.png') });
await browser.close();
finish();
