import { motion, type Variants } from 'framer-motion';
import { FileText, Share2 } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface HomeScreenProps {
    onSelect: () => void;
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
        desc: 'Organise your M-PESA transactions into a professional, KRA-ready receipt',
    },
];

export function HomeScreen({ onSelect }: HomeScreenProps) {
    return (
        <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden bg-[var(--bg-base)]">

            {/* Ambient background — accent "sun" hint, top-right */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top right, rgba(232,133,10,0.03), transparent 60%)' }}
            />

            {/* Theme toggle */}
            <div className="absolute top-4 right-4 z-20">
                <ThemeToggle />
            </div>

            <motion.div
                className="relative z-10 w-full max-w-md px-5 space-y-8"
                variants={container}
                initial="hidden"
                animate="show"
            >
                {/* Title */}
                <motion.div variants={item} className="text-center space-y-2 pt-8">
                    <h1 className="text-4xl font-bold tracking-tight text-[var(--text-primary)]">
                        M<span className="text-[var(--accent)]">-</span>Track
                    </h1>
                    <p className="text-[var(--text-secondary)] text-base">What would you like to do?</p>
                </motion.div>

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
                            In your SMS app, select your M-PESA messages, tap{' '}
                            <span className="font-semibold text-[var(--text-primary)]">Share</span>, then choose{' '}
                            <span className="font-semibold text-[var(--text-primary)]">M-Track</span> to import them instantly.
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

                {/* Footer */}
                <motion.p variants={item} className="text-center text-xs text-[var(--text-muted)] pb-8">
                    track today
                </motion.p>
            </motion.div>
        </div>
    );
}
