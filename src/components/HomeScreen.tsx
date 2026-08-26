import { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { FileText, Share2, Settings, Trash2, X, History as HistoryIcon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { HistoryButton } from './HistoryButton';
import { useAllTimeStats } from '../lib/aggregate/useAllTimeStats';

interface HomeScreenProps {
    onSelect: () => void;
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

const CARDS: {
    icon: React.ElementType;
    title: string;
    desc: string;
}[] = [
    {
        icon: FileText,
        title: 'Generate Receipt',
        desc: 'Organise your M-PESA, Airtel Money, or bank transactions into a professional, KRA-ready receipt',
    },
];

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// ── Passive return note ──────────────────────────────────────────────────────
// Dismissible, and once dismissed, silent for 7 days — no nag, no badge.

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

// ── Settings affordance ──────────────────────────────────────────────────────

function SettingsMenu({ onClearData }: { onClearData: () => void }) {
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const handleClearTap = () => {
        if (confirming) {
            onClearData();
            setConfirming(false);
            setOpen(false);
        } else {
            setConfirming(true);
        }
    };

    return (
        <div className="relative">
            <motion.button
                onClick={() => { setOpen(o => !o); setConfirming(false); }}
                aria-label="Settings"
                className="flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--border-glass)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                whileTap={{ scale: 0.88 }}
            >
                <Settings className="w-4 h-4" />
            </motion.button>

            <AnimatePresence>
                {open && (
                    <>
                        <div className="fixed inset-0" style={{ zIndex: 15 }} onClick={() => setOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            className="glass-panel z-chip-row absolute top-full right-0 mt-1.5 w-56 rounded-xl overflow-hidden p-1.5"
                        >
                            <button
                                onClick={handleClearTap}
                                className="w-full flex items-center gap-2 text-left text-xs px-3 py-2.5 rounded-lg transition-colors"
                                style={confirming
                                    ? { background: 'rgba(239,68,68,0.12)', color: '#ef4444' }
                                    : { color: 'var(--text-secondary)' }}
                            >
                                <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
                                {confirming ? 'Tap again to clear my data' : 'Clear my data'}
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}

export function HomeScreen({ onSelect, onDemoClick, onHistoryClick, onAllTimeClick }: HomeScreenProps) {
    const { stats, resetAll } = useAllTimeStats();
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
        <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden bg-[var(--bg-base)]">

            {/* Ambient background — accent "sun" hint, top-right */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top right, rgba(232,133,10,0.06), transparent 60%)' }}
            />

            {/* Theme toggle + settings */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                <SettingsMenu onClearData={resetAll} />
                <ThemeToggle />
            </div>

            <motion.div
                className="relative z-10 w-full max-w-lg px-5 space-y-8"
                variants={container}
                initial="hidden"
                animate="show"
            >
                {/* Title */}
                <motion.div variants={item} className="text-center space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-[var(--text-primary)]">
                        M<span className="text-[var(--accent)]">-</span>Track
                    </h1>
                    <p className="text-[var(--text-secondary)] text-base">What would you like to do?</p>
                    <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto leading-relaxed">
                        Paste your M-PESA, Airtel Money, or bank messages, label your transactions, download a KRA-ready receipt.
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
                            <span className="font-semibold text-[var(--text-primary)]">Tip — </span>
                            In your SMS app, select your M-PESA, Airtel Money, or bank messages, tap{' '}
                            <span className="font-semibold text-[var(--text-primary)]">Share</span>, then choose{' '}
                            <span className="font-semibold text-[var(--text-primary)]">M-Track</span> to bring them straight into the chat.
                        </p>
                    </div>
                </motion.div>

                {/* Cards */}
                <div className="space-y-4">
                    {CARDS.map((card) => (
                        <motion.div key={card.title} variants={item}>
                            <motion.button
                                onClick={() => onSelect()}
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
                        Just curious? See it with sample data
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
