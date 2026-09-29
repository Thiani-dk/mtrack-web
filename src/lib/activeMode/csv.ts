import Papa from 'papaparse';
import type { ParsedTransaction } from '../../types';
import { bucketOf } from './session';

// A plain CSV of the day's entries, for record-keeping and the vendor's own
// analysis — spreadsheet-shaped, not a copy of the day card.
//
// Deliberately narrow: no customer names (the day card and every export off
// this document are private-by-design about who paid — see the sales log,
// Phase 3.7, for the same rule), and no totals row, because a totals row
// invites a second sum sitting next to the real one, and the two silently
// drifting apart is worse than making whoever wants a total compute it
// themselves from the rows that are actually there.

export interface CsvRow {
    date: string;
    time: string;
    method: 'M-Pesa' | 'Cash';
    bucket: string;
    amount: number;
    reference: string;
    enteredAs: 'pasted' | 'typed' | 'lump sum';
    count: number | null;
}

// How one transaction is described in the export. `enteredAs` reads
// dataSource / isLumpSum rather than adding a fourth stored field: a pasted
// M-Pesa message is 'pasted', a lump sum is 'lump sum' regardless of how the
// form that built it was filled in, and everything else self-reported
// (whether tapped through the Cash flow's presets or typed as free text in
// the paste field, both being "the vendor told M-Track directly" with no
// message behind them) is 'typed'.
export function toCsvRow(t: ParsedTransaction): CsvRow {
    return {
        date: t.date.toISOString().slice(0, 10),
        time: t.time || '',
        method: t.method === 'cash' ? 'Cash' : 'M-Pesa',
        bucket: bucketOf(t),
        amount: t.amount,
        reference: t.codeIsSynthetic ? '' : t.transactionCode,
        enteredAs: t.isLumpSum ? 'lump sum' : t.dataSource === 'sms_verified' ? 'pasted' : 'typed',
        count: t.isLumpSum ? t.lumpSumCount : 1,
    };
}

const COLUMNS: Array<{ key: keyof CsvRow; header: string }> = [
    { key: 'date', header: 'Date' },
    { key: 'time', header: 'Time' },
    { key: 'method', header: 'Method' },
    { key: 'bucket', header: 'Bucket' },
    { key: 'amount', header: 'Amount' },
    { key: 'reference', header: 'Reference' },
    { key: 'enteredAs', header: 'Entered as' },
    { key: 'count', header: 'Count' },
];

// Spreadsheet formula injection: a field starting with =, +, - or @ is a
// formula to Excel, Sheets and most other spreadsheet software the moment the
// file is opened, and a fully automated one at that — a reference or a bucket
// name that happens to start with one of those characters is exactly the kind
// of thing an attacker (or just an odd shop name) could otherwise smuggle in.
// A leading apostrophe forces text interpretation everywhere that matters,
// without adding a visible character in a real spreadsheet view.
const FORMULA_LEAD = /^[=+\-@]/;

function neutralise(value: string): string {
    return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

// Builds the CSV text for a day's entries, one row per transaction, in the
// order given (callers pass recentEntries() or the raw filed order, whichever
// reads better for their export). UTF-8, every field quoted, every field
// spreadsheet-safe.
export function buildDailySalesCsv(transactions: ParsedTransaction[]): string {
    const rows = transactions.map(toCsvRow).map(row => COLUMNS.map(({ key }) => {
        const value = row[key];
        if (value === null) return '';
        // Neutralise every field uniformly, numbers included — a negative
        // amount would otherwise be the one numeric value that could still
        // start with a formula-triggering character.
        return neutralise(String(value));
    }));
    return Papa.unparse(
        { fields: COLUMNS.map(c => c.header), data: rows },
        { quotes: true, newline: '\r\n' },
    );
}

export const DAILY_SALES_CSV_MIME = 'text/csv;charset=utf-8';
