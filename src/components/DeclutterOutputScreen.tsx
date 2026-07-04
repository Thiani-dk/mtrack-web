import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    Copy,
    Check,
    Download,
    FileText,
    AlertTriangle,
    ToggleLeft,
    ToggleRight,
    RefreshCw,
} from 'lucide-react';
import type { DeclutterCommand } from '../types';
import {
    generateDeclutterReceiptHTML,
    generateDeclutterReceiptPDF,
} from '../lib/declutterReceiptGenerator';
import { downloadHTML, downloadPDF, getGmailFilenames } from '../lib/downloadUtils';

interface Props {
    commands: DeclutterCommand[];
    onBack: () => void;
    onReset: () => void;
}

function groupByCategory(commands: DeclutterCommand[]): Record<string, DeclutterCommand[]> {
    return commands.reduce<Record<string, DeclutterCommand[]>>((acc, cmd) => {
        (acc[cmd.category] ??= []).push(cmd);
        return acc;
    }, {});
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [text]);

    return (
        <button
            onClick={handleCopy}
            title="Copy command"
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-indigo-100 transition-colors text-xs font-medium text-gray-500 hover:text-indigo-600"
        >
            <AnimatePresence mode="wait">
                {copied ? (
                    <motion.span
                        key="copied"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-emerald-600"
                    >
                        <Check className="w-3.5 h-3.5" /> Copied
                    </motion.span>
                ) : (
                    <motion.span
                        key="copy"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-1"
                    >
                        <Copy className="w-3.5 h-3.5" /> Copy
                    </motion.span>
                )}
            </AnimatePresence>
        </button>
    );
}

export function DeclutterOutputScreen({ commands: initialCommands, onBack, onReset }: Props) {
    const [commands, setCommands] = useState<DeclutterCommand[]>(initialCommands);
    const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);
    const [isDownloadingHTML, setIsDownloadingHTML] = useState(false);

    const included = commands.filter(c => c.included);
    const grouped = groupByCategory(commands);

    function toggleCommand(id: string) {
        setCommands(prev =>
            prev.map(c => c.id === id ? { ...c, included: !c.included } : c)
        );
    }

    async function handleDownloadHTML() {
        if (included.length === 0) return;
        setIsDownloadingHTML(true);
        try {
            const html = generateDeclutterReceiptHTML(included);
            const { html: filename } = await getGmailFilenames(included);
            downloadHTML(html, filename);
        } catch (err) {
            console.error('HTML generation failed:', err);
        } finally {
            setIsDownloadingHTML(false);
        }
    }

    async function handleDownloadPDF() {
        if (included.length === 0) return;
        setIsDownloadingPDF(true);
        try {
            const [blob, { pdf: filename }] = await Promise.all([
                generateDeclutterReceiptPDF(included),
                getGmailFilenames(included),
            ]);
            downloadPDF(blob, filename);
        } catch (err) {
            console.error('PDF generation failed:', err);
        } finally {
            setIsDownloadingPDF(false);
        }
    }

    const noneIncluded = included.length === 0;

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-gray-100 sticky top-0 z-10">
                <button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </button>
                <div className="flex-1">
                    <h1 className="text-base font-semibold text-gray-900">Your Gmail Commands</h1>
                    <p className="text-xs text-gray-400">
                        {included.length} of {commands.length} selected · tap to toggle
                    </p>
                </div>
                <button
                    onClick={onReset}
                    className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition-colors"
                    title="Start over"
                >
                    <RefreshCw className="w-4 h-4 text-gray-400" />
                </button>
            </div>

            {/* Instruction banner */}
            <div className="mx-4 mt-4 mb-2 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <p className="text-xs text-indigo-700 leading-relaxed">
                    Copy each command, paste it into Gmail's search bar, select all results, then delete.
                    Toggle off any command you don't want included in the receipt.
                </p>
            </div>

            {/* Command cards grouped by category */}
            <div className="flex-1 px-4 pb-6 space-y-5 mt-3">
                {Object.entries(grouped).map(([category, cmds]) => (
                    <div key={category}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">
                            {category}
                        </p>
                        <div className="space-y-2">
                            {cmds.map(cmd => (
                                <motion.div
                                    key={cmd.id}
                                    layout
                                    className={`bg-white rounded-xl border transition-all ${
                                        cmd.included
                                            ? 'border-gray-200 shadow-sm'
                                            : 'border-gray-100 opacity-50'
                                    }`}
                                >
                                    <div className="px-4 pt-3 pb-2">
                                        {/* Top row: label + toggle */}
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-2 flex-1">
                                                {cmd.irreversible && (
                                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                                )}
                                                <p className="text-sm font-semibold text-gray-900 leading-snug">
                                                    {cmd.label}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => toggleCommand(cmd.id)}
                                                className="flex-shrink-0 mt-0.5"
                                                aria-label={cmd.included ? 'Remove from receipt' : 'Add to receipt'}
                                            >
                                                {cmd.included
                                                    ? <ToggleRight className="w-5 h-5 text-indigo-500" />
                                                    : <ToggleLeft  className="w-5 h-5 text-gray-300" />
                                                }
                                            </button>
                                        </div>

                                        {/* Description */}
                                        <p className="text-xs text-gray-500 mb-2">{cmd.description}</p>

                                        {/* Command chip */}
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-[11px] font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 break-all leading-relaxed">
                                                {cmd.command}
                                            </code>
                                            <CopyButton text={cmd.command} />
                                        </div>

                                        {/* Estimate + warning */}
                                        <div className="flex items-center justify-between mt-2">
                                            <p className="text-[11px] text-gray-400">Est. {cmd.estimate}</p>
                                            {cmd.irreversible && (
                                                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                                    ⚠ Irreversible
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Download footer — sticky */}
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-4 space-y-2">
                {noneIncluded && (
                    <p className="text-xs text-center text-gray-400 mb-2">
                        Toggle at least one command on to generate a receipt.
                    </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <motion.button
                        onClick={handleDownloadHTML}
                        disabled={noneIncluded || isDownloadingHTML}
                        whileTap={{ scale: 0.96 }}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                            !noneIncluded && !isDownloadingHTML
                                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                        }`}
                    >
                        <FileText className="w-4 h-4" />
                        {isDownloadingHTML ? 'Generating…' : 'HTML Receipt'}
                    </motion.button>

                    <motion.button
                        onClick={handleDownloadPDF}
                        disabled={noneIncluded || isDownloadingPDF}
                        whileTap={{ scale: 0.96 }}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                            !noneIncluded && !isDownloadingPDF
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-indigo-200'
                                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                        }`}
                    >
                        <Download className="w-4 h-4" />
                        {isDownloadingPDF ? 'Generating…' : 'PDF Receipt'}
                    </motion.button>
                </div>
            </div>
        </div>
    );
}