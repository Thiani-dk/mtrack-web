import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { InputSource, TimeRange } from '../types';
import { formatCutoffDisplay } from '../lib/dateUtils';
import { AlertTriangle, ArrowLeft, ClipboardPaste, FileUp, CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface InputScreenProps {
    initialText?: string;
    range: TimeRange;
    cutoffDate: Date;
    onSubmit: (text: string, source: InputSource) => void;
    onBack: () => void;
}

export function InputScreen({ cutoffDate, initialText = '', onSubmit, onBack }: InputScreenProps) {
    const [smsText, setSmsText]         = useState(initialText);
    const [focused, setFocused]         = useState(false);
    const [xmlFile, setXmlFile]         = useState<File | null>(null);
    const [xmlError, setXmlError]       = useState<string | null>(null);
    const [activeTab, setActiveTab]     = useState<'paste' | 'upload'>('paste');
    const fileInputRef                  = useRef<HTMLInputElement>(null);

    const pasteReady  = activeTab === 'paste' && smsText.trim().length > 0;
    const uploadReady = activeTab === 'upload' && xmlFile !== null;
    const ready       = pasteReady || uploadReady;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setXmlError(null);
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.xml')) {
            setXmlError('Please select an .xml file.');
            return;
        }
        setXmlFile(file);
    };

    const handleSubmit = () => {
        if (activeTab === 'paste' && smsText.trim()) {
            onSubmit(smsText, 'manual');
        } else if (activeTab === 'upload' && xmlFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result;
                if (typeof text === 'string') {
                    onSubmit(text, 'xml');
                }
            };
            reader.onerror = () => setXmlError('Failed to read file. Please try again.');
            reader.readAsText(xmlFile);
        }
    };

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="glass-header sticky top-0 z-10 h-14 border-b border-[var(--border-glass)] flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    whileTap={{ scale: 0.88 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">M-Track</span>
                </div>
                <ThemeToggle />
            </div>

            <div className="flex-1 px-5 pt-6 pb-8 space-y-5">

                {/* Title */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <ClipboardPaste className="w-4 h-4 text-[var(--accent)]" />
                        <span className="text-xs font-semibold text-[var(--accent)] uppercase tracking-widest">Step 3</span>
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Add your messages</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                        We'll build your receipt from these.
                    </p>
                </motion.div>

                {/* Disclaimer */}
                <motion.div
                    className="rounded-2xl overflow-hidden"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="rounded-2xl p-4 space-y-2 border"
                        style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-border)' }}>
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warn-heading)' }} />
                            <span className="text-sm font-semibold" style={{ color: 'var(--warn-heading)' }}>Date limit</span>
                        </div>
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--warn-text)' }}>
                            Only include messages after{' '}
                            <span className="font-bold text-[var(--accent)]">{formatCutoffDisplay(cutoffDate)}</span>.
                            {' '}Any messages outside this range will be ignored.
                        </p>
                        <p className="text-xs" style={{ color: 'var(--warn-text-muted)' }}>
                            How to get your messages: open your SMS app, scroll back to that date,
                            then long-press to select and copy from there.
                        </p>
                    </div>
                </motion.div>

                {/* Tab switcher */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.13, type: 'spring', stiffness: 380, damping: 28 }}
                    className="flex bg-[var(--bg-elevated)] rounded-2xl p-1 gap-1"
                >
                    <button
                        onClick={() => setActiveTab('paste')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                            activeTab === 'paste'
                                ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
                                : 'text-[var(--text-secondary)]'
                        }`}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                        Paste messages
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                            activeTab === 'upload'
                                ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
                                : 'text-[var(--text-secondary)]'
                        }`}
                    >
                        <FileUp className="w-4 h-4" />
                        Upload XML
                    </button>
                </motion.div>

                <AnimatePresence mode="wait">

                    {/* ── Paste tab ── */}
                    {activeTab === 'paste' && (
                        <motion.div
                            key="paste"
                            className="space-y-2"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                        >
                            <motion.div
                                className="glass-card overflow-hidden transition-shadow duration-200"
                                animate={{
                                    borderColor: focused ? 'var(--accent)' : 'var(--border-glass)',
                                    boxShadow: focused
                                        ? '0 0 0 2px var(--accent-glow), 0 4px 20px var(--accent-glow)'
                                        : '0 0 0 0px transparent',
                                }}
                            >
                                <textarea
                                    value={smsText}
                                    onChange={e => setSmsText(e.target.value)}
                                    onFocus={() => setFocused(true)}
                                    onBlur={() => setFocused(false)}
                                    placeholder={"Drop your M-PESA messages here...\n\nWorks with copied messages or SMS backup files."}
                                    className="w-full p-4 border-0 rounded-2xl min-h-[200px] resize-none text-sm bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200"
                                />
                            </motion.div>

                            <div className="flex items-center justify-between px-1">
                                <p className="text-xs text-[var(--text-muted)]">
                                    {smsText.length > 0
                                        ? `${smsText.length.toLocaleString()} characters`
                                        : 'Copied messages or SMS backup'}
                                </p>
                                <AnimatePresence>
                                    {pasteReady && (
                                        <motion.span
                                            className="text-xs text-[var(--accent)] font-medium"
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            transition={{ type: 'spring', stiffness: 400 }}
                                        >
                                            Ready ✓
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Upload tab ── */}
                    {activeTab === 'upload' && (
                        <motion.div
                            key="upload"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                            className="space-y-3"
                        >
                            {/* How-to card */}
                            <div className="glass-card p-4 space-y-3">
                                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">How to get your XML backup</p>
                                <ol className="space-y-2.5">
                                    {[
                                        { n: '1', text: 'Download "SMS Backup & Restore" (free) from the Play Store.' },
                                        { n: '2', text: 'Open it, filter to the M-PESA sender, and run a backup — it saves an .xml file to your phone.' },
                                        { n: '3', text: 'Come back here, tap Upload below, and select that file.' },
                                    ].map(({ n, text }) => (
                                        <li key={n} className="flex items-start gap-3">
                                            <span className="flex-shrink-0 w-5 h-5 rounded-full text-[var(--accent)] text-xs font-bold flex items-center justify-center mt-0.5"
                                                style={{ background: 'var(--accent-subtle)' }}>
                                                {n}
                                            </span>
                                            <span className="text-sm text-[var(--text-secondary)] leading-snug">{text}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>

                            {/* Hidden file input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xml"
                                className="hidden"
                                onChange={handleFileChange}
                            />

                            {/* Upload button / file state */}
                            <AnimatePresence mode="wait">
                                {xmlFile ? (
                                    <motion.div
                                        key="file-ready"
                                        initial={{ opacity: 0, scale: 0.97 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.97 }}
                                        className="flex items-center gap-3 rounded-2xl px-4 py-3.5 border"
                                        style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}
                                    >
                                        <CheckCircle2 className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{xmlFile.name}</p>
                                            <p className="text-xs text-[var(--accent)]">Ready ✓</p>
                                        </div>
                                        <button
                                            onClick={() => { setXmlFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                            className="text-xs text-[var(--accent)] hover:opacity-80 font-medium flex-shrink-0"
                                        >
                                            Change
                                        </button>
                                    </motion.div>
                                ) : (
                                    <motion.button
                                        key="file-picker"
                                        initial={{ opacity: 0, scale: 0.97 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.97 }}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full min-h-[56px] rounded-2xl border-2 border-dashed border-[var(--border-glass)] bg-transparent flex items-center justify-center gap-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <FileUp className="w-4 h-4" />
                                        Select .xml file
                                    </motion.button>
                                )}
                            </AnimatePresence>

                            {/* Error */}
                            <AnimatePresence>
                                {xmlError && (
                                    <motion.p
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="text-xs text-red-500 px-1"
                                    >
                                        {xmlError}
                                    </motion.p>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Submit */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <motion.button
                        onClick={handleSubmit}
                        disabled={!ready}
                        className="btn-primary w-full min-h-[52px] rounded-2xl font-semibold text-[15px]"
                        whileTap={ready ? { scale: 0.97 } : {}}
                        animate={ready ? {
                            boxShadow: ['0 4px 16px rgba(232,133,10,0.25)', '0 6px 24px rgba(232,133,10,0.35)', '0 4px 16px rgba(232,133,10,0.25)'],
                        } : { boxShadow: '0 0px 0px rgba(0,0,0,0)' }}
                        transition={{ repeat: ready ? Infinity : 0, duration: 2.5, ease: 'easeInOut' }}
                    >
                        Generate Receipt
                    </motion.button>
                </motion.div>
            </div>
        </motion.div>
    );
}
