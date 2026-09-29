import { buildDayCardPrimitives } from './layout';
import type { DayCardData } from './model';
import { loadDayCardFonts, DAY_CARD_FONT_FAMILY } from './fonts';
import { createCanvasMeasurer } from './canvasMeasurer';
import type { DayCardTheme } from './theme';
import type { LayoutResult } from './primitives';

// The canvas backend: draws the SAME primitives the in-app preview draws (see
// DayCardPrimitivesView.tsx) onto an offscreen canvas and exports it as a
// PNG. Owns no layout decisions of its own — a dumb loop over the list.

export async function buildDayCardExportLayout(data: DayCardData, theme: DayCardTheme): Promise<LayoutResult> {
    await loadDayCardFonts();
    const measure = createCanvasMeasurer();
    return buildDayCardPrimitives(data, { theme, measure });
}

export async function renderDayCardPng(data: DayCardData, theme: DayCardTheme): Promise<Blob> {
    const layout = await buildDayCardExportLayout(data, theme);

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('day card: no 2D canvas context available for rendering');

    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.textBaseline = 'top';

    for (const p of layout.primitives) {
        if (p.kind === 'rect') {
            drawRoundedRect(ctx, p.x, p.y, p.width, p.height, p.radius ?? 0, p.color);
        } else {
            ctx.font = `${p.weight} ${p.size}px '${DAY_CARD_FONT_FAMILY[p.font]}'`;
            ctx.fillStyle = p.color;
            if (p.letterSpacing) {
                drawTrackedText(ctx, p.text, p.x, p.y, p.size * p.letterSpacing, p.align);
            } else {
                ctx.textAlign = p.align;
                ctx.fillText(p.text, p.x, p.y);
            }
        }
    }

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('day card: PNG export failed'))), 'image/png');
    });
}

function drawRoundedRect(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string,
): void {
    ctx.fillStyle = color;
    if (r <= 0) { ctx.fillRect(x, y, w, h); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
}

// Canvas has no letter-spacing property on the 2D context in the browsers
// this app targets, so tracked-caps micro-labels (the design's own small,
// spaced-out section headers) are laid out one character at a time, using the
// same font metrics as everything else.
function drawTrackedText(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number,
    align: 'left' | 'center' | 'right',
): void {
    const chars = [...text];
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
    const startX = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    let cursor = startX;
    chars.forEach((ch, i) => {
        ctx.fillText(ch, cursor, y);
        cursor += widths[i] + spacing;
    });
    ctx.textAlign = prevAlign;
}
