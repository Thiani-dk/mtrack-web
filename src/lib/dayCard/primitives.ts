// The shared primitive vocabulary every document-shaped export in this pass
// (the day card, the sales receipt) is built from: text runs and rectangles,
// each carrying its own absolute position. One layout function produces a
// list of these; every backend that draws them — canvas PNG, in-app DOM — is
// a thin, dumb loop over the same list, so the two can never disagree on a
// number or a position. See dayCardLayout.ts and receiptLayout.ts.

export type FontFamily = 'serif' | 'sans';

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

export type Primitive = TextRun | Rect;

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
export const estimateTextWidth: MeasureText = (text, _font, size, weight) => {
    // Source Serif 4 and Geist are both moderately narrow text faces; ~0.52em
    // average advance width is a reasonable stand-in for either at normal
    // weight, nudged up slightly for bold.
    const perChar = size * (weight >= 600 ? 0.56 : 0.52);
    return text.length * perChar;
};
