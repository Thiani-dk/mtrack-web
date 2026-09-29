import type { FontFamily, LayoutResult, Primitive } from './documentPrimitives';

// Shared canvas drawing loop for every positioned-primitives layout in the
// app (the day card, the receipt) — a dumb walk over the primitive list, no
// layout decisions of its own. One copy of this logic means a rounded-rect
// radius or a tracked-caps spacing bug gets fixed once, not per document type.

export async function renderPrimitivesToCanvas(
    canvas: HTMLCanvasElement, layout: LayoutResult, fontFamily: Record<FontFamily, string>,
): Promise<void> {
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas context available for rendering');

    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.textBaseline = 'top';

    // Images (the receipt's QR code) need to be decoded before drawImage can
    // use them — loaded up front so the draw loop below stays synchronous.
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(
        layout.primitives
            .filter((p): p is Extract<Primitive, { kind: 'image' }> => p.kind === 'image')
            .map(p => loadImage(p.dataUrl).then(img => { images.set(p.dataUrl, img); })),
    );

    for (const p of layout.primitives) {
        if (p.kind === 'rect') {
            drawRoundedRect(ctx, p.x, p.y, p.width, p.height, p.radius ?? 0, p.color);
        } else if (p.kind === 'zigzag') {
            drawPolygon(ctx, p.points, p.color);
        } else if (p.kind === 'image') {
            const img = images.get(p.dataUrl);
            if (img) ctx.drawImage(img, p.x, p.y, p.width, p.height);
        } else {
            ctx.font = `${p.weight} ${p.size}px '${fontFamily[p.font]}'`;
            ctx.fillStyle = p.color;
            if (p.letterSpacing) {
                drawTrackedText(ctx, p.text, p.x, p.y, p.size * p.letterSpacing, p.align);
            } else {
                ctx.textAlign = p.align;
                ctx.fillText(p.text, p.x, p.y);
            }
        }
    }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
    });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image primitive failed to decode'));
        img.src = dataUrl;
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

function drawPolygon(ctx: CanvasRenderingContext2D, points: number[], color: string): void {
    if (points.length < 6) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fill();
}

// Canvas has no letter-spacing property on the 2D context in the browsers
// this app targets, so tracked-caps micro-labels are laid out one character
// at a time, using the same font metrics as everything else.
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
