import { ParsedTransaction } from '../types';

export function generateReceiptHTML(transactions: ParsedTransaction[], dateRange: string): string {
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const totalSent = transactions
        .filter(t => t.type === 'sent')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const totalReceived = transactions
        .filter(t => t.type === 'received')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const net = totalReceived - totalSent;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-PESA Receipt</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1, h2 {
            text-align: center;
            margin: 0;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        h2 {
            font-size: 16px;
            font-weight: normal;
            color: #666;
            margin-bottom: 20px;
        }
        .summary {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .summary-item {
            display: flex;
            justify-content: space-between;
        }
        .summary-item.total {
            font-weight: bold;
            border-top: 1px solid #ddd;
            padding-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        th {
            text-align: left;
            background: #f0f0f0;
            padding: 8px;
            border-bottom: 1px solid #ddd;
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #eee;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #999;
            margin-top: 20px;
        }
        @media print {
            body {
                padding: 0;
            }
            .summary {
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <h1>M-PESA Reimbursement Receipt</h1>
    <h2>Generated on ${currentDate}</h2>
    <h2>Period: ${dateRange}</h2>

    <div class="summary">
        <div class="summary-grid">
            <div class="summary-item">
                <span>Total Sent:</span>
                <span>Ksh ${totalSent.toFixed(2)}</span>
            </div>
            <div class="summary-item">
                <span>Total Received:</span>
                <span>Ksh ${totalReceived.toFixed(2)}</span>
            </div>
            <div class="summary-item total">
                <span>Net Amount:</span>
                <span>Ksh ${net.toFixed(2)}</span>
            </div>
            <div class="summary-item">
                <span>Transactions:</span>
                <span>${transactions.length}</span>
            </div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Code</th>
                <th>Description</th>
                <th>Sent (Ksh)</th>
                <th>Received (Ksh)</th>
                <th>Balance</th>
            </tr>
        </thead>
        <tbody>
            ${transactions.map(t => `
                <tr>
                    <td>${t.date.toLocaleDateString('en-GB')}</td>
                    <td>${t.time}</td>
                    <td>${t.transactionCode}</td>
                    <td>${t.type === 'received' ? 'From: ' : 'To: '}${t.recipient}</td>
                    <td>${t.type === 'sent' ? t.amount.toFixed(2) : ''}</td>
                    <td>${t.type === 'received' ? t.amount.toFixed(2) : ''}</td>
                    <td>${t.balance ? t.balance.toFixed(2) : ''}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <div class="footer">
        This document was generated from M-PESA SMS confirmations
    </div>
</body>
</html>`;
}
