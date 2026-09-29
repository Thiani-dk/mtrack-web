import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { buildCashSale, buildLumpSum, captureFromPaste } from './session';
import { buildDailySalesCsv, toCsvRow } from './csv';
import type { ParsedTransaction } from '../../types';

// The day's entries as a plain CSV, for a vendor's own record-keeping —
// spreadsheet-shaped, no customer names, no totals row to drift from the real
// one, and safe to open in a spreadsheet even if a field happens to start
// with a character that means something to one.

const NOW = new Date('2026-09-29T13:05:00');

function mpesaSale(amount: number, minute: number): ParsedTransaction {
    const raw = `QA${String(minute).padStart(2, '0')}XK9P2L Confirmed. You have received `
        + `Ksh${amount.toFixed(2)} from JOHN KAMAU 0712345678 on 29/9/26 at 1:${String(minute).padStart(2, '0')} PM. `
        + `New M-PESA balance is Ksh${(20000 + amount).toFixed(2)}.`;
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error(`fixture did not parse: ${raw}`);
    return { ...t, bucketLabel: 'Combo sales' };
}

describe('toCsvRow', () => {
    it('reads a pasted M-Pesa sale as pasted, with its real reference', () => {
        const row = toCsvRow(mpesaSale(350, 5));
        expect(row.method).toBe('M-Pesa');
        expect(row.enteredAs).toBe('pasted');
        expect(row.reference).toBe('QA05XK9P2L');
        expect(row.bucket).toBe('Combo sales');
        expect(row.amount).toBe(350);
        expect(row.count).toBe(1);
    });

    it('reads a live cash sale as typed, with no real reference to show', () => {
        const row = toCsvRow(buildCashSale({ bucket: 'Drinks', amount: 100, now: NOW }));
        expect(row.method).toBe('Cash');
        expect(row.enteredAs).toBe('typed');
        expect(row.reference).toBe('');
        expect(row.count).toBe(1);
    });

    it('reads a lump sum as lump sum, carrying its count', () => {
        const row = toCsvRow(buildLumpSum({ bucket: 'Combo sales', amount: 4040, count: 12, now: NOW }));
        expect(row.enteredAs).toBe('lump sum');
        expect(row.count).toBe(12);
        expect(row.time).toBe('');
    });

    it('reads a lump sum with no count as an empty count, not a guess', () => {
        const row = toCsvRow(buildLumpSum({ bucket: 'Drinks', amount: 900, count: null, now: NOW }));
        expect(row.count).toBeNull();
    });

    it('reports Unsorted for an unfiled sale', () => {
        const row = toCsvRow(buildCashSale({ bucket: 'Unsorted', amount: 50, now: NOW }));
        expect(row.bucket).toBe('Unsorted');
    });
});

describe('buildDailySalesCsv', () => {
    it('round-trips through papaparse with the right columns and values', () => {
        const csv = buildDailySalesCsv([
            mpesaSale(350, 5),
            buildCashSale({ bucket: 'Drinks', amount: 100, now: NOW }),
        ]);
        const parsed = Papa.parse(csv, { header: true }) as { data: Record<string, string>[] };
        expect(parsed.data).toHaveLength(2);
        expect(parsed.data[0].Method).toBe('M-Pesa');
        expect(parsed.data[0].Bucket).toBe('Combo sales');
        expect(parsed.data[0].Amount).toBe('350');
        expect(parsed.data[1].Method).toBe('Cash');
        expect(parsed.data[1]['Entered as']).toBe('typed');
    });

    it('carries no customer name anywhere in the output', () => {
        const csv = buildDailySalesCsv([mpesaSale(350, 5)]);
        expect(csv).not.toMatch(/JOHN KAMAU/i);
    });

    it('has no totals row — exactly one row per transaction, no more', () => {
        const txns = [mpesaSale(350, 5), mpesaSale(700, 11), buildCashSale({ bucket: 'Drinks', amount: 100, now: NOW })];
        const csv = buildDailySalesCsv(txns);
        // header + one row per transaction, nothing else
        expect(csv.trim().split('\r\n')).toHaveLength(txns.length + 1);
    });

    it('is just the header for an empty day', () => {
        const csv = buildDailySalesCsv([]);
        expect(csv.trim().split('\r\n')).toHaveLength(1);
    });

    it('quotes every field', () => {
        const csv = buildDailySalesCsv([mpesaSale(350, 5)]);
        // papaparse with quotes:true wraps every field in the header row too
        expect(csv.split('\r\n')[0]).toBe('"Date","Time","Method","Bucket","Amount","Reference","Entered as","Count"');
    });

    it('neutralises a bucket name that looks like a spreadsheet formula', () => {
        const dangerous = buildCashSale({ bucket: '=HYPERLINK("http://evil")', amount: 100, now: NOW });
        const csv = buildDailySalesCsv([dangerous]);
        const parsed = Papa.parse(csv, { header: true }) as { data: Record<string, string>[] };
        expect(parsed.data[0].Bucket.startsWith("'=")).toBe(true);
    });

    it('neutralises every dangerous leading character, not just =', () => {
        for (const lead of ['=', '+', '-', '@']) {
            const t = buildCashSale({ bucket: `${lead}cmd|' /C calc'!A0`, amount: 100, now: NOW });
            const csv = buildDailySalesCsv([t]);
            const parsed = Papa.parse(csv, { header: true }) as { data: Record<string, string>[] };
            expect(parsed.data[0].Bucket.startsWith(`'${lead}`)).toBe(true);
        }
    });

    it('does not neutralise a field that merely contains, but does not start with, a dangerous character', () => {
        const t = buildCashSale({ bucket: 'Fish & Chips (2-for-1)', amount: 100, now: NOW });
        const csv = buildDailySalesCsv([t]);
        const parsed = Papa.parse(csv, { header: true }) as { data: Record<string, string>[] };
        expect(parsed.data[0].Bucket).toBe('Fish & Chips (2-for-1)');
    });
});
