import { ParsedTransaction } from '../types';
import { generateReceiptHTML } from '../lib/receiptGenerator';
import { generateLedgerCSV, generateLedgerSummaryCSV } from '../lib/ledgerGenerator';
import { downloadHTML, downloadCSV, generateFilename } from '../lib/downloadUtils';
import { ArrowLeft, CheckCircle2, Inbox } from 'lucide-react';

interface OutputScreenProps {
    mode: 'receipt' | 'ledger';
    range: string;
    transactions: ParsedTransaction[];
    dateRangeLabel: string;
    onReset: () => void;
    onBack: () => void;
}

export function OutputScreen({ mode, range, transactions, dateRangeLabel, onReset, onBack }: OutputScreenProps) {

    // --- Totals by subType ---
    const totalTransactions = transactions.length;

    const totalReceived = transactions
        .filter(t => t.subType === 'person_receive')
        .reduce((sum, t) => sum + t.amount, 0);

    const personSendTotal = transactions
        .filter(t => t.subType === 'person_send')
        .reduce((sum, t) => sum + t.amount, 0);

    const paybillTotal = transactions
        .filter(t => t.subType === 'paybill')
        .reduce((sum, t) => sum + t.amount, 0);

    const airtimeTotal = transactions
        .filter(t => t.subType === 'airtime')
        .reduce((sum, t) => sum + t.amount, 0);

    const withdrawalTotal = transactions
        .filter(t => t.subType === 'withdrawal')
        .reduce((sum, t) => sum + t.amount, 0);

    const mshwariTotal = transactions
        .filter(t => t.subType === 'mshwari')
        .reduce((sum, t) => sum + t.amount, 0);

    // M-Shwari excluded from net — it's a savings movement, not expenditure
    const trueOutflow = personSendTotal + paybillTotal + airtimeTotal + withdrawalTotal;
    const netFlow = totalReceived - trueOutflow;

    const fmt = (n: number) =>
        `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

    // --- Downloads ---
    const handleDownloadReceipt = () => {
        downloadHTML(generateReceiptHTML(transactions, dateRangeLabel), generateFilename('receipt', range, 'html'));
    };
    const handleDownloadFullLedger = () => {
        downloadCSV(generateLedgerCSV(transactions, dateRangeLabel), generateFilename('ledger', range, 'csv'));
    };
    const handleDownloadSummaryLedger = () => {
        downloadCSV(generateLedgerSummaryCSV(transactions), generateFilename('summary', range, 'csv'));
    };

    // --- subType label + colour for preview table ---
    const subTypeLabel = (t: ParsedTransaction): string => {
        switch (t.subType) {
            case 'person_send':    return 'Send';
            case 'person_receive': return 'Received';
            case 'paybill':        return 'Paybill';
            case 'airtime':        return 'Airtime';
            case 'withdrawal':     return 'Withdrawal';
            case 'mshwari':        return 'M-Shwari';
            default:               return t.type;
        }
    };
    const subTypeBadgeClass = (t: ParsedTransaction): string => {
        switch (t.subType) {
            case 'person_receive': return 'bg-green-100 text-green-800';
            case 'paybill':        return 'bg-blue-100 text-blue-800';
            case 'airtime':        return 'bg-yellow-100 text-yellow-800';
            case 'withdrawal':     return 'bg-purple-100 text-purple-800';
            case 'mshwari':        return 'bg-emerald-100 text-emerald-800';
            default:               return 'bg-red-100 text-red-800'; // person_send + unknown
        }
    };

    // --- Empty state ---
    if (totalTransactions === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <div className="max-w-md w-full space-y-4 text-center">
                    <Inbox className="w-16 h-16 mx-auto text-gray-300" />
                    <h2 className="text-xl font-bold text-gray-900">No M-PESA messages detected</h2>
                    <p className="text-gray-500 text-sm">
                        Make sure you pasted full M-PESA confirmation messages, or that your XML backup file is complete.
                    </p>
                    <button
                        onClick={onBack}
                        className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                    >
                        Go back and try again
                    </button>
                    <button
                        onClick={onReset}
                        className="w-full min-h-[48px] py-3 px-4 bg-white text-gray-600 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                    >
                        Start over
                    </button>
                </div>
            </div>
        );
    }

    const previewTransactions = transactions.slice(0, 5);
    const remainingCount = totalTransactions - 5;

    return (
        <div className="flex flex-col min-h-screen animate-in fade-in slide-in-from-bottom-4 duration-200">

            {/* Header */}
            <div className="sticky top-0 z-10 h-14 bg-white border-b border-gray-200 flex items-center px-4">
                <button
                    onClick={onBack}
                    className="flex items-center text-gray-600 hover:text-gray-900 min-w-[40px]"
                    aria-label="Go back"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-medium text-gray-900">M-PESA Manager</span>
                </div>
                <div className="min-w-[40px]" />
            </div>

            <div className="flex-1 p-4">
                <div className="max-w-md mx-auto w-full space-y-6">

                    {/* Success header */}
                    <div className="text-center space-y-2 pt-2">
                        <CheckCircle2 className="w-12 h-12 text-[#00A651] mx-auto" />
                        <h1 className="text-2xl font-bold text-gray-900">
                            {mode === 'receipt' ? 'Receipt ready' : 'Ledger ready'}
                        </h1>
                        <p className="text-sm text-gray-500">
                            {totalTransactions} transaction{totalTransactions !== 1 ? 's' : ''} — {dateRangeLabel}
                        </p>
                    </div>

                    {/* Stats breakdown */}
                    <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Breakdown</span>
                        </div>

                        {/* Received */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                                <span className="text-sm text-gray-700">Received</span>
                            </div>
                            <span className="text-sm font-semibold text-green-700">{fmt(totalReceived)}</span>
                        </div>

                        {/* Sent to people */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                                <span className="text-sm text-gray-700">Sent to people</span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{fmt(personSendTotal)}</span>
                        </div>

                        {/* Paybill & Till */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                                <span className="text-sm text-gray-700">Paybill &amp; Till</span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{fmt(paybillTotal)}</span>
                        </div>

                        {/* Airtime */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                                <span className="text-sm text-gray-700">Airtime</span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{fmt(airtimeTotal)}</span>
                        </div>

                        {/* Withdrawals */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                                <span className="text-sm text-gray-700">Cash withdrawals</span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{fmt(withdrawalTotal)}</span>
                        </div>

                        {/* M-Shwari — called out separately */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                <span className="text-sm text-gray-700">M-Shwari transfers</span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{fmt(mshwariTotal)}</span>
                        </div>

                        {/* Net flow */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-semibold text-gray-700">Net flow</span>
                            <span className={`text-sm font-bold ${netFlow >= 0 ? 'text-[#00A651]' : 'text-red-600'}`}>
                                {netFlow >= 0 ? '' : '-'}{fmt(Math.abs(netFlow))}
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 px-4 pb-3">
                            M-Shwari transfers excluded from net — savings movement, not expenditure.
                        </p>
                    </div>

                    {/* Transaction preview */}
                    <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Preview
                        </p>
                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="text-left p-3 font-medium text-gray-500 text-xs">Date</th>
                                        <th className="text-left p-3 font-medium text-gray-500 text-xs">Type</th>
                                        <th className="text-right p-3 font-medium text-gray-500 text-xs">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewTransactions.map((t, idx) => (
                                        <tr key={idx} className="border-b border-gray-100 last:border-0">
                                            <td className="p-3 text-xs text-gray-600">
                                                {t.date.toLocaleDateString('en-GB')}
                                            </td>
                                            <td className="p-3">
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${subTypeBadgeClass(t)}`}>
                                                    {subTypeLabel(t)}
                                                </span>
                                            </td>
                                            <td className={`p-3 text-xs font-medium text-right ${t.type === 'received' ? 'text-green-700' : 'text-gray-900'}`}>
                                                {fmt(t.amount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {remainingCount > 0 && (
                            <p className="text-center text-xs text-gray-400 mt-2">
                                + {remainingCount} more transaction{remainingCount !== 1 ? 's' : ''}
                            </p>
                        )}
                    </div>

                    {/* Download buttons */}
                    <div className="space-y-3">
                        {mode === 'receipt' ? (
                            <>
                                <button
                                    onClick={handleDownloadReceipt}
                                    className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                                >
                                    Download receipt (HTML)
                                </button>
                                <p className="text-xs text-gray-400 text-center">
                                    Open in any browser · print to PDF from there
                                </p>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={handleDownloadFullLedger}
                                    className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                                >
                                    Download full ledger (CSV)
                                </button>
                                <button
                                    onClick={handleDownloadSummaryLedger}
                                    className="w-full min-h-[48px] py-3 px-4 bg-white text-[#00A651] font-medium rounded-lg border border-[#00A651] hover:bg-gray-50 transition-colors"
                                >
                                    Download daily summary (CSV)
                                </button>
                                <p className="text-xs text-gray-400 text-center">
                                    Compatible with Excel, Google Sheets &amp; KRA filing
                                </p>
                            </>
                        )}
                    </div>

                    {/* Start over */}
                    <div className="border-t border-gray-100 pt-4 pb-8">
                        <button
                            onClick={onReset}
                            className="w-full min-h-[48px] py-3 px-4 bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Start over
                        </button>
                        <p className="text-center text-xs text-gray-400 mt-4">
                            Powered by M-PESA SMS data
                        </p>
                    </div>

                </div>
            </div>
        </div>
    );
}