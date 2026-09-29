// papaparse ships no type declarations and this project does not carry
// @types/papaparse — this is the minimal shape actually used (the CSV writer
// in activeMode/csv.ts), not a full re-declaration of the package. papaparse
// itself is already a runtime dependency; this file supplies its types
// locally rather than adding a new (types-only) package for a handful of
// fields.
declare module 'papaparse' {
    export interface UnparseConfig {
        quotes?: boolean | boolean[] | ((value: unknown, columnIndex: number) => boolean);
        quoteChar?: string;
        escapeChar?: string;
        delimiter?: string;
        header?: boolean;
        newline?: string;
        skipEmptyLines?: boolean | 'greedy';
        columns?: string[];
    }

    export function unparse(
        data: unknown[][] | Record<string, unknown>[] | { fields: string[]; data: unknown[][] },
        config?: UnparseConfig,
    ): string;

    // Only the synchronous, string-in string-config shape used by this
    // project's own tests to round-trip what unparse produced.
    export interface ParseConfig {
        header?: boolean;
        skipEmptyLines?: boolean | 'greedy';
    }
    export interface ParseResult<T> {
        data: T[];
        errors: unknown[];
        meta: Record<string, unknown>;
    }
    export function parse<T = Record<string, string>>(input: string, config?: ParseConfig): ParseResult<T>;

    const Papa: { unparse: typeof unparse; parse: typeof parse };
    export default Papa;
}
