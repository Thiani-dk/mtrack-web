import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileText, Share2, Check } from 'lucide-react';
import type { ParsedTransaction } from '../../types';
import { generateReceiptHTML, generateReceiptPDF, summariseReceiptForShare } from '../../lib/receiptGenerator';
import { downloadHTML, downloadPDF, getReceiptFilenames } from '../../lib/downloadUtils';
import { share } from '../../lib/shareUtils';

interface ChatReceiptProps {
    transactions: ParsedTransaction[];
    dateRange: string;
    isDemo?: boolean;
}

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

type Busy = 'pdf' | 'html' | 'share' | null;

export function ChatReceipt({ transactions, dateRange, isDemo = false }: ChatReceiptProps) {
    const [busy, setBusy] = useState<Busy>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const active = transactions.filter(t => !t.excludedFromReceipt);
    const spent = active
        .filter(t => t.type === 'sent' && t.subType !== 'mshwari' && t.subType !== 'investment')
        .reduce((s, t) => s + t.amount, 0);

    const flash = (text: string) => {
        setNotice(text);
        setTimeout(() => setNotice(null), 3000);
    };

    const handleDownloadPDF = async () => {
        setBusy('pdf');
        try {
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(transactions, dateRange, isDemo),
                getReceiptFilenames(transactions),
            ]);
            downloadPDF(blob, filenames.pdf);
        } catch (err) {
            console.error('PDF download failed:', err);
            flash("Couldn't generate the PDF — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleDownloadHTML = async () => {
        setBusy('html');
        try {
            const [html, filenames] = await Promise.all([
                generateReceiptHTML(transactions, dateRange, isDemo),
                getReceiptFilenames(transactions),
            ]);
            downloadHTML(html, filenames.html);
        } catch (err) {
            console.error('HTML download failed:', err);
            flash("Couldn't generate the web page — try again.");
        } finally {
            setBusy(null);
        }
    };

    const handleShare = async () => {
        setBusy('share');
        try {
            const text = summariseReceiptForShare(transactions, dateRange);
            const [blob, filenames] = await Promise.all([
                generateReceiptPDF(transactions, dateRange, isDemo),
                getReceiptFilenames(transactions),
            ]);
            const result = await share({
                file: { blob, filename: filenames.pdf, mimeType: 'application/pdf' },
                title: 'Expense Summary',
                text,
            });
            if (result === 'copied') flash('Copied — paste it wherever.');
            else if (result === 'failed') flash('Unable to share on this device');
        } catch (err) {
            console.error('Share failed:', err);
            flash("Couldn't prepare that to share — try again.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[85%] w-full px-4 py-4">
                <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Your summary is ready</p>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                    {active.length} transaction{active.length !== 1 ? 's' : ''} · {dateRange} · {fmt(spent)} out
                </p>

                <div className="flex flex-col gap-2">
                    <motion.button
                        onClick={handleDownloadPDF}
                        disabled={busy !== null}
                        className="btn-primary min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                        whileTap={{ scale: 0.97 }}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {busy === 'pdf' ? 'Generating…' : 'Save as PDF'}
                    </motion.button>
                    <div className="flex gap-2">
                        <motion.button
                            onClick={handleDownloadHTML}
                            disabled={busy !== null}
                            className="btn-secondary flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
                            whileTap={{ scale: 0.97 }}
                        >
                            <Download className="w-3.5 h-3.5" />
                            {busy === 'html' ? 'Generating…' : 'Save as web page'}
                        </motion.button>
                        <motion.button
                            onClick={handleShare}
                            disabled={busy !== null}
                            className="flex-1 min-h-[40px] rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 border transition-colors disabled:opacity-50"
                            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                            whileTap={{ scale: 0.97 }}
                        >
                            <Share2 className="w-3.5 h-3.5" />
                            {busy === 'share' ? 'Preparing…' : 'Share'}
                        </motion.button>
                    </div>
                </div>

                <AnimatePresence>
                    {notice && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="text-xs mt-2 flex items-center gap-1"
                            style={{ color: 'var(--accent)' }}
                        >
                            <Check className="w-3 h-3" />
                            {notice}
                        </motion.p>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
