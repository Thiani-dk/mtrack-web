import type { ParsedTransaction } from '../types';

function getDescription(t: ParsedTransaction): string {
    switch (t.subType) {
        case 'person_receive': return `Received from: ${t.recipient}`;
        case 'person_send':    return `Sent to: ${t.recipient}`;
        case 'paybill':        return `Paid to: ${t.recipient}`;
        case 'airtime':        return 'Airtime purchase';
        case 'withdrawal':     return t.recipient; // already "Withdrawal: AGENT NAME"
        case 'mshwari':        return 'M-Shwari savings transfer';
        default:               return t.recipient;
    }
}

export function generateReceiptHTML(transactions: ParsedTransaction[], dateRange: string): string {
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-GB', {
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

    const mshwariTotal = transactions
        .filter(t => t.subType === 'mshwari')
        .reduce((sum, t) => sum + t.amount, 0);

    const withdrawalTotal = transactions
        .filter(t => t.subType === 'withdrawal')
        .reduce((sum, t) => sum + t.amount, 0);

    const paybillTotal = transactions
        .filter(t => t.subType === 'paybill')
        .reduce((sum, t) => sum + t.amount, 0);

    const airtimeTotal = transactions
        .filter(t => t.subType === 'airtime')
        .reduce((sum, t) => sum + t.amount, 0);

    const personSendTotal = transactions
        .filter(t => t.subType === 'person_send')
        .reduce((sum, t) => sum + t.amount, 0);

    // Net excludes M-Shwari (savings movement, not true expenditure)
    const trueOutflow = totalSent - mshwariTotal;
    const net = totalReceived - trueOutflow;

    const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M-PESA Reimbursement Receipt</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #333;
            max-width: 860px;
            margin: 0 auto;
            padding: 24px 20px;
        }
        .header { text-align: center; margin-bottom: 24px; }
        .header h1 { font-size: 22px; margin: 0 0 4px; color: #111; }
        .header .green { color: #00A651; }
        .header p { margin: 2px 0; color: #666; font-size: 13px; }
        .summary {
            background: #f8f8f8;
            border: 1px solid #e5e5e5;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
        }
        .summary h2 {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #888;
            margin: 0 0 12px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px 24px;
        }
        .summary-item {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            padding: 4px 0;
            border-bottom: 1px solid #eee;
        }
        .summary-item:last-child { border-bottom: none; }
        .summary-item .label { color: #555; }
        .summary-item .value { font-weight: 500; }
        .summary-divider {
            grid-column: 1 / -1;
            border-top: 1px solid #ddd;
            margin: 4px 0;
        }
        .net-row {
            grid-column: 1 / -1;
            display: flex;
            justify-content: space-between;
            font-weight: 700;
            font-size: 14px;
            padding: 8px 0 0;
        }
        .mshwari-note {
            grid-column: 1 / -1;
            font-size: 12px;
            color: #888;
            padding-top: 6px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
            font-size: 13px;
        }
        thead th {
            text-align: left;
            background: #f0f0f0;
            padding: 8px 10px;
            border-bottom: 2px solid #ddd;
            font-weight: 600;
            white-space: nowrap;
        }
        td {
            padding: 7px 10px;
            border-bottom: 1px solid #eee;
            vertical-align: top;
        }
        tr:nth-child(even) td { background: #fafafa; }
        .amount-sent  { color: #dc2626; text-align: right; }
        .amount-recv  { color: #00A651; text-align: right; }
        .amount-bal   { text-align: right; color: #555; }
        .code { font-family: monospace; font-size: 12px; color: #888; }
        .badge {
            display: inline-block;
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 3px;
            font-weight: 500;
        }
        .badge-sent     { background: #fee2e2; color: #991b1b; }
        .badge-received { background: #dcfce7; color: #166534; }
        .badge-paybill  { background: #e0f2fe; color: #075985; }
        .badge-airtime  { background: #fef9c3; color: #854d0e; }
        .badge-withdraw { background: #f3e8ff; color: #6b21a8; }
        .badge-mshwari  { background: #f0fdf4; color: #166534; }
        .footer {
            text-align: center;
            font-size: 11px;
            color: #bbb;
            border-top: 1px solid #eee;
            padding-top: 16px;
            margin-top: 8px;
        }
        @media print {
            body { padding: 0; font-size: 12px; }
            .badge { border: 1px solid currentColor; }
        }
        @media (max-width: 600px) {
            .summary-grid { grid-template-columns: 1fr; }
            thead th:nth-child(3),
            td:nth-child(3) { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>M-PESA <span class="green">Reimbursement Receipt</span></h1>
        <p>Generated on ${currentDate}</p>
        <p>Period: ${dateRange}</p>
    </div>

    <div class="summary">
        <h2>Summary</h2>
        <div class="summary-grid">

            <div class="summary-item">
                <span class="label">Total transactions</span>
                <span class="value">${transactions.length}</span>
            </div>
            <div class="summary-item">
                <span class="label">Total received</span>
                <span class="value" style="color:#00A651">Ksh ${fmt(totalReceived)}</span>
            </div>

            <div class="summary-divider"></div>

            <div class="summary-item">
                <span class="label">Sent to people</span>
                <span class="value">Ksh ${fmt(personSendTotal)}</span>
            </div>
            <div class="summary-item">
                <span class="label">Paybill &amp; Till</span>
                <span class="value">Ksh ${fmt(paybillTotal)}</span>
            </div>
            <div class="summary-item">
                <span class="label">Airtime</span>
                <span class="value">Ksh ${fmt(airtimeTotal)}</span>
            </div>
            <div class="summary-item">
                <span class="label">Cash withdrawals</span>
                <span class="value">Ksh ${fmt(withdrawalTotal)}</span>
            </div>
            <div class="summary-item">
                <span class="label">M-Shwari transfers</span>
                <span class="value">Ksh ${fmt(mshwariTotal)}</span>
            </div>

            <div class="summary-divider"></div>

            <div class="net-row">
                <span>Net flow (excl. M-Shwari)</span>
                <span style="color:${net >= 0 ? '#00A651' : '#dc2626'}">
                    ${net >= 0 ? '' : '-'}Ksh ${fmt(Math.abs(net))}
                </span>
            </div>
            <p class="mshwari-note">
                M-Shwari transfers are savings movements and are excluded from the net flow calculation.
            </p>

        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Code</th>
                <th>Description</th>
                <th style="text-align:right">Sent (Ksh)</th>
                <th style="text-align:right">Received (Ksh)</th>
                <th style="text-align:right">Balance</th>
            </tr>
        </thead>
        <tbody>
            ${transactions.map(t => {
                const badgeClass =
                    t.subType === 'person_receive' ? 'badge-received' :
                    t.subType === 'paybill'        ? 'badge-paybill'  :
                    t.subType === 'airtime'        ? 'badge-airtime'  :
                    t.subType === 'withdrawal'     ? 'badge-withdraw' :
                    t.subType === 'mshwari'        ? 'badge-mshwari'  :
                    'badge-sent';
                const badgeLabel =
                    t.subType === 'person_receive' ? 'Received'   :
                    t.subType === 'person_send'    ? 'Send'       :
                    t.subType === 'paybill'        ? 'Paybill'    :
                    t.subType === 'airtime'        ? 'Airtime'    :
                    t.subType === 'withdrawal'     ? 'Withdrawal' :
                    t.subType === 'mshwari'        ? 'M-Shwari'  :
                    t.type;
                return `
                <tr>
                    <td>${t.date.toLocaleDateString('en-GB')}</td>
                    <td>${t.time}</td>
                    <td class="code">${t.transactionCode}</td>
                    <td>
                        <span class="badge ${badgeClass}">${badgeLabel}</span>
                        <br><span style="font-size:12px">${getDescription(t)}</span>
                    </td>
                    <td class="amount-sent">${t.type === 'sent' ? fmt(t.amount) : ''}</td>
                    <td class="amount-recv">${t.type === 'received' ? fmt(t.amount) : ''}</td>
                    <td class="amount-bal">${t.balance != null ? fmt(t.balance) : ''}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>

    <div class="footer">
        Generated from M-PESA SMS confirmations &nbsp;|&nbsp; ${currentDate}
    </div>
</body>
</html>`;
}