import { motion } from 'framer-motion';
import { ArrowLeft, Menu } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';

interface ChatHeaderProps {
    title: string;
    demo?: boolean;
    onBack: () => void;
    onToggleSidebar: () => void;
}

export function ChatHeader({ title, demo = false, onBack, onToggleSidebar }: ChatHeaderProps) {
    return (
        <div className="glass-header sticky top-0 z-10 h-14 flex-shrink-0 border-b border-[var(--border-glass)] flex items-center gap-2 px-3 md:px-4">
            <motion.button
                onClick={onBack}
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0"
                whileTap={{ scale: 0.88 }}
                aria-label="Back"
            >
                <ArrowLeft className="w-4 h-4" />
            </motion.button>

            <motion.button
                onClick={onToggleSidebar}
                className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0"
                whileTap={{ scale: 0.88 }}
                aria-label="Toggle sessions"
            >
                <Menu className="w-4 h-4" />
            </motion.button>

            <div className="flex-1 flex items-center justify-center gap-2 min-w-0 px-2">
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {title}
                </span>
                {demo && (
                    <div className="relative group/demo flex-shrink-0" tabIndex={0}>
                        <span
                            className="z-chip-row relative text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border"
                            style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-border)', color: 'var(--warn-heading)' }}
                        >
                            Demo
                        </span>
                        <div
                            className="z-modal glass-panel absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-44 rounded-lg px-2.5 py-2 text-[11px] leading-snug text-[var(--text-secondary)] opacity-0 pointer-events-none group-hover/demo:opacity-100 group-focus-within/demo:opacity-100 transition-opacity"
                        >
                            Made-up sample data — nothing here is real or saved.
                        </div>
                    </div>
                )}
            </div>

            <ThemeToggle />
        </div>
    );
}
