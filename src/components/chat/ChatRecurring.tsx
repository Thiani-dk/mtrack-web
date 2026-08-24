import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Repeat } from 'lucide-react';
import type { RecurringPattern } from '../../lib/insights/recurring';
import { providerChipLabel } from '../../lib/transactionDisplay';

interface ChatRecurringProps {
    patterns: RecurringPattern[];
}

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const CADENCE_LABELS: Record<RecurringPattern['cadence'], string> = {
    weekly: 'Weekly',
    fortnightly: 'Fortnightly',
    monthly: 'Monthly',
    irregular: 'Irregular',
};

function CadenceChip({ cadence }: { cadence: RecurringPattern['cadence'] }) {
    return (
        <span
            className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
        >
            {CADENCE_LABELS[cadence]}
        </span>
    );
}

function PatternRow({ pattern }: { pattern: RecurringPattern }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border-b border-[var(--border-glass)] last:border-0">
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between gap-2 py-2.5 text-left"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{pattern.recipient}</p>
                        <CadenceChip cadence={pattern.cadence} />
                        {pattern.isFixedAmount && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)] flex-shrink-0">
                                same amount each time
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {pattern.occurrences.length}× · avg {fmt(pattern.averageAmount)}
                        {pattern.nextExpected && (
                            <> · next expected around {pattern.nextExpected.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</>
                        )}
                    </p>
                </div>
                <ChevronDown
                    className={`w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="glass-panel rounded-lg p-2 mb-2.5 space-y-1.5">
                            {pattern.occurrences.map(t => (
                                <div key={t.transactionCode} className="flex items-center justify-between gap-2 text-xs">
                                    <div className="min-w-0 flex-1">
                                        <span className="text-[var(--text-secondary)]">
                                            {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                        </span>
                                        <span className="text-[var(--text-primary)] ml-1.5 truncate">
                                            {t.merchant ?? t.recipient}
                                        </span>
                                        <span className="font-mono text-[var(--text-muted)] ml-1.5">{t.transactionCode}</span>
                                        <span className="text-[9px] uppercase text-[var(--text-muted)] ml-1.5">
                                            {providerChipLabel(t)}
                                        </span>
                                    </div>
                                    <span className="font-medium text-[var(--text-primary)] tabular-nums flex-shrink-0">
                                        {fmt(t.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function ChatRecurring({ patterns }: ChatRecurringProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[85%] w-full px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1">
                    <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                        {patterns.length} regular payment{patterns.length === 1 ? '' : 's'}
                    </p>
                </div>
                <div>
                    {patterns.map(p => <PatternRow key={p.id} pattern={p} />)}
                </div>
            </div>
        </motion.div>
    );
}
