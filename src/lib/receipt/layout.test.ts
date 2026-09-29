import { describe, expect, it } from 'vitest';
import { buildReceiptPrimitives, RECEIPT_WIDTH } from './layout';
import type { ReceiptData } from './model';
import { estimateTextWidth } from '../documentPrimitives';
import type { TextRun, Primitive } from '../documentPrimitives';

// Geometry, structural and determinism tests for the receipt's
// positioned-primitives layout — the receipt's equivalent of dayCard's own
// layout.test.ts. Uses the deterministic estimator, not a real font, so these
// prove the LAYOUT's own rules regardless of which real typeface is loaded.

const FAKE_QR = 'data:image/png;base64,AAAA';

function base(overrides: Partial<ReceiptData> = {}): ReceiptData {
    return {
        businessName: 'Mama Chapo',
        contact: '0712345678',
        servedBy: null,
        receiptNumber: 'MT260929-ABCDE',
        dateLabel: '29 Sep 2026',
        timeLabel: '1:05 PM',
        lines: [
            { description: 'Chapati', detail: '2 x Ksh 20.00', amountLabel: 'Ksh 40.00' },
            { description: 'Soda', detail: null, amountLabel: 'Ksh 60.00' },
        ],
        subtotal: 100,
        subtotalLabel: 'Ksh 100.00',
        reconciliation: { kind: 'match' },
        totalLabel: 'Ksh 100.00',
        total: 100,
        amountWords: 'ONE HUNDRED SHILLINGS ONLY',
        currency: 'KES',
        provenanceLine: 'Verified from an M-Pesa payment message.',
        footerLine: 'Thank you  ·  Made with M-Track',
        qrFacts: 'MTRACK-RECEIPT-V1|MT260929-ABCDE|Mama Chapo|100.00|KES|29 Sep 2026',
        ...overrides,
    };
}

function isTextRun(p: Primitive): p is TextRun {
    return p.kind === 'text';
}
function textBox(t: TextRun): { left: number; right: number; top: number; bottom: number } {
    const w = estimateTextWidth(t.text, t.font, t.size, t.weight);
    const left = t.align === 'left' ? t.x : t.align === 'center' ? t.x - w / 2 : t.x - w;
    return { left, right: left + w, top: t.y, bottom: t.y + t.size * 1.25 };
}
function rectsOverlap(a: { left: number; right: number; top: number; bottom: number }, b: typeof a): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('receipt layout: geometry', () => {
    const result = buildReceiptPrimitives(base(), { measure: estimateTextWidth, qrDataUrl: FAKE_QR });

    it('produces a receipt at the design width, with a positive height', () => {
        expect(result.width).toBe(RECEIPT_WIDTH);
        expect(result.height).toBeGreaterThan(0);
    });

    it('keeps every primitive within the card bounds', () => {
        for (const p of result.primitives) {
            if (p.kind === 'rect' || p.kind === 'image') {
                expect(p.x).toBeGreaterThanOrEqual(-0.5);
                expect(p.x + p.width).toBeLessThanOrEqual(result.width + 0.5);
            } else if (isTextRun(p)) {
                const box = textBox(p);
                expect(box.left).toBeGreaterThanOrEqual(-1);
                expect(box.right).toBeLessThanOrEqual(result.width + 1);
                expect(box.top).toBeGreaterThanOrEqual(0);
                expect(box.bottom).toBeLessThanOrEqual(result.height + 1);
            }
        }
    });

    it('never overlaps a line item\'s description with its own amount', () => {
        const texts = result.primitives.filter(isTextRun);
        const chapati = texts.find(t => t.text === 'Chapati')!;
        const amount = texts.find(t => t.text === 'Ksh 40.00')!;
        expect(rectsOverlap(textBox(chapati), textBox(amount))).toBe(false);
    });

    it('includes exactly one QR image, sized to fit within the content width', () => {
        const images = result.primitives.filter(p => p.kind === 'image');
        expect(images).toHaveLength(1);
        expect(images[0].dataUrl).toBe(FAKE_QR);
        expect(images[0].width).toBeLessThanOrEqual(RECEIPT_WIDTH - 64);
    });

    it('has a torn edge at both the top and the bottom', () => {
        const zigzags = result.primitives.filter(p => p.kind === 'zigzag');
        expect(zigzags).toHaveLength(2);
    });
});

describe('receipt layout: reconciliation lines only appear when there is something to explain', () => {
    it('shows no Subtotal/Tip/Discount lines when the reconciliation matches exactly', () => {
        const result = buildReceiptPrimitives(base({ reconciliation: { kind: 'match' } }), { measure: estimateTextWidth, qrDataUrl: FAKE_QR });
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts).not.toContain('Subtotal');
        expect(texts).not.toContain('Tip');
        expect(texts).not.toContain('Discount');
    });

    it('shows Subtotal and Tip when the gap is a tip', () => {
        const result = buildReceiptPrimitives(
            base({ reconciliation: { kind: 'tip', amountLabel: 'Ksh 50.00' }, subtotal: 300, subtotalLabel: 'Ksh 300.00' }),
            { measure: estimateTextWidth, qrDataUrl: FAKE_QR },
        );
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts).toContain('Subtotal');
        expect(texts).toContain('Tip');
        expect(texts).toContain('Ksh 50.00');
    });

    it('shows a discount as a negative line, not a plain positive figure', () => {
        const result = buildReceiptPrimitives(
            base({ reconciliation: { kind: 'discount', amountLabel: 'Ksh 50.00' } }),
            { measure: estimateTextWidth, qrDataUrl: FAKE_QR },
        );
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts).toContain('-Ksh 50.00');
    });

    it('labels an unexplained gap plainly, never hiding it', () => {
        const result = buildReceiptPrimitives(
            base({ reconciliation: { kind: 'unexplained', amountLabel: 'Ksh 50.00', amount: -50 } }),
            { measure: estimateTextWidth, qrDataUrl: FAKE_QR },
        );
        const texts = result.primitives.filter(isTextRun).map(t => t.text);
        expect(texts).toContain('Unexplained difference');
    });
});

describe('receipt layout: servedBy', () => {
    it('is drawn when present', () => {
        const result = buildReceiptPrimitives(base({ servedBy: 'Amina' }), { measure: estimateTextWidth, qrDataUrl: FAKE_QR });
        expect(result.primitives.filter(isTextRun).some(t => t.text === 'Served by Amina')).toBe(true);
    });
    it('is omitted entirely when absent, not printed as a blank line', () => {
        const result = buildReceiptPrimitives(base({ servedBy: null }), { measure: estimateTextWidth, qrDataUrl: FAKE_QR });
        expect(result.primitives.filter(isTextRun).some(t => t.text.startsWith('Served by'))).toBe(false);
    });
});

describe('receipt layout: never truncates the printed total or amount-in-words', () => {
    it('shrinks a very large total rather than clipping it', () => {
        const result = buildReceiptPrimitives(
            base({ totalLabel: 'Ksh 123,456,789.00', amountWords: 'ONE HUNDRED AND TWENTY-THREE MILLION FOUR HUNDRED AND FIFTY-SIX THOUSAND SEVEN HUNDRED AND EIGHTY-NINE SHILLINGS ONLY' }),
            { measure: estimateTextWidth, qrDataUrl: FAKE_QR },
        );
        const texts = result.primitives.filter(isTextRun);
        const totalRun = texts.find(t => t.text === 'Ksh 123,456,789.00');
        expect(totalRun).toBeTruthy();
        expect(estimateTextWidth(totalRun!.text, totalRun!.font, totalRun!.size, totalRun!.weight))
            .toBeLessThanOrEqual(totalRun!.fitWidth! + 0.5);
    });
});

describe('receipt layout: determinism', () => {
    it('produces identical primitives for the same input every time', () => {
        const data = base();
        const a = buildReceiptPrimitives(data, { measure: estimateTextWidth, qrDataUrl: FAKE_QR });
        const b = buildReceiptPrimitives(data, { measure: estimateTextWidth, qrDataUrl: FAKE_QR });
        expect(a).toEqual(b);
    });
});
