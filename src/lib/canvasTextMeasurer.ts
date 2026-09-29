import type { FontFamily, MeasureText } from './documentPrimitives';

// A canvas 2D context's own text metrics — a fast, accurate stand-in for real
// rendered width once a document's fonts are loaded, and the same oracle both
// backends (canvas export, in-app DOM preview) use to decide sizing, so the
// two never disagree about where a line wraps or a figure shrinks. Call the
// relevant fonts.ts's load function first — measuring before the fonts are
// ready would silently fall back to the browser's default font metrics.
export function createCanvasMeasurer(fontFamily: Record<FontFamily, string>): MeasureText {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas context available for text measurement');
    return (text, font, size, weight) => {
        ctx.font = `${weight} ${size}px '${fontFamily[font]}'`;
        return ctx.measureText(text).width;
    };
}
