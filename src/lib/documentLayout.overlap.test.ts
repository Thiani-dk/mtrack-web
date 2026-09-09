import { describe, expect, it } from 'vitest';
import {
    measureDrawnStrings, renderDocHTML,
    type DocLine, type DocModel, type DrawnString,
    PDF_MARGIN_MM, PDF_PAGE_WIDTH_MM,
} from './documentLayout';

// Standing regression test for the exported document's text layout.
//
// Three separate overflow/overlap bugs have shipped from this file — the
// disclaimer clipping off the page, the reason not wrapping after the em-dash,
// and a long recipient name being drawn as if it were one line while the Ref /
// fee line, the category and the next row were positioned beneath it at a
// single-line offset. All three share one cause: jsPDF does not wrap and
// text() advances nothing, so every Y offset is the layout's own arithmetic and
// "it looked fine" is not a check.
//
// So the assertions here work on geometry, not on strings: measureDrawnStrings
// reports the measured box of every string the PDF layout actually draws, and
// these tests fail if any two of them overlap on both axes, or if any of them
// crosses the page margin. The fixtures are real recipient names from the
// production output that exposed the wrapping bug — keep them exactly as they
// are, they are the confirmed failure case.

const NAME_COOP = 'CO-OPERATIVE BANK COLLECTION ACCOUNT';
const NAME_MUJENGO = 'MUJENGO MATERIALS AND HARDWARE';
const LONG_REASON = 'Materials purchased for the Kiambu site foundation works, second delivery';

// Glyph boxes are nominal ascent/descent rather than real ink extents, so two
// correctly stacked lines can graze each other by a fraction of a millimetre.
// Anything beyond these is a genuine collision.
const V_TOL_MM = 0.35;
const H_TOL_MM = 0.2;
// A drawn string may reach the margin, never past it.
const RIGHT_EDGE_MM = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM + 0.5;

const ROW_TITLE_PT = 9.5;
// Left edge of the right-aligned Amount column. The amount is set at the same
// size as the description, so "which strings belong to the description column"
// is a question about x, not about type size.
const AMOUNT_COL_LEFT_MM = 70;

function line(over: Partial<DocLine> = {}): DocLine {
    return {
        date: '12 Aug 2026',
        description: 'NAIVAS',
        reason: null,
        detail: '',
        amount: 'KES 1,200.00',
        items: [],
        sourceTag: null,
        ...over,
    };
}

function model(lines: DocLine[], over: Partial<DocModel> = {}): DocModel {
    return {
        wordmark: 'M-Track',
        title: 'EXPENSE SUMMARY',
        reference: 'MT-2026-0812-AB12',
        sourceStatement: 'Source: all entries from payment messages.',
        metaFields: [{ label: 'Covering', value: '1 – 31 Aug 2026' }],
        totalLabel: 'TOTAL SPENT',
        heroAmount: 'KES 84,300.00',
        heroSubtitle: null,
        heroMeta: `${lines.length} items  ·  1 – 31 Aug 2026`,
        sectionLabel: 'EXPENSES',
        lines,
        totals: [
            { label: `Subtotal, ${lines.length} item${lines.length === 1 ? '' : 's'}`, value: 'KES 84,000.00' },
            { label: 'Transaction fees', value: 'KES 300.00' },
            { label: 'TOTAL SPENT', value: 'KES 84,300.00', strong: true },
        ],
        disclaimer: 'Prepared from payment records held on this device. Figures are as recorded '
            + 'and have not been independently audited. Issued 12 Aug 2026.',
        isDemo: false,
        ...over,
    };
}

function draw(m: DocModel): DrawnString[] {
    return measureDrawnStrings(m).filter(s => s.text.trim() !== '');
}

// Every pair of drawn strings that shares area on both axes, described well
// enough to debug from the failure message alone.
function collisions(drawn: DrawnString[]): string[] {
    const hits: string[] = [];
    for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
            const a = drawn[i];
            const b = drawn[j];
            const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            const h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            if (v > V_TOL_MM && h > H_TOL_MM) {
                hits.push(
                    `"${a.text}" (y=${a.y.toFixed(2)}, x ${a.left.toFixed(1)}–${a.right.toFixed(1)}) `
                    + `overlaps "${b.text}" (y=${b.y.toFixed(2)}, x ${b.left.toFixed(1)}–${b.right.toFixed(1)}) `
                    + `by ${v.toFixed(2)}mm × ${h.toFixed(2)}mm`,
                );
            }
        }
    }
    return hits;
}

function overflows(drawn: DrawnString[]): string[] {
    return drawn
        .filter(s => s.right > RIGHT_EDGE_MM || s.left < PDF_MARGIN_MM - 0.5)
        .map(s => `"${s.text}" spans ${s.left.toFixed(1)}–${s.right.toFixed(1)}mm`);
}

// A wrapped string is drawn in pieces, so match against the drawn text joined
// back together — this catches silent truncation, not wrapping. Runs of space
// collapse on both sides, since a wrap point may fall inside one.
function drawnText(drawn: DrawnString[]): string {
    return drawn.map(s => s.text).join(' ').replace(/\s+/g, ' ');
}

function expectDrawn(drawn: DrawnString[], wanted: string): void {
    expect(drawnText(drawn)).toContain(wanted.replace(/\s+/g, ' '));
}

function expectClean(m: DocModel): DrawnString[] {
    const drawn = draw(m);
    expect(collisions(drawn), 'overlapping text').toEqual([]);
    expect(overflows(drawn), 'text outside the page margins').toEqual([]);
    return drawn;
}

// The strings drawn in the description column, in draw order.
function descColumn(drawn: DrawnString[]): DrawnString[] {
    return drawn.filter(s => s.sizePt === ROW_TITLE_PT && s.left < AMOUNT_COL_LEFT_MM);
}

// How many separate lines the row's description occupied.
function rowBaselines(drawn: DrawnString[]): number {
    return new Set(descColumn(drawn).map(s => s.y.toFixed(2))).size;
}

describe('exported PDF line items', () => {
    it('does not collide when a long recipient name wraps, with an amount and a Ref/fee line', () => {
        // Production fixture. Before the wrapping fix this name ran straight
        // through the amount column on the same baseline.
        const drawn = expectClean(model([line({
            description: NAME_COOP,
            detail: 'Ref TGH7YU2XQ1  ·  Fee KES 33.00',
            amount: 'KES 12,500.00',
        })]));

        expectDrawn(drawn, NAME_COOP);
        expectDrawn(drawn, 'Ref TGH7YU2XQ1  ·  Fee KES 33.00');
        expect(rowBaselines(drawn), 'the name should wrap onto more than one line').toBeGreaterThan(1);
    });

    it('does not collide when a long recipient name wraps above a category label', () => {
        // Production fixture: the "Retail" category sits beneath the name.
        const drawn = expectClean(model([line({
            description: NAME_MUJENGO,
            reason: 'Retail',
            amount: 'KES 4,850.00',
        })]));

        expectDrawn(drawn, NAME_MUJENGO);
        expectDrawn(drawn, 'Retail');
        expect(rowBaselines(drawn), 'the name should wrap onto more than one line').toBeGreaterThan(1);
    });

    it('stacks a long name and a long reason on the same item instead of overdrawing them', () => {
        const drawn = expectClean(model([line({
            description: NAME_COOP,
            reason: LONG_REASON,
            detail: 'Ref QWE12RTY90  ·  Fee KES 55.00',
            amount: 'KES 31,000.00',
        })]));

        expectDrawn(drawn, NAME_COOP);
        expectDrawn(drawn, LONG_REASON);
        expect(rowBaselines(drawn), 'name and reason should occupy several stacked lines').toBeGreaterThanOrEqual(3);
    });

    it('leaves a short name on one line with the reason inline after the em-dash', () => {
        const drawn = expectClean(model([line({
            description: 'NAIVAS',
            reason: 'Retail',
            amount: 'KES 900.00',
        })]));

        const row = descColumn(drawn);
        expect(row.map(s => s.text)).toEqual(['NAIVAS', ' — Retail']);
        expect(row[0].y).toBe(row[1].y);
    });

    it('never truncates a reason, however long', () => {
        const drawn = expectClean(model([line({ description: 'JOHN K', reason: LONG_REASON })]));
        expectDrawn(drawn, LONG_REASON);
    });

    it('keeps the disclaimer inside the page', () => {
        // The first of the three bugs: a long disclaimer clipped off the page.
        const drawn = expectClean(model([line()], {
            disclaimer: 'This summary was prepared from payment messages held on this device and '
                + 'from entries recorded by hand. It is a record of what was received, not an '
                + 'independent audit, and no figure on it has been verified against a bank '
                + 'statement. Issued 12 Aug 2026.',
        }));
        expectDrawn(drawn, 'Issued 12 Aug 2026.');
    });
});

describe('a full multi-item document', () => {
    // A document of the size that exposed the bug, mixing wrapping and
    // non-wrapping names, present and absent categories, fees and source tags.
    const names = [
        NAME_COOP, NAME_MUJENGO, 'NAIVAS SUPERMARKET LIMITED', 'JOHN K', 'KPLC PREPAID',
        'SAFARICOM DATA BUNDLE', 'EQUITY BANK PAYBILL COLLECTION ACCOUNT',
        'MAMA NJERI VEGETABLES AND FRESH PRODUCE', 'UBER KENYA', 'QUICKMART',
    ];
    const reasons = [null, 'Retail', 'Transport & Travel', 'Cost of Sales', null, LONG_REASON, 'Utilities'];
    const lines = Array.from({ length: 50 }, (_, i) => line({
        date: `${(i % 28) + 1} Aug 2026`,
        description: names[i % names.length],
        reason: reasons[i % reasons.length],
        detail: i % 3 === 0 ? `Ref AB${1000 + i}CD  ·  Fee KES ${(i % 9) + 12}.00` : `Ref AB${1000 + i}CD`,
        amount: `KES ${(1000 + i * 137).toLocaleString()}.00`,
        sourceTag: i % 7 === 0 ? 'entered by hand' : null,
    }));
    const doc = model(lines);

    it('draws 50 items with no collision and nothing outside the margins', () => {
        const drawn = expectClean(doc);
        for (const name of names) expectDrawn(drawn, name);
    });

    it('renders the HTML in normal document flow, so wrapped text pushes content down', () => {
        // The browser version must not reintroduce the same class of bug by
        // positioning rows out of flow.
        const html = renderDocHTML(doc, 'data:image/png;base64,');

        expect(html, 'no out-of-flow positioning').not.toMatch(/position\s*:\s*(absolute|fixed)/);
        expect(html, 'rows are flex, top-aligned').toMatch(/\.row\{display:flex;[^}]*align-items:flex-start/);
        expect(html, 'the description column stacks block-level').toMatch(/\.rowMain\{flex:1\}/);
        expect(html, 'no fixed heights to overflow').not.toMatch(/\.(row|rowMain|descLine|desc|sub)\{[^}]*[;{]height:/);
        expect(html, 'long names may wrap').toContain('overflow-wrap:break-word');
        for (const name of [NAME_COOP, NAME_MUJENGO]) expect(html).toContain(name);
    });
});
