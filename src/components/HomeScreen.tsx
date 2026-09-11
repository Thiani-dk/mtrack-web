import { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { FileText, Share2, X, History as HistoryIcon, Zap } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { HistoryButton } from './HistoryButton';
import { useAllTimeStats } from '../lib/aggregate/useAllTimeStats';

interface HomeScreenProps {
    onSelect: () => void;
    onActiveModeClick: () => void;
    onDemoClick: () => void;
    onHistoryClick: () => void;
    onAllTimeClick: () => void;
}

const container: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.12, delayChildren: 0.1 }
    }
};

const item: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } }
};

type CardAction = 'summary' | 'activeMode';

const CARDS: {
    icon: React.ElementType;
    title: string;
    desc: string;
    action: CardAction;
}[] = [
    {
        icon: FileText,
        title: 'Start a summary',
        desc: 'Copy your messages, bring them here, and M-Track will sort, total, and categorise everything into a receipt.',
        action: 'summary',
    },
    {
        // Its own entry point, not a chat mode. Opening this screen already
        // answers "what are we putting together", which is the question a
        // vendor with a queue cannot afford to be asked.
        icon: Zap,
        title: 'Track a busy day',
        desc: 'Fast sale-by-sale tracking for a busy stand. Paste each payment, tap a bucket, keep serving.',
        action: 'activeMode',
    },
];

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// ── Passive return note ──────────────────────────────────────────────────────
// Dismissible, and once dismissed, silent for 7 days — no nag.

const RETURN_NOTE_DISMISS_KEY = 'mtrack-return-note-dismissed-until';
const DAY_MS = 24 * 60 * 60 * 1000;

function isReturnNoteDismissedAt(now: number): boolean {
    try {
        const until = localStorage.getItem(RETURN_NOTE_DISMISS_KEY);
        return !!until && now < Number(until);
    } catch {
        return false;
    }
}

function dismissReturnNote(): void {
    try {
        localStorage.setItem(RETURN_NOTE_DISMISS_KEY, String(Date.now() + 7 * DAY_MS));
    } catch {
        // Storage unavailable — the note will just show again next time
    }
}

export function HomeScreen({ onSelect, onActiveModeClick, onDemoClick, onHistoryClick, onAllTimeClick }: HomeScreenProps) {
    const { stats } = useAllTimeStats();
    // Captured once on mount rather than read fresh on every render — keeps
    // the render body pure (no direct Date.now() calls in render).
    const [now] = useState(() => Date.now());
    const [dismissedThisVisit, setDismissedThisVisit] = useState(false);

    const daysSinceLast = stats ? Math.floor((now - stats.lastTrackedAt) / DAY_MS) : 0;
    const showReturnNote = !!stats && stats.sessionCount > 0 && daysSinceLast > 25 &&
        !dismissedThisVisit && !isReturnNoteDismissedAt(now);

    const handleDismissReturnNote = () => {
        dismissReturnNote();
        setDismissedThisVisit(true);
    };

    return (
        <div className="relative flex flex-col min-h-screen overflow-hidden bg-[var(--bg-base)]">

            {/* Ambient background — accent "sun" hint, top-right */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top right, rgba(232,133,10,0.06), transparent 60%)' }}
            />

            {/* Same sticky header bar every other screen uses, rather than icons
                floating loose over the hero copy. No back control: this is the
                root screen. */}
            <div className="glass-header sticky top-0 z-header h-14 flex-shrink-0 border-b border-[var(--border-glass)] flex items-center px-4">
                <div className="flex-1" />
                <ThemeToggle />
            </div>

            <motion.div
                className="relative z-10 flex-1 flex flex-col justify-center w-full max-w-lg mx-auto px-5 py-8 space-y-8"
                variants={container}
                initial="hidden"
                animate="show"
            >
                {/* Title */}
                <motion.div variants={item} className="text-center space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-[var(--text-primary)]">
                        M<span className="text-[var(--accent)]">-</span>Track
                    </h1>
                    <p className="text-[var(--text-secondary)] text-base">See where your money went</p>
                    <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto leading-relaxed">
                        Copy your M-Pesa, Airtel Money, or any transaction confirmation messages and M-Track breaks them down, spots patterns, and gives you a receipt you can keep.
                    </p>
                </motion.div>

                {/* Passive return note — quiet, dismissible, never a nag */}
                <AnimatePresence>
                    {showReturnNote && (
                        <motion.div
                            variants={item}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex items-center justify-center gap-2"
                        >
                            <p className="text-xs text-[var(--text-muted)] text-center">
                                It's been {daysSinceLast} days since your last summary.
                            </p>
                            <button
                                onClick={handleDismissReturnNote}
                                aria-label="Dismiss"
                                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex-shrink-0"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Share tip banner */}
                <motion.div variants={item}>
                    <div className="flex items-start gap-3 rounded-2xl px-4 py-3 border"
                        style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}>
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
                            style={{ background: 'var(--accent-subtle)' }}>
                            <Share2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            Tip: In your SMS app, hold a message to start selecting, pick the ones you want, then tap copy. Come back here and drop them in the chat.
                        </p>
                    </div>
                </motion.div>

                {/* Cards */}
                <div className="space-y-4">
                    {CARDS.map((card) => (
                        <motion.div key={card.title} variants={item}>
                            <motion.button
                                onClick={() => (card.action === 'activeMode' ? onActiveModeClick() : onSelect())}
                                className="glass-card glass-card-hover relative w-full text-left overflow-hidden group"
                                whileHover={{ y: -3 }}
                                whileTap={{ scale: 0.975 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            >
                                {/* Top accent bar */}
                                <div className="h-1 w-full" style={{ background: 'linear-gradient(to right, #E8850A, #f2a736)' }} />

                                <div className="flex items-start gap-4 p-5">
                                    {/* Icon */}
                                    <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl shadow-lg"
                                        style={{
                                            background: 'linear-gradient(to bottom right, #E8850A, #f2a736)',
                                            boxShadow: '0 8px 20px rgba(232,133,10,0.25)',
                                        }}>
                                        <card.icon className="w-5 h-5 text-white" />
                                    </div>

                                    {/* Text */}
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-[15px] font-semibold text-[var(--text-primary)] leading-snug">
                                            {card.title}
                                        </h2>
                                        <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                                            {card.desc}
                                        </p>
                                    </div>

                                    {/* Arrow */}
                                    <motion.div
                                        className="flex-shrink-0 self-center text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors"
                                        initial={{ x: 0 }}
                                        whileHover={{ x: 3 }}
                                        transition={{ type: 'spring', stiffness: 400 }}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                            <path d="M7 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </motion.div>
                                </div>
                            </motion.button>
                        </motion.div>
                    ))}
                </div>

                {/* All Time card — only once there's a real running picture */}
                {stats && stats.sessionCount >= 2 && (
                    <motion.div variants={item}>
                        <motion.button
                            onClick={onAllTimeClick}
                            className="glass-card glass-card-hover relative w-full text-left overflow-hidden"
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.975 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        >
                            <div className="flex items-start gap-3 p-4">
                                <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg"
                                    style={{ background: 'var(--accent-subtle)' }}>
                                    <HistoryIcon className="w-4 h-4 text-[var(--accent)]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-semibold text-[var(--accent)] uppercase tracking-widest">All time</p>
                                    <p className="text-sm font-medium text-[var(--text-primary)] mt-0.5">
                                        {stats.sessionCount} summaries · {stats.totalTransactionsTracked} transactions
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                        Tracked since {new Date(stats.firstTrackedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                                    </p>
                                    {stats.totalFees > 0 && (
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--warn-heading)' }}>
                                            {fmt(stats.totalFees)} in fees spotted
                                        </p>
                                    )}
                                </div>
                            </div>
                        </motion.button>
                    </motion.div>
                )}

                {/* Demo link — subtle, secondary to the primary card */}
                <motion.div variants={item} className="flex items-center justify-center">
                    <button
                        onClick={onDemoClick}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline underline-offset-2 decoration-[var(--border-glass)] transition-colors"
                    >
                        Try it with sample data first
                    </button>
                </motion.div>

                {/* History */}
                <motion.div variants={item}>
                    <HistoryButton onClick={onHistoryClick} />
                </motion.div>

                {/* Footer */}
                <motion.p variants={item} className="text-center text-xs text-[var(--text-muted)] pb-8">
                    track today
                </motion.p>
            </motion.div>
        </div>
    );
}
