import type { DayCardData } from './model';
import { dayCardCompactHourLabel } from './model';
import type { LayoutResult, MeasureText, Primitive, TextRun, FontFamily } from './primitives';
import { DAY_CARD_PALETTES, type DayCardTheme } from './theme';

// The positioned-primitives layout for the day card. One function, called by
// both backends (the canvas PNG exporter and the in-app preview) with their
// own measurer — see primitives.ts for why measurement is injected rather
// than hard-coded. Neither backend makes its own sizing or wrapping
// decisions; everything here is exactly what gets drawn.

export const CARD_WIDTH = 1080;
const PAD = 72;
const MIN_TEXT = 28; // the design's own floor, on this 1080-wide canvas

export interface BuildDayCardLayoutOptions {
    theme: DayCardTheme;
    measure: MeasureText;
    width?: number; // override, for tests only — the shipping app always exports at CARD_WIDTH
}

function fitSize(
    measure: MeasureText, text: string, font: FontFamily, weight: 400 | 500 | 600 | 700,
    maxWidth: number, steps: number[],
): number {
    for (const size of steps) {
        if (measure(text, font, size, weight) <= maxWidth) return size;
    }
    return steps[steps.length - 1];
}

// Greedy word wrap: as many words as fit per line at the given size, never
// exceeding maxWidth. A single word wider than maxWidth on its own is left to
// overflow that one line rather than being broken mid-word — this only
// happens for pathological input (a single "word" with no spaces at all,
// longer than the whole card), which honest, human-typed bucket names and
// sentences never produce.
function wrapLines(
    measure: MeasureText, text: string, font: FontFamily, weight: 400 | 500 | 600 | 700,
    size: number, maxWidth: number,
): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && measure(candidate, font, size, weight) > maxWidth) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines;
}

// Trims to a single line that fits maxWidth, with an ellipsis, rather than
// wrapping — used only where a second line would break the design's own
// fixed-height layout (a bucket row next to its amount, a header name next to
// its date).
function truncateToWidth(
    measure: MeasureText, text: string, font: FontFamily, weight: 400 | 500 | 600 | 700,
    size: number, maxWidth: number,
): string {
    if (measure(text, font, size, weight) <= maxWidth) return text;
    let end = text.length;
    while (end > 0 && measure(`${text.slice(0, end)}…`, font, size, weight) > maxWidth) end--;
    return end > 0 ? `${text.slice(0, end)}…` : '…';
}

function textRun(
    x: number, y: number, text: string, font: FontFamily, size: number, weight: 400 | 500 | 600 | 700,
    color: string, align: 'left' | 'center' | 'right', extra?: { letterSpacing?: number; fitWidth?: number },
): TextRun {
    return { kind: 'text', x, y, text, font, size, weight, color, align, ...extra };
}

export function buildDayCardPrimitives(data: DayCardData, opts: BuildDayCardLayoutOptions): LayoutResult {
    const width = opts.width ?? CARD_WIDTH;
    const contentW = width - PAD * 2;
    const palette = DAY_CARD_PALETTES[opts.theme];
    const measure = opts.measure;
    const primitives: Primitive[] = [];
    let y = PAD;

    // ── Header: stall name (left), date (right) — truncate the name rather
    // than let a long one collide with the date, never the other way round,
    // since the date is short, fixed-format and never grown to make room. ──
    const headerSize = 34;
    const dateText = data.dateLabel;
    const dateWidth = measure(dateText, 'sans', headerSize, 400);
    primitives.push(textRun(width - PAD, y, dateText, 'sans', headerSize, 400, palette.muted, 'right'));

    const nameMaxWidth = contentW - dateWidth - 24;
    const nameText = truncateToWidth(measure, data.stallName ?? "Today's sales", 'sans', 600, headerSize, Math.max(nameMaxWidth, headerSize * 2));
    primitives.push(textRun(PAD, y, nameText, 'sans', headerSize, 600, palette.ink, 'left'));
    y += headerSize + 40;

    // ── Hero ──
    primitives.push(textRun(width / 2, y, data.heroLabel, 'sans', MIN_TEXT, 600, palette.muted, 'center', { letterSpacing: 0.08 }));
    y += MIN_TEXT + 16;

    const heroSteps = [132, 116, 100, 88, 76, 64, 56, 48, 40, 32, MIN_TEXT];
    const heroSize = fitSize(measure, data.heroAmount, 'serif', 700, contentW, heroSteps);
    primitives.push(textRun(width / 2, y, data.heroAmount, 'serif', heroSize, 700, palette.ink, 'center', { fitWidth: contentW }));
    y += heroSize + 28;

    if (data.paymentSplitLine) {
        const splitSize = 30;
        for (const line of wrapLines(measure, data.paymentSplitLine, 'sans', 500, splitSize, contentW)) {
            primitives.push(textRun(width / 2, y, line, 'sans', splitSize, 500, palette.muted, 'center'));
            y += splitSize + 10;
        }
        y += 18;
    } else {
        y += 40;
    }

    // ── Tiles: sale count, average, and the primary tile (peak hour or
    // biggest sale, already decided by the model) ──
    const tileGap = 24;
    const tileW = (contentW - tileGap * 2) / 3;
    const tileH = 184;
    const tilePad = 30;
    const tileValueMaxWidth = tileW - tilePad * 2;
    const tileValueSteps = [48, 42, 38, 34, MIN_TEXT];

    const primaryLabel = data.primaryTile.kind === 'peakHour' ? 'PEAK HOUR' : 'BIGGEST SALE';
    const tiles: Array<{ label: string; value: string }> = [
        { label: 'SALES', value: data.saleCountLabel },
        { label: 'AVERAGE SALE', value: data.averageLabel },
        { label: primaryLabel, value: data.primaryTile.label },
    ];

    tiles.forEach((tile, i) => {
        const tx = PAD + i * (tileW + tileGap);
        primitives.push({ kind: 'rect', x: tx, y, width: tileW, height: tileH, color: palette.tileBackground, radius: 20 });
        const labelSize = MIN_TEXT;
        const labelY = y + tilePad;
        primitives.push(textRun(tx + tileW / 2, labelY, tile.label, 'sans', labelSize, 600, palette.muted, 'center', { letterSpacing: 0.06 }));

        let value = tile.value;
        let valueSize = fitSize(measure, value, 'sans', 700, tileValueMaxWidth, tileValueSteps);
        // Peak hour has a pre-computed compact form for exactly this case —
        // reach for it before accepting the smallest step, so "11 AM to 12
        // PM" becomes "11AM-12PM" rather than shrinking past readability.
        if (data.primaryTile.kind === 'peakHour' && i === 2
            && measure(value, 'sans', valueSize, 700) > tileValueMaxWidth) {
            const compact = dayCardCompactHourLabel(value);
            if (measure(compact, 'sans', MIN_TEXT, 700) <= tileValueMaxWidth) {
                value = compact;
                valueSize = MIN_TEXT;
            }
        }
        const valueY = labelY + labelSize + 20;
        primitives.push(textRun(tx + tileW / 2, valueY, value, 'sans', valueSize, 700, palette.ink, 'center', { fitWidth: tileValueMaxWidth }));
    });
    y += tileH + 36;

    if (data.averageExcludesNote) {
        for (const line of wrapLines(measure, data.averageExcludesNote, 'sans', 400, MIN_TEXT, contentW)) {
            primitives.push(textRun(width / 2, y, line, 'sans', MIN_TEXT, 400, palette.muted, 'center'));
            y += MIN_TEXT + 8;
        }
        y += 20;
    }

    // ── Bucket section ──
    primitives.push(textRun(PAD, y, 'WHERE IT CAME FROM', 'sans', MIN_TEXT, 600, palette.muted, 'left', { letterSpacing: 0.08 }));
    y += MIN_TEXT + 32;

    if (data.buckets === null) {
        const size = 34;
        for (const line of wrapLines(measure, data.singleBucketLine ?? '', 'sans', 500, size, contentW)) {
            primitives.push(textRun(width / 2, y, line, 'sans', size, 500, palette.ink, 'center'));
            y += size + 10;
        }
        y += 8;
    } else {
        const rowNameSize = 32;
        const rowAmountSize = 32;
        const barH = 8;
        for (const row of data.buckets) {
            const amountWidth = measure(row.amount, 'sans', rowAmountSize, 600);
            const nameMaxW = contentW - amountWidth - 20;
            const name = truncateToWidth(measure, row.label, 'sans', 500, rowNameSize, Math.max(nameMaxW, rowNameSize * 2));
            primitives.push(textRun(PAD, y, name, 'sans', rowNameSize, 500, palette.ink, 'left'));
            primitives.push(textRun(width - PAD, y, row.amount, 'sans', rowAmountSize, 600, palette.ink, 'right'));
            const barY = y + Math.max(rowNameSize, rowAmountSize) + 14;
            primitives.push({ kind: 'rect', x: PAD, y: barY, width: contentW, height: barH, color: palette.track, radius: barH / 2 });
            const fillW = Math.max(0, Math.min(contentW, contentW * row.share));
            if (fillW > 0) {
                primitives.push({ kind: 'rect', x: PAD, y: barY, width: fillW, height: barH, color: palette.fill, radius: barH / 2 });
            }
            y = barY + barH + 26;
        }
    }

    if (data.topBucketSentence) {
        const size = 30;
        for (const line of wrapLines(measure, data.topBucketSentence, 'sans', 400, size, contentW)) {
            primitives.push(textRun(width / 2, y, line, 'sans', size, 400, palette.muted, 'center'));
            y += size + 8;
        }
        y += 10;
    }

    // ── Footer ──
    y += 20;
    for (const line of wrapLines(measure, data.footerLine, 'sans', 400, MIN_TEXT, contentW)) {
        primitives.push(textRun(width / 2, y, line, 'sans', MIN_TEXT, 400, palette.muted, 'center'));
        y += MIN_TEXT + 8;
    }
    y += PAD - 8;

    return { width, height: Math.round(y), background: palette.background, primitives };
}
