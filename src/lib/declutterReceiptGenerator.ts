import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DeclutterCommand } from '../types';

const APP_URL = 'https://mtrack.vercel.app';
const W = 42;

function repeat(char: string, n: number): string {
    return char.repeat(n);
}

function center(text: string, width: number): string {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, width: number): string {
    const gap = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(gap) + right;
}

export function generateDeclutterReceiptHTML(commands: DeclutterCommand[]): string {
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const lines: string[] = [
        repeat('=', W),
        center('M-TRACK', W),
        center('Gmail Declutter Receipt', W),
        repeat('-', W),
        center(currentDate.toUpperCase(), W),
        center(currentTime, W),
        repeat('=', W),
        '',
        center('ITEMS NUKED TODAY', W),
        repeat('-', W),
    ];

    commands.forEach((cmd, i) => {
        const num = String(i + 1).padStart(2, '0');
        lines.push(`${num}. ${cmd.label.toUpperCase()}`);
        lines.push(`    CMD: ${cmd.command}`);
        lines.push(`    EST: ${cmd.estimate}`);
        if (cmd.irreversible) lines.push(`    ⚠  IRREVERSIBLE — DOUBLE-CHECK FIRST`);
        lines.push(repeat('-', W));
    });

    lines.push('');
    lines.push(leftRight('TOTAL COMMANDS', String(commands.length), W));
    lines.push(repeat('=', W));
    lines.push('');
    lines.push(center('YOUR INBOX HAS BEEN SENTENCED.', W));
    lines.push(center('EXECUTE WHEN READY.', W));
    lines.push('');
    lines.push(repeat('=', W));
    lines.push(center('SHARE M-TRACK', W));
    lines.push(center(APP_URL, W));
    lines.push(repeat('=', W));
    lines.push(center('DECLUTTERED BY M-TRACK', W));
    lines.push(repeat('=', W));

    const receiptText = lines.join('\n');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-TRACK Gmail Receipt</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #e8e8e8;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            padding: 32px 16px;
            font-family: 'Courier New', Courier, monospace;
        }
        .receipt-wrap { position: relative; }
        .tear-top {
            width: 100%; height: 18px; background: white;
            clip-path: polygon(0% 100%, 2% 20%, 4% 80%, 6% 10%, 8% 70%, 10% 5%, 12% 65%, 14% 15%, 16% 75%, 18% 0%, 20% 60%, 22% 10%, 24% 70%, 26% 5%, 28% 65%, 30% 20%, 32% 80%, 34% 5%, 36% 70%, 38% 15%, 40% 75%, 42% 0%, 44% 60%, 46% 20%, 48% 80%, 50% 10%, 52% 65%, 54% 5%, 56% 70%, 58% 20%, 60% 80%, 62% 10%, 64% 75%, 66% 0%, 68% 60%, 70% 20%, 72% 80%, 74% 5%, 76% 70%, 78% 15%, 80% 75%, 82% 10%, 84% 65%, 86% 0%, 88% 60%, 90% 20%, 92% 80%, 94% 10%, 96% 70%, 98% 15%, 100% 80%, 100% 100%);
        }
        .receipt { background: white; padding: 8px 28px 24px; width: 340px; box-shadow: 2px 4px 24px rgba(0,0,0,0.15); }
        .tear-bottom {
            width: 100%; height: 18px; background: white;
            clip-path: polygon(0% 0%, 2% 80%, 4% 20%, 6% 90%, 8% 30%, 10% 95%, 12% 35%, 14% 85%, 16% 25%, 18% 100%, 20% 40%, 22% 90%, 24% 30%, 26% 95%, 28% 35%, 30% 80%, 32% 20%, 34% 95%, 36% 30%, 38% 85%, 40% 25%, 42% 100%, 44% 40%, 46% 80%, 48% 20%, 50% 90%, 52% 35%, 54% 95%, 56% 30%, 58% 80%, 60% 20%, 62% 90%, 64% 25%, 66% 100%, 68% 40%, 70% 80%, 72% 20%, 74% 95%, 76% 30%, 78% 85%, 80% 25%, 82% 90%, 84% 35%, 86% 100%, 88% 40%, 90% 80%, 92% 20%, 94% 90%, 96% 30%, 98% 85%, 100% 20%, 100% 0%);
        }
        pre { font-family: 'Courier New', Courier, monospace; font-size: 11.5px; line-height: 1.55; color: #1a1a1a; white-space: pre; overflow-x: auto; }
        .qr-block { text-align: center; padding: 12px 0 4px; }
        .qr-block img { width: 120px; height: 120px; }
        @media print {
            body { background: white; padding: 0; }
            .tear-top, .tear-bottom { display: none; }
            .receipt { box-shadow: none; width: 100%; padding: 0; }
            pre { font-size: 10px; }
        }
    </style>
</head>
<body>
    <div class="receipt-wrap">
        <div class="tear-top"></div>
        <div class="receipt">
            <pre>${receiptText}</pre>
            <div class="qr-block" id="qr"></div>
        </div>
        <div class="tear-bottom"></div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
        new QRCode(document.getElementById('qr'), {
            text: '${APP_URL}',
            width: 120,
            height: 120,
            colorDark: '#1a1a1a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
        });
    </script>
</body>
</html>`;
}

export async function generateDeclutterReceiptPDF(commands: DeclutterCommand[]): Promise<Blob> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 297] });

    const now = new Date();
    const currentDate = now.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const pageW = 80;
    const margin = 4;
    let y = 6;
    const lineH = 4;

    function addLine(text: string, size = 8, bold = false, align: 'left' | 'center' | 'right' = 'left') {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        if (align === 'center') doc.text(text, pageW / 2, y, { align: 'center' });
        else if (align === 'right') doc.text(text, pageW - margin, y, { align: 'right' });
        else doc.text(text, margin, y);
        y += lineH;
    }

    function addDivider(char = '-') { addLine(char.repeat(38), 7); }

    function addLR(left: string, right: string, size = 8, bold = false) {
        doc.setFontSize(size);
        doc.setFont('Courier', bold ? 'bold' : 'normal');
        doc.text(left, margin, y);
        doc.text(right, pageW - margin, y, { align: 'right' });
        y += lineH;
    }

    // Header
    addDivider('=');
    addLine('M-TRACK', 14, true, 'center');
    addLine('Gmail Declutter Receipt', 8, false, 'center');
    addDivider('=');
    addLine(currentDate.toUpperCase(), 7, false, 'center');
    addLine(currentTime, 7, false, 'center');
    addDivider('=');
    y += 2;

    // Commands
    addLine('ITEMS NUKED TODAY', 8, true, 'center');
    addDivider();

    commands.forEach((cmd, i) => {
        const num = String(i + 1).padStart(2, '0');
        addLine(`${num}. ${cmd.label.toUpperCase()}`, 8, true);
        // Break long command strings across lines (max ~36 chars at this font/width)
        const maxChars = 36;
        const cmdStr = `    CMD: ${cmd.command}`;
        if (cmdStr.length <= maxChars) {
            addLine(cmdStr, 7);
        } else {
            // first segment
            addLine(`    CMD: ${cmd.command.substring(0, maxChars - 9)}`, 7);
            // continuation
            let rest = cmd.command.substring(maxChars - 9);
            while (rest.length > 0) {
                addLine(`         ${rest.substring(0, maxChars - 9)}`, 7);
                rest = rest.substring(maxChars - 9);
            }
        }
        addLine(`    EST: ${cmd.estimate}`, 7);
        if (cmd.irreversible) addLine('    ⚠ IRREVERSIBLE — CHECK FIRST', 7, true);
        addDivider();
    });

    y += 2;
    addLR('TOTAL COMMANDS', String(commands.length), 9, true);
    addDivider('=');
    y += 2;
    addLine('YOUR INBOX HAS BEEN', 8, true, 'center');
    addLine('SENTENCED.', 8, true, 'center');
    addLine('EXECUTE WHEN READY.', 7, false, 'center');
    y += 4;
    addDivider('=');
    addLine('SHARE M-TRACK', 8, true, 'center');

    // QR code — generate as data URL then embed as image
    try {
        const qrDataUrl = await QRCode.toDataURL(APP_URL, {
            width: 200,
            margin: 1,
            color: { dark: '#1a1a1a', light: '#ffffff' },
        });
        // Center a 25mm x 25mm QR block
        const qrSize = 25;
        const qrX = (pageW - qrSize) / 2;
        doc.addImage(qrDataUrl, 'PNG', qrX, y, qrSize, qrSize);
        y += qrSize + 2;
    } catch {
        addLine(APP_URL, 7, false, 'center');
    }

    addLine(APP_URL, 7, false, 'center');
    addDivider('=');
    addLine('DECLUTTERED BY M-TRACK', 7, false, 'center');
    addDivider('=');

    return doc.output('blob');
}