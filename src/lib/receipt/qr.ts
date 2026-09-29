import QRCode from 'qrcode';

// The receipt's QR code encodes its own facts directly (see model.ts's
// buildQrFacts) rather than a live URL — a scanner has to be able to confirm
// "this reference, this amount, this date really are what the paper says"
// with no network at all, matching this app's own offline constraint. Every
// other document's QR (receiptGenerator.ts) points at a static marketing
// URL; the receipt is the one document actually handed to someone else, so
// it is the one that needs to carry its own proof rather than a link.
export function buildReceiptQrDataUrl(facts: string): Promise<string> {
    return QRCode.toDataURL(facts, { margin: 1, width: 280 });
}
