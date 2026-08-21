import { motion } from 'framer-motion';
import { ArrowLeft, Clock } from 'lucide-react';
import type { TimeRange } from '../types';
import { type Variants } from 'framer-motion';
import { ThemeToggle } from './ThemeToggle';

interface TimeRangeScreenProps {
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

export function TimeRangeScreen({ onSelect, onBack }: TimeRangeScreenProps) {
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

            <div className="flex-1 px-5 pt-6 pb-8">
                {/* Title */}
                <motion.div
                    className="mb-7"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, type: 'spring', stiffness: 380, damping: 28 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-[var(--accent)]" />
                        <span className="text-xs font-semibold text-[var(--accent)] uppercase tracking-widest">
                            Time Period
                        </span>
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">How far back?</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                        Pick the date range your receipt should cover.
                    </p>
                </motion.div>

                {/* Options */}
                <motion.div className="space-y-3" variants={container} initial="hidden" animate="show">
                    {rangeOptions.map((option, i) => (
                        <motion.div key={option.value} variants={item} custom={i}>
                            <motion.button
                                onClick={() => onSelect(option.value)}
                                className="glass-card glass-card-hover relative w-full text-left overflow-hidden"
                                whileHover={{ y: -2 }}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            >
                                <div className="flex items-center gap-4 px-4 py-4">
                                    {/* Day pill */}
                                    <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                        style={{ background: 'var(--accent-subtle)' }}>
                                        <span className="text-xs font-bold text-[var(--accent)]">{option.days}</span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-semibold text-[var(--text-primary)] text-[15px]">{option.label}</div>
                                        <div className="text-sm text-[var(--text-secondary)]">{option.subLabel}</div>
                                    </div>
                                    <svg className="text-[var(--text-muted)] flex-shrink-0" width="18" height="18" viewBox="0 0 20 20" fill="none">
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
