export function downloadHTML(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function downloadCSV(content: string, filename: string) {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function generateFilename(mode: 'receipt' | 'ledger' | 'summary', range: string, ext: 'html' | 'csv'): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(':').slice(0, 2).join('');
    const sanitizedRange = range.toLowerCase().replace(/\s+/g, '-');
    return `mpesa-${mode}-${sanitizedRange}-${dateStr}-${timeStr}.${ext}`;
}
