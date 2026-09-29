import { jsPDF } from 'jspdf';
import type { FontFamily, LayoutResult, Primitive } from './documentPrimitives';

// Shared PDF drawing loop for every positioned-primitives layout — walks the
// same list the canvas and DOM backends draw, converting design pixels to mm
// with one caller-supplied scale (each document type's own "this many real
// millimetres per design pixel", since the day card and the receipt are
// exported at different physical intents). No layout decisions here, same as
// primitiveCanvasRenderer.ts and PrimitivesView.tsx.
//
// Font registration (addFileToVFS/addFont) needs a live jsPDF instance to
// attach to, so callers create the document with createPdfDocument (which
// also paints the page background) THEN register their own embedded fonts on
// it, THEN call drawPrimitivesOnPdf — see receipt/renderPdf.ts.

export interface PdfFontNames {
    // jsPDF font family name registered for this FontFamily at each weight
    // bucket. `bold` may be omitted if only one weight was embedded, in which
    // case `normal` is reused (jsPDF's own synthetic bold is never reached).
    normal: string;
    bold?: string;
}

function hexToRgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function createPdfDocument(layout: LayoutResult, pxToMm: number): jsPDF {
    const pageW = layout.width * pxToMm;
    const pageH = layout.height * pxToMm;
    const doc = new jsPDF({ unit: 'mm', format: [pageW, pageH] });
    const [r, g, b] = hexToRgb(layout.background);
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, pageW, pageH, 'F');
    return doc;
}

export function drawPrimitivesOnPdf(
    doc: jsPDF, layout: LayoutResult, pxToMm: number, fonts: Record<FontFamily, PdfFontNames>,
): void {
    for (const p of layout.primitives) drawOne(doc, p, pxToMm, fonts);
}

function drawOne(doc: jsPDF, p: Primitive, s: number, fonts: Record<FontFamily, PdfFontNames>): void {
    if (p.kind === 'rect') {
        const [r, g, b] = hexToRgb(p.color);
        doc.setFillColor(r, g, b);
        if (p.radius && p.radius > 0) {
            doc.roundedRect(p.x * s, p.y * s, p.width * s, p.height * s, p.radius * s, p.radius * s, 'F');
        } else {
            doc.rect(p.x * s, p.y * s, p.width * s, p.height * s, 'F');
        }
        return;
    }
    if (p.kind === 'zigzag') {
        const [r, g, b] = hexToRgb(p.color);
        doc.setFillColor(r, g, b);
        const pts = p.points;
        const deltas: [number, number][] = [];
        for (let i = 2; i < pts.length; i += 2) {
            deltas.push([(pts[i] - pts[i - 2]) * s, (pts[i + 1] - pts[i - 1]) * s]);
        }
        doc.lines(deltas, pts[0] * s, pts[1] * s, [1, 1], 'F', true);
        return;
    }
    if (p.kind === 'image') {
        doc.addImage(p.dataUrl, 'PNG', p.x * s, p.y * s, p.width * s, p.height * s);
        return;
    }
    const names = fonts[p.font];
    const family = p.weight >= 600 && names.bold ? names.bold : names.normal;
    doc.setFont(family, 'normal');
    // jsPDF's own font size is always in points regardless of document unit —
    // px -> mm (via the caller's scale) -> pt (1mm = 2.8346pt).
    doc.setFontSize(p.size * s * 2.8346);
    const [r, g, b] = hexToRgb(p.color);
    doc.setTextColor(r, g, b);
    const jsPdfAlign = p.align === 'left' ? 'left' : p.align === 'right' ? 'right' : 'center';
    // jsPDF's y is a baseline, not a top — nudge down by the font's
    // approximate ascent so this matches every other backend's "y is the top
    // of the line box" convention.
    const baselineY = (p.y + p.size * 0.8) * s;
    doc.setCharSpace(p.letterSpacing ? p.size * p.letterSpacing * s : 0);
    doc.text(p.text, p.x * s, baselineY, { align: jsPdfAlign });
}
