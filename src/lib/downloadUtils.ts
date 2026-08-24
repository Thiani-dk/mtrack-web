import type { ParsedTransaction } from '../types';

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

// Stable content fingerprint for a set of transactions — used to dedupe
// receipt history entries (same underlying data shouldn't be saved twice).
export async function getReceiptFingerprint(transactions: ParsedTransaction[]): Promise<string> {
    return sha256Hash(transactionFingerprint(transactions));
}

// ── Filename generators ───────────────────────────────────────────────────────

export async function getReceiptFilenames(
    transactions: ParsedTransaction[]
): Promise<{ html: string; pdf: string }> {
    const hash = await sha256Hash(transactionFingerprint(transactions));
    const base = `mtrack-receipt-${hash}`;
    return {
        html: `${base}.html`,
        pdf:  `${base}.pdf`,
    };
}
