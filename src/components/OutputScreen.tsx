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
            <div className="flex flex-col items-center justify-center min-h-screen p-4">
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
                        className="w-full py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008F46] transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen p-4">
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

                {/* Download Section */}
                <div className="space-y-6">
                    {mode === 'receipt' ? (
                        <>
                            <button
                                onClick={handleDownloadReceipt}
                                className="w-full py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008F46] transition-colors"
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
                                    className="w-full py-3 px-4 bg-[#00A651] text-white font-medium rounded-lg hover:bg-[#008F46] transition-colors"
                                >
                                    Download Full Ledger (CSV)
                                </button>
                                <button
                                    onClick={handleDownloadSummaryLedger}
                                    className="w-full py-3 px-4 bg-white text-[#00A651] font-medium rounded-lg border border-[#00A651] hover:bg-gray-50 transition-colors"
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
                        className="w-full py-3 px-4 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        Start Over
                    </button>
                </div>
            </div>
        </div>
    );
}
