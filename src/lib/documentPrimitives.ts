// The shared primitive vocabulary every document-shaped export in this pass
// (the day card, the sales receipt) is built from: text runs and rectangles,
// each carrying its own absolute position. One layout function produces a
// list of these; every backend that draws them — canvas PNG, in-app DOM — is
// a thin, dumb loop over the same list, so the two can never disagree on a
// number or a position. See dayCard/layout.ts and receipt/layout.ts.

export type FontFamily = 'serif' | 'sans' | 'mono';

export interface TextRun {
    kind: 'text';
    // Top-left corner. Every backend treats `y` as the top of the text's own
    // line box (canvas: textBaseline = 'top'; DOM: line-height = 1, no extra
    // leading) so the two never disagree about where a line actually sits.
    x: number;
    y: number;
    text: string;
    font: FontFamily;
    size: number;
    weight: 400 | 500 | 600 | 700;
    color: string;
    align: 'left' | 'center' | 'right';
    // Present only on tracked-caps micro-labels, in em (matches the CSS
    // letter-spacing convention already used across the app's other layouts).
    letterSpacing?: number;
    // The box this run was fitted into, when the layout shrank it to fit —
    // geometry tests use this to confirm a value never overflows its box
    // regardless of how long the underlying figure turned out to be.
    fitWidth?: number;
}

export interface Rect {
    kind: 'rect';
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    radius?: number;
}

// A torn-paper edge — the receipt's own signature, nothing else uses it. The
// layout computes the actual tooth points once, so both backends fill/clip
// the exact same polygon rather than each inventing their own zigzag and
// risking the two looking subtly different.
export interface ZigzagEdge {
    kind: 'zigzag';
    x: number;
    y: number;
    width: number;
    height: number;
    // Flat [x0,y0, x1,y1, ...] polygon points, absolute coordinates within
    // the card, already closed (a canvas fill or a CSS clip-path both close
    // the path themselves, so the last point need not repeat the first).
    points: number[];
    color: string;
}

// A raster image at a fixed position — the receipt's QR code. Content is
// always a data: URL (already generated, offline, before the layout runs;
// see primitives.ts's own note on injected measurement for why this mirrors
// that same "compute it first, hand the layout a finished value" pattern).
export interface ImagePrimitive {
    kind: 'image';
    x: number;
    y: number;
    width: number;
    height: number;
    dataUrl: string;
}

export type Primitive = TextRun | Rect | ZigzagEdge | ImagePrimitive;

// Builds a torn-edge band: a polygon whose OUTER boundary (facing away from
// the paper body) zigzags between two depths, and whose INNER boundary
// (facing the paper) is flat, so it sits flush against an ordinary Rect for
// the rest of the paper with no seam. `edge: 'top'` zigzags upward (paper
// starts below `yInner`, tears reach up to `yInner - toothHeight`); `'bottom'`
// mirrors it downward. Whole-tooth widths only, so the last tooth never gets
// clipped — width should be a multiple of toothWidth for a clean result, and
// the layout picks one that is.
export function buildTornEdge(
    x: number, yInner: number, width: number, toothWidth: number, toothHeight: number,
    edge: 'top' | 'bottom', color: string,
): ZigzagEdge {
    const teeth = Math.max(1, Math.round(width / toothWidth));
    const tw = width / teeth;
    const yOuterPeak = edge === 'top' ? yInner - toothHeight : yInner + toothHeight;
    const points: number[] = [x, yInner];
    for (let i = 0; i < teeth; i++) {
        const peakX = x + i * tw + tw / 2;
        const valleyX = x + (i + 1) * tw;
        points.push(peakX, yOuterPeak, valleyX, yInner);
    }
    const top = Math.min(yInner, yOuterPeak);
    const bottom = Math.max(yInner, yOuterPeak);
    return {
        kind: 'zigzag', x, y: top, width, height: bottom - top,
        points, color,
    };
}

export interface LayoutResult {
    width: number;
    height: number;
    background: string;
    primitives: Primitive[];
}

// ── Text measurement, injected rather than hard-coded ───────────────────────
//
// The layout has to know how wide a string will render before it can decide
// whether to shrink it, wrap it, or leave it be — and real text metrics only
// exist where a font is actually loaded and a rendering context (a canvas, a
// live DOM) is available. Both backends run in a browser and can supply a
// real one (see canvasMeasurer.ts); the unit tests supply a simple
// deterministic estimate instead, so the LAYOUT's own rules — shrink-to-fit
// thresholds, wrapping, bounds — are fully testable in Node with no canvas at
// all. Neither backend re-derives sizing on its own: whatever the layout
// decided, using whichever measurer it was given, is what gets drawn.
export type MeasureText = (text: string, font: FontFamily, size: number, weight: number) => number;

// A plain, deterministic approximation for tests and for any caller that has
// no live rendering context. Not used by the shipping app once a real
// measurer is available, but kept exported because it is also what makes the
// geometry tests reproducible across machines and CI, where the two
// typefaces embedded in the app cannot be assumed to render identically to
// the pixel.
export const estimateTextWidth: MeasureText = (text, font, size, weight) => {
    if (font === 'mono') {
        // Not an approximation — IBM Plex Mono's own hmtx table gives every
        // glyph in this subset an identical 0.6em advance width (checked
        // directly against the embedded font), so this is exact, not a
        // stand-in for a live measurer the way the other two faces are.
        return text.length * size * 0.6;
    }
    // Source Serif 4 and Geist are both moderately narrow text faces; ~0.52em
    // average advance width is a reasonable stand-in for either at normal
    // weight, nudged up slightly for bold.
    const perChar = size * (weight >= 600 ? 0.56 : 0.52);
    return text.length * perChar;
};
