import { buildReceiptPrimitives } from './layout';
import type { ReceiptData } from './model';
import { loadReceiptFonts, RECEIPT_FONT_FAMILY } from './fonts';
import { createCanvasMeasurer } from '../canvasTextMeasurer';
import type { LayoutResult } from '../documentPrimitives';
import { renderPrimitivesToCanvas, canvasToPngBlob } from '../primitiveCanvasRenderer';
import { buildReceiptQrDataUrl } from './qr';

// The canvas backend: draws the SAME primitives the in-app preview draws onto
// an offscreen canvas and exports it as a PNG. Owns no layout decisions —
// a dumb loop over the list, in primitiveCanvasRenderer.ts, shared with the
// day card.

export async function buildReceiptExportLayout(data: ReceiptData): Promise<LayoutResult> {
    const [, qrDataUrl] = await Promise.all([loadReceiptFonts(), buildReceiptQrDataUrl(data.qrFacts)]);
    const measure = createCanvasMeasurer(RECEIPT_FONT_FAMILY);
    return buildReceiptPrimitives(data, { measure, qrDataUrl });
}

export async function renderReceiptPng(data: ReceiptData): Promise<Blob> {
    const layout = await buildReceiptExportLayout(data);
    const canvas = document.createElement('canvas');
    await renderPrimitivesToCanvas(canvas, layout, RECEIPT_FONT_FAMILY);
    return canvasToPngBlob(canvas);
}
