import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Inbox, Trophy, Trash2, Award, ChevronRight } from 'lucide-react';
import { BADGES } from '../lib/badges/definitions';
import { useAllTimeStats } from '../lib/aggregate/useAllTimeStats';
import { shortProviderName } from '../lib/transactionDisplay';
import { ThemeToggle } from './ThemeToggle';

interface AllTimeScreenProps {
    onBack: () => void;
    onBadgesClick: () => void;
}

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatMonthYear(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function formatMonthLabel(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function topEntries(record: Record<string, number>, n: number): [string, number][] {
    return Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function AllTimeScreen({ onBack, onBadgesClick }: AllTimeScreenProps) {
    const { stats, isLoading, resetAll } = useAllTimeStats();
    const [confirmingClear, setConfirmingClear] = useState(false);

    const handleClearTap = () => {
        if (confirmingClear) {
            resetAll();
            setConfirmingClear(false);
        } else {
            setConfirmingClear(true);
        }
    };

    const months = stats ? Object.values(stats.monthly).sort((a, b) => (a.month < b.month ? 1 : -1)) : [];
    const topCategories = stats ? topEntries(stats.categoryTotals, 5) : [];
    const topMerchants = stats ? topEntries(stats.merchantCounts, 5) : [];
    const topProviders = stats ? topEntries(stats.providerCounts, 4) : [];

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="glass-header sticky top-0 z-header h-14 border-b border-[var(--border-glass)] flex items-center px-4">
                <motion.button
                    onClick={onBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    whileTap={{ scale: 0.88 }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </motion.button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">All time</span>
                </div>
                <ThemeToggle />
            </div>

            <div className="flex-1 px-4 pt-5 pb-12 space-y-4 max-w-md mx-auto w-full">
                {isLoading ? (
                    <p className="text-center text-sm text-[var(--text-muted)] py-16">Loading…</p>
                ) : !stats || stats.sessionCount === 0 ? (
                    <motion.div
                        className="flex flex-col items-center justify-center text-center py-20 space-y-4"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    >
                        <Inbox className="w-14 h-14 text-[var(--text-muted)]" />
                        <p className="text-sm text-[var(--text-secondary)] max-w-[240px]">
                            Nothing tracked yet — generate a summary to start building your running picture.
                        </p>
                    </motion.div>
                ) : (
                    <>
                        {/* Headline numbers */}
                        <div className="glass-card overflow-hidden p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{stats.sessionCount}</p>
                                    <p className="text-xs text-[var(--text-muted)]">Summaries</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{stats.totalTransactionsTracked}</p>
                                    <p className="text-xs text-[var(--text-muted)]">Transactions</p>
                                </div>
                                <div>
                                    <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{fmt(stats.totalSpent)}</p>
                                    <p className="text-xs text-[var(--text-muted)]">Total spent</p>
                                </div>
                                <div>
                                    <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--warn-heading)' }}>{fmt(stats.totalFees)}</p>
                                    <p className="text-xs text-[var(--text-muted)]">Fees spotted</p>
                                </div>
                            </div>
                            <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-glass)]">
                                Tracked since {formatMonthYear(stats.firstTrackedAt)}
                            </p>
                        </div>

                        {/* Badges entry point */}
                        <motion.button
                            onClick={onBadgesClick}
                            className="glass-card glass-card-hover w-full flex items-center gap-3 p-4 text-left"
                            whileTap={{ scale: 0.98 }}
                        >
                            <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg" style={{ background: 'var(--accent-subtle)' }}>
                                <Award className="w-4 h-4 text-[var(--accent)]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)]">Badges</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {Object.keys(stats.earnedBadges).length} of {BADGES.length} earned
                                </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                        </motion.button>

                        {/* Month by month */}
                        {months.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2 px-1">By month</p>
                                <div className="glass-card overflow-hidden divide-y divide-[var(--border-glass)]">
                                    {months.map(m => (
                                        <div key={m.month} className="flex items-center justify-between px-4 py-3">
                                            <div>
                                                <p className="text-sm font-medium text-[var(--text-primary)]">{formatMonthLabel(m.month)}</p>
                                                <p className="text-xs text-[var(--text-muted)]">{m.transactionCount} transaction{m.transactionCount !== 1 ? 's' : ''}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">{fmt(m.spent)}</p>
                                                {m.fees > 0 && (
                                                    <p className="text-xs tabular-nums" style={{ color: 'var(--warn-heading)' }}>{fmt(m.fees)} fees</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Personal records */}
                        <div>
                            <div className="flex items-center gap-1.5 mb-2 px-1">
                                <Trophy className="w-3.5 h-3.5 text-[var(--accent)]" />
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Personal records</p>
                            </div>
                            <div className="glass-card overflow-hidden divide-y divide-[var(--border-glass)]">
                                <div className="flex items-center justify-between px-4 py-3">
                                    <span className="text-sm text-[var(--text-secondary)]">Busiest summary</span>
                                    <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                                        {stats.records.mostTransactionsInOneSummary} transactions
                                    </span>
                                </div>
                                {stats.records.largestSingleTransaction && (
                                    <div className="flex items-center justify-between px-4 py-3 gap-2">
                                        <span className="text-sm text-[var(--text-secondary)]">Biggest single payment</span>
                                        <span className="text-sm font-medium text-[var(--text-primary)] text-right tabular-nums">
                                            {fmt(stats.records.largestSingleTransaction.amount)}
                                            <span className="block text-xs text-[var(--text-muted)] font-normal">
                                                {stats.records.largestSingleTransaction.recipient}
                                            </span>
                                        </span>
                                    </div>
                                )}
                                {stats.records.highestSpendMonth && (
                                    <div className="flex items-center justify-between px-4 py-3">
                                        <span className="text-sm text-[var(--text-secondary)]">Highest-spend month</span>
                                        <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                                            {fmt(stats.records.highestSpendMonth.amount)} · {formatMonthLabel(stats.records.highestSpendMonth.month)}
                                        </span>
                                    </div>
                                )}
                                {stats.records.lowestFeeMonth && (
                                    <div className="flex items-center justify-between px-4 py-3">
                                        <span className="text-sm text-[var(--text-secondary)]">Lowest-fee month</span>
                                        <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                                            {fmt(stats.records.lowestFeeMonth.amount)} · {formatMonthLabel(stats.records.lowestFeeMonth.month)}
                                        </span>
                                    </div>
                                )}
                                {stats.records.longestGapBetweenSummaries > 0 && (
                                    <div className="flex items-center justify-between px-4 py-3">
                                        <span className="text-sm text-[var(--text-secondary)]">Longest gap between summaries</span>
                                        <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                                            {stats.records.longestGapBetweenSummaries} days
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Top categories */}
                        {topCategories.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2 px-1">Top categories, all time</p>
                                <div className="glass-card overflow-hidden divide-y divide-[var(--border-glass)]">
                                    {topCategories.map(([category, total]) => (
                                        <div key={category} className="flex items-center justify-between px-4 py-2.5">
                                            <span className="text-sm text-[var(--text-secondary)]">{category}</span>
                                            <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">{fmt(total)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Top merchants */}
                        {topMerchants.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2 px-1">Top merchants, all time</p>
                                <div className="glass-card overflow-hidden divide-y divide-[var(--border-glass)]">
                                    {topMerchants.map(([name, count]) => (
                                        <div key={name} className="flex items-center justify-between px-4 py-2.5">
                                            <span className="text-sm text-[var(--text-secondary)] truncate">{name}</span>
                                            <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums flex-shrink-0">
                                                {count}×
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Channels (providers) */}
                        {topProviders.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2 px-1">Channels</p>
                                <div className="flex flex-wrap gap-2 px-1">
                                    {topProviders.map(([provider, count]) => (
                                        <span
                                            key={provider}
                                            className="text-xs px-2.5 py-1 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                                        >
                                            {shortProviderName(provider)} · {count}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Clear all data */}
                        <div className="pt-4">
                            <motion.button
                                onClick={handleClearTap}
                                className="w-full min-h-[48px] rounded-2xl text-sm font-medium flex items-center justify-center gap-2 border transition-colors"
                                style={confirmingClear
                                    ? { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }
                                    : { background: 'var(--bg-elevated)', borderColor: 'var(--border-glass)', color: 'var(--text-secondary)' }}
                                whileTap={{ scale: 0.97 }}
                            >
                                <Trash2 className="w-4 h-4" />
                                {confirmingClear ? 'Tap again to clear everything' : 'Clear all data'}
                            </motion.button>
                            <AnimatePresence>
                                {confirmingClear && (
                                    <motion.p
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="text-xs text-center text-[var(--text-muted)] mt-2"
                                    >
                                        This wipes your all-time totals and records. Individual saved summaries aren't affected.
                                    </motion.p>
                                )}
                            </AnimatePresence>
                        </div>
                    </>
                )}
            </div>
        </motion.div>
    );
}
