import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TimeRange } from '../types';
import { formatCutoffDisplay } from '../lib/dateUtils';
import { ArrowLeft, AlertTriangle, ClipboardPaste } from 'lucide-react';

interface InputScreenProps {
    mode: 'receipt' | 'ledger';
    range: TimeRange;
    cutoffDate: Date;
    onSubmit: (text: string) => void;
    onBack: () => void;
}

export function InputScreen({ mode, cutoffDate, onSubmit, onBack }: InputScreenProps) {
    const [smsText, setSmsText] = useState('');
    const [focused, setFocused] = useState(false);

    const handleSubmit = () => {
        if (smsText.trim()) onSubmit(smsText);
    };

    const ready = smsText.trim().length > 0;

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-white"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="sticky top-0 z-10 h-14 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 text-gray-600"
                    whileTap={{ scale: 0.88 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-gray-900">M-Track</span>
                </div>
                <div className="w-9" />
            </div>

            <div className="flex-1 px-5 pt-6 pb-8 space-y-5">

                {/* Title */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <ClipboardPaste className="w-4 h-4 text-[#00A651]" />
                        <span className="text-xs font-semibold text-[#00A651] uppercase tracking-widest">Step 3</span>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Add your messages</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {mode === 'receipt'
                            ? "We'll build your receipt from these."
                            : "We'll organise these into a ledger."}
                    </p>
                </motion.div>

                {/* Disclaimer */}
                <motion.div
                    className="rounded-2xl overflow-hidden"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 28 }}
                    style={{ boxShadow: '0 1px 8px rgba(245,158,11,0.10)' }}
                >
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            <span className="text-sm font-semibold text-amber-800">Date limit</span>
                        </div>
                        <p className="text-sm text-amber-700 leading-relaxed">
                            Only include messages after{' '}
                            <span className="font-bold text-[#00A651]">{formatCutoffDisplay(cutoffDate)}</span>.
                            {' '}Any messages outside this range will be ignored.
                        </p>
                        <p className="text-xs text-amber-600">
                            How to get your messages: open your SMS app, scroll back to that date,
                            then long-press to select and copy from there.
                        </p>
                    </div>
                </motion.div>

                {/* Textarea */}
                <motion.div
                    className="space-y-2"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <motion.div
                        className="rounded-2xl overflow-hidden transition-shadow duration-200"
                        animate={{
                            boxShadow: focused
                                ? '0 0 0 2px #00A651, 0 4px 20px rgba(0,166,81,0.12)'
                                : '0 1px 8px rgba(0,0,0,0.06)'
                        }}
                    >
                        <textarea
                            value={smsText}
                            onChange={e => setSmsText(e.target.value)}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            placeholder={"Drop your M-PESA messages here...\n\nWorks with copied messages or SMS backup files."}
                            className="w-full p-4 border-0 rounded-2xl min-h-[200px] resize-none text-sm text-gray-800 placeholder-gray-400 bg-gray-50 focus:outline-none focus:bg-white transition-colors duration-200"
                        />
                    </motion.div>

                    <div className="flex items-center justify-between px-1">
                        <p className="text-xs text-gray-400">
                            {smsText.length > 0
                                ? `${smsText.length.toLocaleString()} characters`
                                : 'Copied messages or SMS backup'}
                        </p>
                        <AnimatePresence>
                            {ready && (
                                <motion.span
                                    className="text-xs text-[#00A651] font-medium"
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

                {/* Submit */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <motion.button
                        onClick={handleSubmit}
                        disabled={!ready}
                        className={`w-full min-h-[52px] rounded-2xl font-semibold text-[15px] transition-colors ${
                            ready
                                ? 'bg-[#00A651] text-white'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                        whileTap={ready ? { scale: 0.97 } : {}}
                        animate={ready ? {
                            boxShadow: ['0 4px 16px rgba(0,166,81,0.25)', '0 6px 24px rgba(0,166,81,0.35)', '0 4px 16px rgba(0,166,81,0.25)'],
                        } : { boxShadow: '0 0px 0px rgba(0,0,0,0)' }}
                        transition={{ repeat: ready ? Infinity : 0, duration: 2.5, ease: 'easeInOut' }}
                    >
                        Generate {mode === 'receipt' ? 'Receipt' : 'Ledger'}
                    </motion.button>
                </motion.div>
            </div>
        </motion.div>
    );
}