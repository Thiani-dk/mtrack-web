import type { jsPDF } from 'jspdf';
import { buildReceiptPrimitives, RECEIPT_WIDTH } from './layout';
import type { ReceiptData } from './model';
import { createPdfDocument, drawPrimitivesOnPdf, type PdfFontNames } from '../primitiveToPdf';
import { estimateTextWidth } from '../documentPrimitives';
import type { FontFamily } from '../documentPrimitives';
import { buildReceiptQrDataUrl } from './qr';

// The receipt's own PDF backend: draws the same primitives the canvas/DOM
// backends draw (see documentPrimitives.ts's "one layout, many backends"),
// using estimateTextWidth rather than a live canvas measurer — jsPDF runs
// with no DOM at all, and estimateTextWidth is exact for this monospace font
// (see its own comment), so the layout it decides on already matches what
// jsPDF will actually typeset with the same embedded font.
//
// 80mm at 203dpi (RECEIPT_WIDTH's own real-world meaning) maps 1:1 to a real
// 80mm-wide thermal roll — this PDF prints at true receipt size.
const PX_TO_MM = 80 / RECEIPT_WIDTH;

const FONT_NAME = 'IBMPlexMonoReceipt';

export async function renderReceiptPdf(data: ReceiptData): Promise<jsPDF> {
    const [{ IBM_PLEX_MONO_REGULAR_TTF_B64, IBM_PLEX_MONO_BOLD_TTF_B64 }, qrDataUrl] = await Promise.all([
        import('../receiptFontData'),
        buildReceiptQrDataUrl(data.qrFacts),
    ]);
    const layout = buildReceiptPrimitives(data, { measure: estimateTextWidth, qrDataUrl });

    const doc = createPdfDocument(layout, PX_TO_MM);
    doc.addFileToVFS(`${FONT_NAME}-Regular.ttf`, IBM_PLEX_MONO_REGULAR_TTF_B64);
    doc.addFont(`${FONT_NAME}-Regular.ttf`, FONT_NAME, 'normal');
    doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, IBM_PLEX_MONO_BOLD_TTF_B64);
    doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, 'bold');
    doc.setFont(FONT_NAME, 'normal');

    const fonts: Record<FontFamily, PdfFontNames> = {
        mono: { normal: FONT_NAME, bold: FONT_NAME },
        serif: { normal: FONT_NAME },
        sans: { normal: FONT_NAME },
    };
    drawPrimitivesOnPdf(doc, layout, PX_TO_MM, fonts);
    return doc;
}
