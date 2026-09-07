import { motion } from 'framer-motion';
import type { ChatMessage } from '../../types';

interface ChatNearDuplicateProps {
    message: ChatMessage;
    onKeepBoth: (messageId: string) => void;
    onDropSmall: (messageId: string, smallerTransactionCode: string) => void;
}

// A tappable question, never an assertion: the parser found two same-party
// payments minutes apart and cannot tell on its own whether the small one is
// a real payment or a card check. Nothing is removed unless the user says so.
export function ChatNearDuplicate({ message, onKeepBoth, onDropSmall }: ChatNearDuplicateProps) {
    const pair = message.nearDuplicatePair;
    if (!pair) return null;

    const answered = message.answered === true;
    const choice = message.answeredValue;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div
                className="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-primary)',
                    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
                }}
            >
                <p className="whitespace-pre-wrap break-words">{message.text}</p>

                {answered ? (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {choice === 'drop' ? 'Dropped the smaller one.' : 'Kept both.'}
                    </p>
                ) : (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => onKeepBoth(message.id)}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                            style={{
                                background: 'rgba(232, 133, 10, 0.12)',
                                border: '1px solid var(--border-glass-accent)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            Keep both
                        </button>
                        <button
                            type="button"
                            onClick={() => onDropSmall(message.id, pair.smaller.transactionCode)}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--border-glass)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            Drop the small one
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
