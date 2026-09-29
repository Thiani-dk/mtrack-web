import { describe, expect, it } from 'vitest';
import { RECEIPT_PALETTE } from './theme';

// Same WCAG contrast check as the day card's own theme.test.ts — test-only
// tooling, not shipped code.
function srgbToLinear(c: number): number {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const r = srgbToLinear((n >> 16) & 0xff);
    const g = srgbToLinear((n >> 8) & 0xff);
    const b = srgbToLinear(n & 0xff);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
    const l1 = luminance(a);
    const l2 = luminance(b);
    const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
}

describe('the receipt palette meets the contrast floor', () => {
    it('ink text is at least 4.5:1 against the paper', () => {
        expect(contrastRatio(RECEIPT_PALETTE.ink, RECEIPT_PALETTE.paper)).toBeGreaterThanOrEqual(4.5);
    });
    it('muted text is at least 4.5:1 against the paper', () => {
        expect(contrastRatio(RECEIPT_PALETTE.muted, RECEIPT_PALETTE.paper)).toBeGreaterThanOrEqual(4.5);
    });
    it('the paper reads as visibly distinct from the page behind it (so a torn edge is visible at all)', () => {
        expect(contrastRatio(RECEIPT_PALETTE.paper, RECEIPT_PALETTE.page)).toBeGreaterThanOrEqual(1.08);
    });
});
