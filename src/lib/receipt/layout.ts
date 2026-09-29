import type { ReceiptData } from './model';
import type { LayoutResult, MeasureText, Primitive } from '../documentPrimitives';
import { buildTornEdge } from '../documentPrimitives';
import { fitSize, textRun, wrapLines } from '../layoutText';
import { RECEIPT_PALETTE } from './theme';

// The positioned-primitives layout for the sales receipt: a narrow,
// monospace, torn-paper strip — the visual opposite of the day card's wide
// dark share card, built from the same shared primitive vocabulary and the
// same "one layout, many backends" architecture. See documentPrimitives.ts.

export const RECEIPT_WIDTH = 576; // 80mm at 203dpi — a real thermal printer's own raster width
const PAD = 32;
const TOOTH_W = 16;
const TOOTH_H = 10;
const MIN_TEXT = 15; // small, on purpose — an actual receipt's own print is small

export interface BuildReceiptLayoutOptions {
    measure: MeasureText;
    // Already generated (see receiptRender.ts) — the layout never generates
    // its own QR code, matching the same "compute it first" pattern the day
    // card uses for font loading.
    qrDataUrl: string;
    width?: number; // override, for tests only
}

function pushDivider(primitives: Primitive[], x: number, y: number, width: number): number {
    const dashW = 8;
    const gap = 6;
    const count = Math.floor((width + gap) / (dashW + gap));
    for (let i = 0; i < count; i++) {
        primitives.push({ kind: 'rect', x: x + i * (dashW + gap), y, width: dashW, height: 2, color: RECEIPT_PALETTE.divider });
    }
    return y + 2;
}

export function buildReceiptPrimitives(data: ReceiptData, opts: BuildReceiptLayoutOptions): LayoutResult {
    const width = opts.width ?? RECEIPT_WIDTH;
    const contentW = width - PAD * 2;
    const measure = opts.measure;
    const primitives: Primitive[] = [];
    const p = RECEIPT_PALETTE;

    let y = TOOTH_H + 28;

    // ── Business name and contact ──
    const nameSteps = [30, 26, 22, 18, MIN_TEXT];
    const nameText = (data.businessName ?? 'RECEIPT').toUpperCase();
    const nameSize = fitSize(measure, nameText, 'mono', 700, contentW, nameSteps);
    primitives.push(textRun(width / 2, y, nameText, 'mono', nameSize, 700, p.ink, 'center', { fitWidth: contentW }));
    y += nameSize + 8;

    if (data.contact) {
        primitives.push(textRun(width / 2, y, data.contact, 'mono', MIN_TEXT, 400, p.muted, 'center'));
        y += MIN_TEXT + 10;
    }
    y += 6;
    y = pushDivider(primitives, PAD, y, contentW) + 16;

    // ── Reference, date/time, served by ──
    primitives.push(textRun(PAD, y, data.receiptNumber, 'mono', MIN_TEXT, 500, p.ink, 'left'));
    primitives.push(textRun(width - PAD, y, `${data.dateLabel}  ${data.timeLabel}`, 'mono', MIN_TEXT, 400, p.muted, 'right'));
    y += MIN_TEXT + 12;

    if (data.servedBy) {
        primitives.push(textRun(PAD, y, `Served by ${data.servedBy}`, 'mono', MIN_TEXT, 400, p.muted, 'left'));
        y += MIN_TEXT + 12;
    }
    y += 4;
    y = pushDivider(primitives, PAD, y, contentW) + 18;

    // ── Line items ──
    for (const line of data.lines) {
        const amountWidth = measure(line.amountLabel, 'mono', MIN_TEXT + 1, 600);
        primitives.push(textRun(PAD, y, line.description, 'mono', MIN_TEXT + 1, 500, p.ink, 'left', { fitWidth: contentW - amountWidth - 12 }));
        primitives.push(textRun(width - PAD, y, line.amountLabel, 'mono', MIN_TEXT + 1, 600, p.ink, 'right'));
        y += MIN_TEXT + 1 + 6;
        if (line.detail) {
            primitives.push(textRun(PAD, y, line.detail, 'mono', MIN_TEXT - 2, 400, p.muted, 'left'));
            y += MIN_TEXT - 2 + 8;
        }
        y += 6;
    }
    y += 4;
    y = pushDivider(primitives, PAD, y, contentW) + 18;

    // ── Subtotal / reconciliation, shown only when there is something to
    // reconcile — an itemised sale that matched exactly needs no extra line,
    // the single "TOTAL" below already says everything. ──
    if (data.reconciliation.kind !== 'match') {
        primitives.push(textRun(PAD, y, 'Subtotal', 'mono', MIN_TEXT, 400, p.muted, 'left'));
        primitives.push(textRun(width - PAD, y, data.subtotalLabel, 'mono', MIN_TEXT, 400, p.muted, 'right'));
        y += MIN_TEXT + 10;

        const reconLabel = data.reconciliation.kind === 'tip' ? 'Tip'
            : data.reconciliation.kind === 'discount' ? 'Discount'
            : 'Unexplained difference';
        const reconAmount = data.reconciliation.kind === 'discount' ? `-${data.reconciliation.amountLabel}` : data.reconciliation.amountLabel;
        primitives.push(textRun(PAD, y, reconLabel, 'mono', MIN_TEXT, 400, p.muted, 'left'));
        primitives.push(textRun(width - PAD, y, reconAmount, 'mono', MIN_TEXT, 400, p.muted, 'right'));
        y += MIN_TEXT + 14;
    }

    // ── Total ──
    const totalSteps = [28, 24, 20, MIN_TEXT];
    const totalSize = fitSize(measure, data.totalLabel, 'mono', 700, contentW - 90, totalSteps);
    primitives.push(textRun(PAD, y, 'TOTAL', 'mono', totalSize, 700, p.ink, 'left'));
    primitives.push(textRun(width - PAD, y, data.totalLabel, 'mono', totalSize, 700, p.ink, 'right', { fitWidth: contentW - 90 }));
    y += totalSize + 16;

    // ── Amount in words ──
    for (const line of wrapLines(measure, data.amountWords, 'mono', 400, MIN_TEXT - 1, contentW)) {
        primitives.push(textRun(width / 2, y, line, 'mono', MIN_TEXT - 1, 400, p.ink, 'center'));
        y += MIN_TEXT - 1 + 6;
    }
    y += 14;
    y = pushDivider(primitives, PAD, y, contentW) + 20;

    // ── Provenance ──
    for (const line of wrapLines(measure, data.provenanceLine, 'mono', 400, MIN_TEXT - 2, contentW)) {
        primitives.push(textRun(width / 2, y, line, 'mono', MIN_TEXT - 2, 400, p.muted, 'center'));
        y += MIN_TEXT - 2 + 6;
    }
    y += 20;

    // ── QR facts payload ──
    const qrSize = Math.min(140, contentW);
    primitives.push({ kind: 'image', x: (width - qrSize) / 2, y, width: qrSize, height: qrSize, dataUrl: opts.qrDataUrl });
    y += qrSize + 14;
    primitives.push(textRun(width / 2, y, data.receiptNumber, 'mono', MIN_TEXT - 3, 400, p.muted, 'center'));
    y += (MIN_TEXT - 3) + 20;

    // ── Footer ──
    for (const line of wrapLines(measure, data.footerLine, 'mono', 400, MIN_TEXT - 2, contentW)) {
        primitives.push(textRun(width / 2, y, line, 'mono', MIN_TEXT - 2, 400, p.muted, 'center'));
        y += MIN_TEXT - 2 + 6;
    }
    y += TOOTH_H + 20;

    const paperBottom = y;

    // ── The paper itself, and its two torn edges — pushed to the FRONT of
    // the list (canvas/DOM both draw in array order, so these must be drawn
    // before the text/rects above, not after) ──
    const paperRect: Primitive = { kind: 'rect', x: 0, y: TOOTH_H, width, height: paperBottom - TOOTH_H * 2, color: p.paper };
    const topEdge = buildTornEdge(0, TOOTH_H, width, TOOTH_W, TOOTH_H, 'top', p.paper);
    const bottomEdge = buildTornEdge(0, paperBottom - TOOTH_H, width, TOOTH_W, TOOTH_H, 'bottom', p.paper);

    return {
        width,
        height: paperBottom,
        background: p.page,
        primitives: [paperRect, topEdge, bottomEdge, ...primitives],
    };
}
