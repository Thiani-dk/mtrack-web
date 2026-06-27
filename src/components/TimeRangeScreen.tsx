import { motion } from 'framer-motion';
import { ArrowLeft, Clock } from 'lucide-react';
import type { TimeRange } from '../types';
import { type Variants } from 'framer-motion';

interface TimeRangeScreenProps {
    mode: 'receipt' | 'ledger';
    onSelect: (range: TimeRange) => void;
    onBack: () => void;
}

const rangeOptions: { value: TimeRange; label: string; subLabel: string; days: string }[] = [
    { value: 'week',     label: 'Past Week',      subLabel: '7 days of transactions',   days: '7d'   },
    { value: 'month',    label: 'Past Month',     subLabel: '30 days of transactions',  days: '30d'  },
    { value: '3months',  label: 'Past 3 Months',  subLabel: '90 days of transactions',  days: '90d'  },
    { value: '6months',  label: 'Past 6 Months',  subLabel: '180 days of transactions', days: '180d' },
    { value: 'year',     label: 'Past Year',      subLabel: '365 days of transactions', days: '365d' },
];

const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } }
};

const item: Variants = {
    hidden: { opacity: 0, x: 32 },
    show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } }
};

export function TimeRangeScreen({ mode, onSelect, onBack }: TimeRangeScreenProps) {
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

            <div className="flex-1 px-5 pt-6 pb-8">
                {/* Title */}
                <motion.div
                    className="mb-7"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-[#00A651]" />
                        <span className="text-xs font-semibold text-[#00A651] uppercase tracking-widest">
                            {mode === 'receipt' ? 'Receipt' : 'Ledger'} period
                        </span>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">How far back?</h1>
                    <p className="text-sm text-gray-500 mt-1">Select the time window for your {mode === 'receipt' ? 'receipt' : 'ledger'}</p>
                </motion.div>

                {/* Options */}
                <motion.div className="space-y-3" variants={container} initial="hidden" animate="show">
                    {rangeOptions.map((option, i) => (
                        <motion.div key={option.value} variants={item} custom={i}>
                            <motion.button
                                onClick={() => onSelect(option.value)}
                                className="relative w-full text-left bg-white rounded-2xl border border-gray-100 overflow-hidden"
                                style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}
                                whileHover={{ y: -2, boxShadow: '0 6px 24px rgba(0,166,81,0.10)' }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            >
                                <div className="flex items-center gap-4 px-4 py-4">
                                    {/* Day pill */}
                                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center">
                                        <span className="text-xs font-bold text-[#00A651]">{option.days}</span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-semibold text-gray-900 text-[15px]">{option.label}</div>
                                        <div className="text-sm text-gray-500">{option.subLabel}</div>
                                    </div>
                                    <svg className="text-gray-300 flex-shrink-0" width="18" height="18" viewBox="0 0 20 20" fill="none">
                                        <path d="M7 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </motion.button>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </motion.div>
    );
}