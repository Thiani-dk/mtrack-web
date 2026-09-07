import { motion } from 'framer-motion';
import type { ChatMessage } from '../../types';

interface ChatOptionsProps {
    message: ChatMessage;
    onSelect: (messageId: string, value: string) => void;
}

// Tappable option cards for a bot question. Once answered, the row locks and
// only the chosen option stays highlighted.
export function ChatOptions({ message, onSelect }: ChatOptionsProps) {
    const options = message.options ?? [];
    const answered = message.answered === true;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div
                className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-primary)',
                    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                }}
            >
                {message.text && <p className="whitespace-pre-wrap break-words mb-2.5">{message.text}</p>}

                <div className="flex flex-col gap-2">
                    {options.map(opt => {
                        const chosen = answered && message.answeredValue === opt.value;
                        const dimmed = answered && !chosen;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                disabled={answered}
                                onClick={() => onSelect(message.id, opt.value)}
                                className="text-left rounded-xl px-3.5 py-2.5 text-sm transition-opacity"
                                style={{
                                    background: chosen ? 'rgba(232, 133, 10, 0.12)' : 'transparent',
                                    border: `1px solid ${chosen ? 'var(--border-glass-accent)' : 'var(--border-glass)'}`,
                                    color: 'var(--text-primary)',
                                    opacity: dimmed ? 0.45 : 1,
                                    cursor: answered ? 'default' : 'pointer',
                                }}
                            >
                                <span className="font-medium">{opt.label}</span>
                                {opt.sublabel && (
                                    <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                        {opt.sublabel}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </motion.div>
    );
}
