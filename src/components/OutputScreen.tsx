import { ParsedTransaction } from '../types';
import { generateReceiptHTML } from '../lib/receiptGenerator';
import { generateLedgerCSV, generateLedgerSummaryCSV } from '../lib/ledgerGenerator';
import { downloadHTML, downloadCSV, generateFilename } from '../lib/downloadUtils';
import { CheckCircle2 } from 'lucide-react';

interface OutputScreenProps {
    mode: 'receipt' | 'ledger';
    range: string;
    transactions: ParsedTransaction[];
    dateRangeLabel: string;
    onReset: () => void;
}

export function OutputScreen({ mode, range, transactions, dateRangeLabel, onReset }: OutputScreenProps) {
    // Calculate statistics
    const totalTransactions = transactions.length;
    const totalSent = transactions
        .filter(t => t.type === 'sent')
        .reduce((sum, t) => sum + t.amount, 0);
    const totalReceived = transactions
        .filter(t => t.type === 'received')
        .reduce((sum, t) => sum + t.amount, 0);
    const netAmount = totalReceived - totalSent;

    // Format currency with commas
    const formatCurrency = (amount: number) => {
        return `Ksh ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
    };

    // Handle downloads
    const handleDownloadReceipt = () => {
        const htmlContent = generateReceiptHTML(transactions, dateRangeLabel);
        const filename = generateFilename('receipt', range);
        downloadHTML(htmlContent, filename);
    };

    const handleDownloadFullLedger = () => {
        const csvContent = generateLedgerCSV(transactions, dateRangeLabel);
        const filename = generateFilename('ledger', range);
        downloadCSV(csvContent, filename);
    };

    const handleDownloadSummaryLedger = () => {
        const csvContent = generateLedgerSummaryCSV(transactions);
        const filename = generateFilename('summary', range);
        downloadCSV(csvContent, filename);
    };

    if (transactions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <div className="max-w-md w-full space-y-6 text-center">
                    <div className="text-gray-400">
                        <CheckCircle2 className="w-16 h-16 mx-auto" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">No M-PESA messages detected</h2>
                    <p className="text-gray-600">
                        Make sure you pasted the full confirmation messages.
                    </p>
                    <button
                        onClick={onReset}
                        className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // Preview transactions
    const previewTransactions = transactions.slice(0, 5);
    const remainingCount = transactions.length - 5;

    return (
        <div className="flex flex-col min-h-screen animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Persistent Header */}
            <div className="sticky top-0 z-10 h-14 bg-white border-b border-gray-200 flex items-center px-4">
                <div className="flex-1 text-center">
                    <span className="text-sm font-medium text-gray-900">M-PESA Manager</span>
                </div>
                <div className="w-10"></div> {/* Spacer for balance */}
            </div>

            <div className="flex-1 p-4">
                <div className="max-w-4xl mx-auto w-full space-y-8">
                    {/* Success Header */}
                    <div className="text-center space-y-4">
                        <div className="flex justify-center">
                            <CheckCircle2 className="w-16 h-16 text-[#00A651]" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            {mode === 'receipt' ? 'Receipt Ready' : 'Ledger Ready'}
                        </h1>
                        <p className="text-gray-600">
                            Showing {totalTransactions} transactions for {dateRangeLabel}
                        </p>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-6 rounded-lg border shadow-sm">
                            <h3 className="text-sm font-medium text-gray-500">Total Transactions</h3>
                            <p className="text-2xl font-bold text-gray-900">{totalTransactions}</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg border shadow-sm">
                            <h3 className="text-sm font-medium text-gray-500">Total Sent</h3>
                            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSent)}</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg border shadow-sm">
                            <h3 className="text-sm font-medium text-gray-500">Total Received</h3>
                            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalReceived)}</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg border shadow-sm">
                            <h3 className="text-sm font-medium text-gray-500">Net Amount</h3>
                            <p className={`text-2xl font-bold ${netAmount >= 0 ? 'text-[#00A651]' : 'text-red-600'}`}>
                                {formatCurrency(netAmount)}
                            </p>
                        </div>
                    </div>

                    {/* Transaction Preview */}
                    <div className="overflow-x-auto">
                        <div className="text-sm font-medium text-gray-500 mb-2">Recent Transactions</div>
                        <table className="w-full border-collapse border border-gray-200 rounded-lg overflow-hidden">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="border border-gray-200 p-2 text-left">Date</th>
                                    <th className="border border-gray-200 p-2 text-left">Type</th>
                                    <th className="border border-gray-200 p-2 text-left">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewTransactions.map((t, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="border border-gray-200 p-2">{t.date.toLocaleDateString('en-GB')}</td>
                                        <td className="border border-gray-200 p-2 capitalize">{t.type}</td>
                                        <td className="border border-gray-200 p-2">{formatCurrency(t.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {remainingCount > 0 && (
                            <div className="text-center text-sm text-gray-500 mt-2">
                                + {remainingCount} more transaction{remainingCount !== 1 ? 's' : ''}
                            </div>
                        )}
                    </div>

                    {/* Download Section */}
                    <div className="space-y-6">
                        {mode === 'receipt' ? (
                            <>
                                <button
                                    onClick={handleDownloadReceipt}
                                    className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                                >
                                    Download Receipt (HTML)
                                </button>
                                <p className="text-sm text-gray-500 text-center">
                                    Opens in any browser, printable as PDF
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="space-y-4">
                                    <button
                                        onClick={handleDownloadFullLedger}
                                        className="w-full min-h-[48px] py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008a43] transition-colors"
                                    >
                                        Download Full Ledger (CSV)
                                    </button>
                                    <button
                                        onClick={handleDownloadSummaryLedger}
                                        className="w-full min-h-[48px] py-3 px-4 bg-white text-[#00A651] font-medium rounded-lg border border-[#00A651] hover:bg-gray-50 transition-colors"
                                    >
                                        Download Daily Summary (CSV)
                                    </button>
                                </div>
                                <p className="text-sm text-gray-500 text-center">
                                    Compatible with Excel, Google Sheets, and KRA filing systems
                                </p>
                            </>
                        )}
                    </div>

                    {/* Start Over Button */}
                    <div className="pt-8 border-t">
                        <button
                            onClick={onReset}
                            className="w-full min-h-[48px] py-3 px-4 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Start Over
                        </button>
                    </div>

                    {/* Footer note */}
                    <div className="text-center text-xs text-gray-400 pt-4">
                        Powered by M-PESA SMS data
                    </div>
                </div>
            </div>
        </div>
    );
}
