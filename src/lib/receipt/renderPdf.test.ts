import { describe, expect, it } from 'vitest';
import { renderReceiptPdf } from './renderPdf';
import { buildReceiptData } from './model';
import type { TrackedDocument } from '../../types';
import { captureFromPaste } from '../activeMode/session';

// A smoke test for the receipt's PDF backend: it actually produces a real,
// non-trivial PDF from real data, with no thrown error — the geometry itself
// is already proven in layout.test.ts against the deterministic estimator;
// this only checks the jsPDF wiring (font registration, image embedding)
// does not blow up end to end.

function fixtureDoc(): TrackedDocument {
    const raw = 'QA01XK9P2L Confirmed. You have received Ksh350.00 from JOHN KAMAU '
        + '0712345678 on 29/9/26 at 1:05 PM. New M-PESA balance is Ksh20000.00.';
    const t = captureFromPaste(raw).transaction;
    if (!t) throw new Error('fixture did not parse');
    return {
        id: 'pos-1', createdAt: Date.now(), updatedAt: Date.now(), status: 'approved',
        documentType: 'point_of_sale', dataSource: 'sms_verified', transactions: [t],
        merchantProfile: { businessName: 'Mama Chapo', contact: '0712345678' }, onBehalfOf: null,
        coveringFrom: null, coveringTo: null, capturedViaActiveMode: false, activeMode: null,
        receiptNumber: 'MT260929-ABCDE', servedBy: null, tip: null, discount: null,
    };
}

describe('renderReceiptPdf', () => {
    it('produces a real PDF document with no thrown error', async () => {
        const data = buildReceiptData(fixtureDoc());
        const doc = await renderReceiptPdf(data);
        const blob = doc.output('blob');
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('is deterministic in size for the same input (no random padding/whitespace drift)', async () => {
        const data = buildReceiptData(fixtureDoc());
        const a = (await renderReceiptPdf(data)).output('arraybuffer') as ArrayBuffer;
        const b = (await renderReceiptPdf(data)).output('arraybuffer') as ArrayBuffer;
        // jsPDF embeds a creation timestamp, so bytes are not byte-identical —
        // but a wildly different size would mean the fonts or the QR embed
        // silently failed on one run and not the other.
        expect(Math.abs(a.byteLength - b.byteLength)).toBeLessThan(50);
    });
});
