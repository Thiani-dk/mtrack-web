import type { MeasureText } from './primitives';
import { DAY_CARD_FONT_FAMILY } from './fonts';

// A canvas 2D context's own text metrics — a fast, accurate stand-in for real
// rendered width once the embedded fonts are loaded (fonts.ts), and the same
// oracle both backends use to decide sizing, so a canvas export and the
// in-app DOM preview never disagree about where a line wraps or a figure
// shrinks. Call loadDayCardFonts() first; measuring before the fonts are
// ready would silently fall back to the browser's default font metrics.
export function createCanvasMeasurer(): MeasureText {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('day card: no 2D canvas context available for text measurement');
    return (text, font, size, weight) => {
        ctx.font = `${weight} ${size}px '${DAY_CARD_FONT_FAMILY[font]}'`;
        return ctx.measureText(text).width;
    };
}
