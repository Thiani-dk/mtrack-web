import { motion } from 'framer-motion';
import type { ChatMessage } from '../../types';

interface ChatBubbleProps {
    message: ChatMessage;
    onViewSkipped?: (skippedReviewId: string) => void;
}

export function ChatBubble({ message, onViewSkipped }: ChatBubbleProps) {
    if (message.role === 'system') {
        return (
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="text-center"
            >
                <span className="text-xs text-[var(--text-muted)]">{message.text}</span>
            </motion.div>
        );
    }

    const isUser = message.role === 'user';

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
        >
            <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
                style={isUser
                    ? {
                        background: 'rgba(232, 133, 10, 0.12)',
                        border: '1px solid var(--border-glass-accent)',
                        color: 'var(--text-primary)',
                    }
                    : {
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-glass)',
                        color: 'var(--text-primary)',
                        backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                        WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                    }}
            >
                {message.text}
                {message.skippedCount != null && message.skippedCount > 0 && message.skippedReviewId && (
                    <button
                        type="button"
                        onClick={() => onViewSkipped?.(message.skippedReviewId!)}
                        className="block mt-1.5 text-xs font-medium underline underline-offset-2"
                        style={{ color: 'var(--accent)' }}
                    >
                        View skipped →
                    </button>
                )}
            </div>
        </motion.div>
    );
}
