import type { FontFamily, MeasureText, TextRun } from './documentPrimitives';

// Text-fitting helpers shared by every positioned-primitives layout (the day
// card, the receipt) — shrink-to-fit, word-wrap and single-line truncation,
// all built on the same injected measurer so a layout's sizing decisions are
// exactly reproducible by whichever backend built that measurer.

export function fitSize(
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
// longer than the whole card), which honest, human-typed text never produces.
export function wrapLines(
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
// wrapping — used only where a second line would break a fixed-height layout
// (a bucket row next to its amount, a header name next to its date).
export function truncateToWidth(
    measure: MeasureText, text: string, font: FontFamily, weight: 400 | 500 | 600 | 700,
    size: number, maxWidth: number,
): string {
    if (measure(text, font, size, weight) <= maxWidth) return text;
    let end = text.length;
    while (end > 0 && measure(`${text.slice(0, end)}…`, font, size, weight) > maxWidth) end--;
    return end > 0 ? `${text.slice(0, end)}…` : '…';
}

export function textRun(
    x: number, y: number, text: string, font: FontFamily, size: number, weight: 400 | 500 | 600 | 700,
    color: string, align: 'left' | 'center' | 'right', extra?: { letterSpacing?: number; fitWidth?: number },
): TextRun {
    return { kind: 'text', x, y, text, font, size, weight, color, align, ...extra };
}
