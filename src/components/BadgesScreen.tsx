import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Lock, X } from 'lucide-react';
import { useAllTimeStats } from '../lib/aggregate/useAllTimeStats';
import { BADGES, getBadge, type EvidenceTransaction } from '../lib/badges/definitions';
import { fmtProse, shortProviderName } from '../lib/transactionDisplay';
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

function EvidenceRow({ evidence }: { evidence: EvidenceTransaction }) {
    return (
        <div className="flex items-center justify-between py-2.5 border-b border-[var(--border-glass)] last:border-b-0">
            <div className="min-w-0 pr-3">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {evidence.merchant ?? evidence.recipient}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                    {shortProviderName(evidence.provider)} · {new Date(evidence.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] flex-shrink-0">
                {evidence.type === 'received' ? '+' : '-'}{fmtProse(evidence.amount)}
            </p>
        </div>
    );
}

interface BadgeSheetProps {
    badgeId: string;
    unlockedAt: number;
    evidence: EvidenceTransaction[];
    onClose: () => void;
}

function BadgeEvidenceSheet({ badgeId, unlockedAt, evidence, onClose }: BadgeSheetProps) {
    const badge = getBadge(badgeId);
    if (!badge) return null;

    return (
        <>
            <motion.div
                className="fixed inset-0 z-scrim"
                style={{ background: 'var(--scrim)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />
            <motion.div
                className="glass-panel fixed inset-x-0 bottom-0 z-modal rounded-t-3xl max-h-[80vh] flex flex-col max-w-md mx-auto"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            >
                <div className="flex items-start justify-between px-5 pt-5 pb-3">
                    <div className="min-w-0 pr-3">
                        <p className="text-base font-bold text-[var(--text-primary)]">{badge.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-snug">{badge.description}</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Unlocked {formatUnlockDate(unlockedAt)}</p>
                    </div>
                    <motion.button
                        onClick={onClose}
                        className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0"
                        whileTap={{ scale: 0.88 }}
                    >
                        <X className="w-4 h-4" />
                    </motion.button>
                </div>

                <div className="px-5 pb-8 overflow-y-auto">
                    {evidence.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)] py-4">
                            This one's about the collection, not a single transaction.
                        </p>
                    ) : (
                        evidence.map((e, i) => <EvidenceRow key={`${e.code}-${i}`} evidence={e} />)
                    )}
                </div>
            </motion.div>
        </>
    );
}

export function BadgesScreen({ onBack }: BadgesScreenProps) {
    const { stats, isLoading } = useAllTimeStats();
    const earned = stats?.earnedBadges ?? {};
    const earnedCount = Object.keys(earned).length;
    const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
    const selectedRecord = selectedBadgeId ? earned[selectedBadgeId] : undefined;

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
                            const record = earned[badge.id];
                            const isEarned = record != null;
                            const isHiddenAndLocked = badge.hidden && !isEarned;

                            return (
                                <motion.div
                                    key={badge.id}
                                    className="glass-card p-4 flex flex-col items-center text-center gap-1.5"
                                    style={!isEarned && !isHiddenAndLocked ? { opacity: 0.3, filter: 'grayscale(1)' } : undefined}
                                    onClick={isEarned ? () => setSelectedBadgeId(badge.id) : undefined}
                                    whileTap={isEarned ? { scale: 0.96 } : undefined}
                                >
                                    {isHiddenAndLocked ? (
                                        <>
                                            <Lock className="w-6 h-6 text-[var(--text-muted)] mt-1" />
                                            <p className="text-sm font-bold text-[var(--text-muted)] mt-1">???</p>
                                            <p className="text-xs text-[var(--text-muted)]">Keep going.</p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-bold text-[var(--text-primary)] mt-1">{badge.name}</p>
                                            <p className="text-xs text-[var(--text-muted)] leading-snug">{badge.description}</p>
                                            {isEarned ? (
                                                <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatUnlockDate(record.earnedAt)}</p>
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
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {selectedBadgeId && selectedRecord && (
                    <BadgeEvidenceSheet
                        badgeId={selectedBadgeId}
                        unlockedAt={selectedRecord.earnedAt}
                        evidence={selectedRecord.evidence}
                        onClose={() => setSelectedBadgeId(null)}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}
