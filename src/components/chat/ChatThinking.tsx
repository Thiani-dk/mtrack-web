import { motion } from 'framer-motion';

export function ChatThinking() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div
                className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
                style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-glass)',
                    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                }}
            >
                {[0, 1, 2].map(i => (
                    <motion.span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--text-muted)' }}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
                    />
                ))}
            </div>
        </motion.div>
    );
}
