import { renderReceiptPng } from './renderPng';
import type { ReceiptData } from './model';

// The receipt's "save as web page" export. Deliberately simpler than the
// other three document types' own renderDocHTML: rather than re-implement
// the positioned-primitives layout a THIRD time as hand-built HTML/CSS (on
// top of the canvas and DOM backends this document already has), this wraps
// the exact same PNG the canvas backend produces in a minimal, valid,
// offline-viewable page. The visual result is identical either way; this
// avoids a third place the three renderers could ever quietly disagree.
export async function generateReceiptHTML(data: ReceiptData): Promise<string> {
    const blob = await renderReceiptPng(data);
    const dataUrl = await blobToDataUrl(blob);
    const title = `Receipt ${data.receiptNumber}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #E7E4DA; }
  img { max-width: 480px; width: 100%; height: auto; display: block; }
</style>
</head>
<body>
<img src="${dataUrl}" alt="${escapeHtml(title)}">
</body>
</html>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('failed to read the rendered receipt image'));
        reader.readAsDataURL(blob);
    });
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
