import { motion } from 'framer-motion';
import { getBadge } from '../../lib/badges/definitions';

interface ChatBadgeProps {
    badgeId: string;
    leadIn: string;
}

export function ChatBadge({ badgeId, leadIn }: ChatBadgeProps) {
    const badge = getBadge(badgeId);
    if (!badge) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <motion.div
                className="glass-card max-w-[80%] px-5 py-4 text-center relative overflow-hidden"
                initial={{ scale: 0.85 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
            >
                {/* Subtle accent glow — no confetti */}
                <motion.div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(circle at center, var(--accent-glow), transparent 70%)' }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0.35] }}
                    transition={{ duration: 1.1, delay: 0.15 }}
                />

                <p className="text-[11px] font-medium text-[var(--text-muted)] relative">{leadIn}</p>

                <p className="text-sm font-bold text-[var(--text-primary)] mt-2 relative">{badge.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 relative">{badge.description}</p>

                <span
                    className="inline-block mt-2 text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full relative"
                    style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                >
                    {badge.tier}
                </span>
            </motion.div>
        </motion.div>
    );
}
