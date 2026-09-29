import { describe, expect, it } from 'vitest';
import { buildTornEdge, estimateTextWidth } from './documentPrimitives';

describe('estimateTextWidth', () => {
    it('is exact for mono text — every glyph in the embedded subset is 0.6em', () => {
        expect(estimateTextWidth('ABCDE', 'mono', 20, 400)).toBe(5 * 20 * 0.6);
    });

    it('mono width does not depend on weight (IBM Plex Mono is not variable)', () => {
        expect(estimateTextWidth('AB', 'mono', 20, 400)).toBe(estimateTextWidth('AB', 'mono', 20, 700));
    });
});

describe('buildTornEdge', () => {
    it('produces a closed polygon whose flat side sits exactly on yInner', () => {
        const edge = buildTornEdge(0, 100, 200, 20, 12, 'top', '#fff');
        expect(edge.points[1]).toBe(100);
        expect(edge.points[edge.points.length - 1]).toBe(100);
    });

    it('a top edge tears upward — its bounding box sits above yInner', () => {
        const edge = buildTornEdge(0, 100, 200, 20, 12, 'top', '#fff');
        expect(edge.y).toBe(88);
        expect(edge.y + edge.height).toBe(100);
    });

    it('a bottom edge tears downward — its bounding box sits below yInner', () => {
        const edge = buildTornEdge(0, 100, 200, 20, 12, 'bottom', '#fff');
        expect(edge.y).toBe(100);
        expect(edge.y + edge.height).toBe(112);
    });

    it('spans the full requested width, starting and ending at x and x+width', () => {
        const edge = buildTornEdge(5, 100, 200, 20, 12, 'top', '#fff');
        expect(edge.points[0]).toBe(5);
        expect(edge.points[edge.points.length - 2]).toBe(205);
    });

    it('produces one peak per tooth, alternating peak/valley', () => {
        const edge = buildTornEdge(0, 100, 200, 20, 12, 'top', '#fff');
        // 10 teeth (width 200 / toothWidth 20): start point + 2 points per tooth.
        expect(edge.points.length).toBe(2 + 10 * 4);
    });

    it('rounds to a whole number of teeth so the last one is never clipped', () => {
        const edge = buildTornEdge(0, 100, 205, 20, 12, 'top', '#fff');
        // 205/20 rounds to 10 teeth, each 20.5 wide, covering the full 205 exactly.
        expect(edge.points[edge.points.length - 2]).toBe(205);
    });
});
