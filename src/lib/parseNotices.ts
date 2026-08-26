import type { ParseStats } from './parsers';

export interface ParseNotice {
    id: string;
    text: string;
}

// Priority order: nothing parsed > partial > out of range > ambiguous dates >
// low confidence > holds/failed > duplicates. "Nothing parsed" supersedes
// everything else — there's nothing else useful to say once the whole paste
// came up empty. Likewise, if every parsed transaction fell outside the date
// range, that's the whole story — nothing else about the batch matters yet.
export function buildParseNotices(stats: ParseStats, outOfRangeCount = 0): ParseNotice[] {
    if (stats.parsed === 0) {
        return [{
            id: 'nothing',
            text: "Nothing came through. Those might not be transaction messages, or they got mangled on the way over. Try copying them again straight from your SMS app.",
        }];
    }

    if (outOfRangeCount > 0 && outOfRangeCount === stats.parsed) {
        return [{
            id: 'all-out-of-range',
            text: `All ${stats.parsed} transactions fall outside your date range. Want to widen it?`,
        }];
    }

    const notices: ParseNotice[] = [];

    if (stats.rejected > 0) {
        notices.push({
            id: 'partial',
            text: `I found ${stats.parsed} transactions. ${stats.rejected} other messages didn't look like transactions, so I skipped them.`,
        });
    }

    if (outOfRangeCount > 0) {
        notices.push({
            id: 'out-of-range',
            text: `${outOfRangeCount} transaction${outOfRangeCount === 1 ? '' : 's'} fell outside your date range, so I've set them aside.`,
        });
    }

    if (stats.ambiguousDates > 0) {
        const n = stats.ambiguousDates;
        notices.push({
            id: 'ambiguous',
            text: `Heads up: ${n} date${n === 1 ? '' : 's'} could be read two ways. I've gone day-first, Kenyan style, worth a glance.`,
        });
    }

    if (stats.byConfidence.low > 0) {
        notices.push({
            id: 'lowconf',
            text: "A few of these I'm less sure about. They're marked so you can check them.",
        });
    }

    if (stats.holds > 0 || stats.failed > 0) {
        notices.push({
            id: 'holdsfailed',
            text: `I left out ${stats.holds} hold${stats.holds === 1 ? '' : 's'} and ${stats.failed} failed payment${stats.failed === 1 ? '' : 's'}. You can add them back if you want them counted.`,
        });
    }

    if (stats.duplicatesRemoved > 0) {
        const n = stats.duplicatesRemoved;
        notices.push({
            id: 'dupes',
            text: `Removed ${n} duplicate${n === 1 ? '' : 's'}.`,
        });
    }

    return notices;
}
