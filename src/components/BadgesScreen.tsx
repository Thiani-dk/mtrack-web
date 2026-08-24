import { motion } from 'framer-motion';
import { ArrowLeft, Lock } from 'lucide-react';
import { useAllTimeStats } from '../lib/aggregate/useAllTimeStats';
import { BADGES } from '../lib/badges/definitions';
import { ThemeToggle } from './ThemeToggle';

interface BadgesScreenProps {
    onBack: () => void;
}

const TIER_LABELS: Record<string, string> = {
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
};

function formatUnlockDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BadgesScreen({ onBack }: BadgesScreenProps) {
    const { stats, isLoading } = useAllTimeStats();
    const earned = stats?.earnedBadges ?? {};
    const earnedCount = Object.keys(earned).length;

    return (
        <motion.div
            className="flex flex-col min-h-screen bg-[var(--bg-base)]"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
            {/* Header */}
            <div className="glass-header sticky top-0 z-header border-b border-[var(--border-glass)]">
                <div className="h-14 flex items-center px-4">
                    <motion.button
                        onClick={onBack}
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                        whileTap={{ scale: 0.88 }}
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </motion.button>
                    <div className="flex-1 text-center">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">Badges</span>
                    </div>
                    <ThemeToggle />
                </div>
                <p className="text-center text-xs text-[var(--text-muted)] pb-3">
                    {earnedCount} of {BADGES.length} earned
                </p>
            </div>

            <div className="flex-1 px-4 pt-5 pb-12 max-w-md mx-auto w-full">
                {isLoading ? (
                    <p className="text-center text-sm text-[var(--text-muted)] py-16">Loading…</p>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {BADGES.map(badge => {
                            const unlockedAt = earned[badge.id];
                            const isEarned = unlockedAt != null;
                            const isHiddenAndLocked = badge.hidden && !isEarned;

                            return (
                                <div
                                    key={badge.id}
                                    className="glass-card p-4 flex flex-col items-center text-center gap-1.5"
                                    style={!isEarned && !isHiddenAndLocked ? { opacity: 0.3, filter: 'grayscale(1)' } : undefined}
                                >
                                    {isHiddenAndLocked ? (
                                        <>
                                            <Lock className="w-6 h-6 text-[var(--text-muted)] mt-1" />
                                            <p className="text-sm font-bold text-[var(--text-muted)] mt-1">???</p>
                                            <p className="text-xs text-[var(--text-muted)]">Keep going.</p>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-3xl">{badge.emoji}</span>
                                            <p className="text-sm font-bold text-[var(--text-primary)] mt-1">{badge.name}</p>
                                            <p className="text-xs text-[var(--text-muted)] leading-snug">{badge.description}</p>
                                            {isEarned ? (
                                                <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatUnlockDate(unlockedAt)}</p>
                                            ) : (
                                                <span
                                                    className="text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full mt-1"
                                                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                                                >
                                                    {TIER_LABELS[badge.tier]}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
