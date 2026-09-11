import { describe, expect, it } from 'vitest';
import { buildDocModel, measureDrawnStrings, renderDocHTML } from '../documentLayout';
import type { DocRenderMeta } from '../documentRender';
import { computeReceiptData } from '../receiptGenerator';
import { bucketTallies, captureFromPaste, dayTotal, fileInto, readActiveModeState } from './session';
import { applyActiveModeDirection } from './direction';
import type { ParsedTransaction } from '../../types';

// The end-of-day report. It is an expense_summary — the same document type,
// the same renderer — with one optional section added. These tests care about
// two things: that the bucket figures are right, and that they are identical
// wherever they are shown.

function sale(amount: number, from: string, minute: number): ParsedTransaction {
    const raw = `${code(minute)} Confirmed. You have received Ksh${amount.toFixed(2)} from ${from} `
        + `0712345678 on 11/9/26 at 1:${String(minute).padStart(2, '0')} PM. `
        + `New M-PESA balance is Ksh${(20000 + amount).toFixed(2)}.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error(`fixture did not parse: ${raw}`);
    return t;
}

function code(n: number): string {
    return `QA${String(n).padStart(2, '0')}XK9P2L`;
}

const COMBO = 'Combo sales';
const DESSERT = 'Dessert sales';

// A day: 3 combos, 2 desserts, 1 never filed.
const DAY: ParsedTransaction[] = [
    fileInto(sale(350, 'JOHN KAMAU', 5), COMBO),
    fileInto(sale(350, 'MARY WANJIKU', 11), COMBO),
    fileInto(sale(700, 'PETER OTIENO', 19), COMBO),
    fileInto(sale(150, 'GRACE ATIENO', 24), DESSERT),
    fileInto(sale(200, 'SAM KIPROP', 31), DESSERT),
    sale(90, 'ANNE WAIRIMU', 38),
];

const ACTIVE_META: DocRenderMeta = {
    documentType: 'expense_summary',
    coveringFrom: DAY[0].date.getTime(),
    coveringTo: DAY[DAY.length - 1].date.getTime(),
    dataSource: 'sms_verified',
    merchantProfile: null,
    onBehalfOf: null,
    capturedViaActiveMode: true,
};

function money(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d)\.)/g, ',')}`;
}

describe('the bucket section', () => {
    const model = buildDocModel(DAY, ACTIVE_META, false);

    it('lists each bucket with its count and subtotal', () => {
        expect(model.buckets).toEqual([
            { label: COMBO, count: 3, value: money(1400) },
            { label: DESSERT, count: 2, value: money(350) },
            { label: 'Unsorted', count: 1, value: money(90) },
        ]);
    });

    it('puts Unsorted last, however much is in it', () => {
        // A leftovers bin is not a category, even a large one.
        const lopsided = [fileInto(sale(10, 'A B', 41), COMBO), sale(9000, 'C D', 44)];
        const buckets = buildDocModel(lopsided, ACTIVE_META, false).buckets;
        expect(buckets[buckets.length - 1].label).toBe('Unsorted');
    });

    it('sums to the hero total and to the itemisation', () => {
        const data = computeReceiptData(DAY);
        expect(model.heroAmount).toBe(money(data.grandTotal));

        const bucketTotal = model.buckets.reduce((s, b) => s + parseMoney(b.value), 0);
        expect(bucketTotal).toBe(data.totalTransactionAmount);
        expect(bucketTotal).toBe(1840);

        // And the counts account for every itemised row — the bucket section
        // summarises the itemisation, it does not replace or filter it.
        expect(model.buckets.reduce((s, b) => s + b.count, 0)).toBe(model.lines.length);
        expect(model.lines).toHaveLength(DAY.length);
    });

    it('is omitted entirely when the document has no buckets', () => {
        // Same transactions, nothing filed.
        const unfiled = DAY.map(t => ({ ...t, bucketLabel: null }));
        expect(buildDocModel(unfiled, ACTIVE_META, false).buckets).toEqual([]);
    });

    it('is omitted for every document that did not come from Active Mode', () => {
        const chatMeta: DocRenderMeta = { ...ACTIVE_META, capturedViaActiveMode: false };
        expect(buildDocModel(DAY, chatMeta, false).buckets).toEqual([]);
        // Including one where the flag was never set at all — every document
        // that predates Active Mode renders exactly as it did before.
        const legacyMeta: DocRenderMeta = { ...ACTIVE_META };
        delete legacyMeta.capturedViaActiveMode;
        expect(buildDocModel(DAY, legacyMeta, false).buckets).toEqual([]);
    });
});

describe('the assumed-direction marker', () => {
    // A sale whose direction nothing in the message could settle.
    const assumed = applyActiveModeDirection(
        captureFromPaste(
            'TGH7YU2XQ1 Confirmed. Ksh1,200.00 approved on 11/9/26 at 1:15 PM. '
            + 'New M-PESA balance is Ksh9,000.00.',
        ).transaction!,
    );

    it('marks the row in plain words, in the same trailing line as the other tags', () => {
        const model = buildDocModel([fileInto(assumed, COMBO)], ACTIVE_META, false);
        expect(model.lines[0].flagNote).toBe('money in assumed');
    });

    it('leaves every ordinary row unmarked', () => {
        const model = buildDocModel(DAY, ACTIVE_META, false);
        expect(model.lines.every(l => l.flagNote === null)).toBe(true);
    });

    it('reaches the HTML, joined into the existing metadata line', () => {
        const model = buildDocModel([fileInto(assumed, COMBO)], ACTIVE_META, false);
        const html = renderDocHTML(model, 'data:image/png;base64,');
        expect(html).toContain('money in assumed');
        // No new visual language: it rides in the same muted sub line as Ref
        // and the data-source tag.
        expect(html).toMatch(/<div class="sub">[^<]*money in assumed/);
    });
});

describe('the same numbers on every surface', () => {
    const model = buildDocModel(DAY, ACTIVE_META, false);

    it('shows each bucket figure in the HTML', () => {
        const html = renderDocHTML(model, 'data:image/png;base64,');
        expect(html).toContain('Buckets');
        for (const b of model.buckets) {
            expect(html).toContain(b.label);
            expect(html).toContain(b.value);
            expect(html).toContain(`${b.count} ${b.count === 1 ? 'item' : 'items'}`);
        }
    });

    it('draws each bucket figure in the PDF, with the same strings', () => {
        const drawn = measureDrawnStrings(model).map(d => d.text);
        expect(drawn).toContain('BUCKETS');
        for (const b of model.buckets) {
            expect(drawn).toContain(b.label);
            expect(drawn).toContain(b.value);
            expect(drawn).toContain(`${b.count} ${b.count === 1 ? 'item' : 'items'}`);
        }
    });

    it('draws the hero total the interactive view computes', () => {
        const drawn = measureDrawnStrings(model).map(d => d.text);
        expect(model.heroAmount).not.toBeNull();
        expect(drawn).toContain(model.heroAmount!);
        expect(renderDocHTML(model, '')).toContain(model.heroAmount!);
    });

    it('still itemises every sale individually in both', () => {
        const html = renderDocHTML(model, '');
        const drawn = measureDrawnStrings(model).map(d => d.text);
        for (const line of model.lines) {
            expect(html).toContain(line.amount);
            expect(drawn).toContain(line.amount);
        }
    });

    it('lays the bucket section out without colliding with anything', () => {
        // The document already has a standing overlap test; this is the same
        // check applied to the one section that document did not have before.
        const drawn = measureDrawnStrings(model).filter(s => s.text.trim() !== '');
        for (let i = 0; i < drawn.length; i++) {
            for (let j = i + 1; j < drawn.length; j++) {
                const a = drawn[i];
                const b = drawn[j];
                const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                const h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                expect(v > 0.35 && h > 0.2, `"${a.text}" overlaps "${b.text}"`).toBe(false);
            }
        }
    });
});

describe('the live screen and the finished document agree', () => {
    // The chip row tallies as the vendor works; the document totals again at
    // the end. Two code paths, one set of figures — so they are checked
    // against each other rather than each against itself.
    const state = readActiveModeState({ buckets: [COMBO, DESSERT] });

    it('matches bucket for bucket, count and subtotal', () => {
        const live = bucketTallies(state, DAY).filter(t => t.count > 0);
        const document = buildDocModel(DAY, ACTIVE_META, false).buckets;

        const asPairs = (rows: { name?: string; label?: string; count: number }[]) =>
            rows.map(r => [r.name ?? r.label, r.count]);
        // Same buckets and counts, ignoring the ordering each surface chose
        // (the chip row keeps creation order; the document sorts by takings).
        expect(asPairs(live).sort()).toEqual(asPairs(document).sort());

        for (const row of document) {
            const chip = live.find(l => l.name === row.label);
            expect(chip, `no live chip for ${row.label}`).toBeDefined();
            expect(money(chip!.total)).toBe(row.value);
        }
    });

    it('matches on the running day total', () => {
        expect(money(dayTotal(DAY))).toBe(buildDocModel(DAY, ACTIVE_META, false).heroAmount);
    });
});

function parseMoney(s: string): number {
    return Number(s.replace(/[^\d.]/g, ''));
}
