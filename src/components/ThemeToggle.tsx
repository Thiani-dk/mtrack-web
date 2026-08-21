import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/useTheme';

export function ThemeToggle({ className = '' }: { className?: string }) {
    const { theme, toggleTheme } = useTheme();

    return (
        <motion.button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--border-glass)] bg-[var(--bg-elevated)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-glass-accent)] ${className}`}
            whileTap={{ scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400 }}
        >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </motion.button>
    );
}
