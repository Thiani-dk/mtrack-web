import { describe, expect, it } from 'vitest';
import { DAY_CARD_PALETTES } from './theme';

// WCAG relative luminance / contrast ratio, computed directly here rather
// than as shipped app code — this is test-only tooling to keep the two
// palettes honest, not something either rendering backend needs at runtime.
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

describe('day card palettes meet the design\'s contrast floor', () => {
    for (const [name, palette] of Object.entries(DAY_CARD_PALETTES)) {
        it(`${name}: ink text is at least 4.5:1 against the background`, () => {
            expect(contrastRatio(palette.ink, palette.background)).toBeGreaterThanOrEqual(4.5);
        });
        it(`${name}: muted text is at least 4.5:1 against the background`, () => {
            expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
        });
        it(`${name}: ink text is at least 4.5:1 against the tile background`, () => {
            expect(contrastRatio(palette.ink, palette.tileBackground)).toBeGreaterThanOrEqual(4.5);
        });
        it(`${name}: the bar fill is at least 3:1 against its track`, () => {
            expect(contrastRatio(palette.fill, palette.track)).toBeGreaterThanOrEqual(3);
        });
    }
});
