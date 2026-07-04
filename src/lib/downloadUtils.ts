import type { ParsedTransaction, DeclutterCommand } from '../types';

// ── Core download helpers ─────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function downloadHTML(content: string, filename: string): void {
    triggerDownload(new Blob([content], { type: 'text/html' }), filename);
}

export function downloadCSV(content: string, filename: string): void {
    // BOM is already prepended in ledgerGenerator — don't double-add it here.
    triggerDownload(new Blob([content], { type: 'text/csv' }), filename);
}

export function downloadPDF(blob: Blob, filename: string): void {
    triggerDownload(blob, filename);
}

// ── Content hashing ───────────────────────────────────────────────────────────
//
// SHA-256 via the Web Crypto API (built into every modern browser, no library
// needed). We grab the first 4 bytes of the digest, convert to a uint32, then
// take modulo 1,000,000 to get a stable 6-digit fingerprint of the content.
//
// Properties:
//   • Deterministic  — same transactions → same hash every time
//   • Sensitive      — one different transaction → completely different hash
//   • One-way        — cannot be reversed to recover transaction data
//   • Session-stable — HTML + CSV + PDF from the same run share the same hash

async function sha256Hash(input: string): Promise<string> {
    const buffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input)
    );
    const num = new DataView(buffer).getUint32(0, false); // big-endian first 4 bytes
    return String(num % 1_000_000).padStart(6, '0');
}

// Build a stable fingerprint string from M-PESA transactions.
// Uses transaction codes + amounts + dates — enough to be unique per dataset.
function transactionFingerprint(transactions: ParsedTransaction[]): string {
    return transactions
        .map(t => `${t.transactionCode}|${t.amount}|${t.date.toISOString().slice(0, 10)}`)
        .join('::');
}

// Build a stable fingerprint string from Gmail declutter commands.
function declutterFingerprint(commands: DeclutterCommand[]): string {
    return commands
        .filter(c => c.included)
        .map(c => c.command)
        .join('::');
}

// ── Filename generators ───────────────────────────────────────────────────────

export async function getMpesaFilenames(
    transactions: ParsedTransaction[],
    mode: 'receipt' | 'ledger'
): Promise<{ html: string; pdf: string; csv: string; csvSummary: string }> {
    const hash = await sha256Hash(transactionFingerprint(transactions));
    const base = `mtrack-${mode}-${hash}`;
    return {
        html:       `${base}.html`,
        pdf:        `${base}.pdf`,
        csv:        `${base}.csv`,
        csvSummary: `${base}-summary.csv`,
    };
}

export async function getGmailFilenames(
    commands: DeclutterCommand[]
): Promise<{ html: string; pdf: string }> {
    const hash = await sha256Hash(declutterFingerprint(commands));
    const base = `mtrack-gmail-${hash}`;
    return {
        html: `${base}.html`,
        pdf:  `${base}.pdf`,
    };
}

// ── Legacy sync fallback (used if async hash isn't available) ─────────────────
// Simple djb2 hash — runs synchronously, no Web Crypto needed.
// Less collision-resistant than SHA-256 but fine as a fallback.
function djb2Hash(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
        hash = hash >>> 0; // keep unsigned 32-bit
    }
    return String(hash % 1_000_000).padStart(6, '0');
}

export function getMpesaFilenamesSync(
    transactions: ParsedTransaction[],
    mode: 'receipt' | 'ledger'
): { html: string; pdf: string; csv: string; csvSummary: string } {
    const hash = djb2Hash(transactionFingerprint(transactions));
    const base = `mtrack-${mode}-${hash}`;
    return {
        html:       `${base}.html`,
        pdf:        `${base}.pdf`,
        csv:        `${base}.csv`,
        csvSummary: `${base}-summary.csv`,
    };
}

export function getGmailFilenamesSync(
    commands: DeclutterCommand[]
): { html: string; pdf: string } {
    const hash = djb2Hash(declutterFingerprint(commands));
    const base = `mtrack-gmail-${hash}`;
    return {
        html: `${base}.html`,
        pdf:  `${base}.pdf`,
    };
}