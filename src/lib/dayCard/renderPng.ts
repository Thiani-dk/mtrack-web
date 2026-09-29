import { buildDayCardPrimitives } from './layout';
import type { DayCardData } from './model';
import { loadDayCardFonts, DAY_CARD_FONT_FAMILY } from './fonts';
import { createCanvasMeasurer } from '../canvasTextMeasurer';
import type { DayCardTheme } from './theme';
import type { LayoutResult } from '../documentPrimitives';
import { renderPrimitivesToCanvas, canvasToPngBlob } from '../primitiveCanvasRenderer';

// The canvas backend: draws the SAME primitives the in-app preview draws (see
// DayCardPrimitivesView.tsx) onto an offscreen canvas and exports it as a
// PNG. Owns no layout decisions of its own — a dumb loop over the list, in
// primitiveCanvasRenderer.ts, shared with the receipt.

export async function buildDayCardExportLayout(data: DayCardData, theme: DayCardTheme): Promise<LayoutResult> {
    await loadDayCardFonts();
    const measure = createCanvasMeasurer(DAY_CARD_FONT_FAMILY);
    return buildDayCardPrimitives(data, { theme, measure });
}

export async function renderDayCardPng(data: DayCardData, theme: DayCardTheme): Promise<Blob> {
    const layout = await buildDayCardExportLayout(data, theme);
    const canvas = document.createElement('canvas');
    await renderPrimitivesToCanvas(canvas, layout, DAY_CARD_FONT_FAMILY);
    return canvasToPngBlob(canvas);
}
