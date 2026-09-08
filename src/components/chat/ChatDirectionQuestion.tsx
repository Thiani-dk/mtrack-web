import { motion } from 'framer-motion';
import type { ChatMessage } from '../../types';

interface ChatDirectionQuestionProps {
    message: ChatMessage;
    onAnswer: (messageId: string, transactionCode: string, direction: 'sent' | 'received') => void;
}

// The parser could not tell whether a transaction was money in or money out —
// no verb it recognised, no preposition structure, no balance to reconcile
// against. Rather than guess (the old behaviour: silently "sent"), it asks.
export function ChatDirectionQuestion({ message, onAnswer }: ChatDirectionQuestionProps) {
    const q = message.directionQuestion;
    if (!q) return null;

    const answered = message.answered === true;
    const choice = message.answeredValue as 'sent' | 'received' | undefined;

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
                <p className="whitespace-pre-wrap break-words">
                    {message.text ?? `I couldn't tell which way this one went. ${q.amountLabel}, ${q.partyLabel}, ${q.dateLabel}. Money in or out?`}
                </p>

                {answered ? (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {choice === 'received' ? 'Marked money in.' : 'Marked money out.'}
                    </p>
                ) : (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => onAnswer(message.id, q.transactionCode, 'sent')}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--border-glass)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            Money out
                        </button>
                        <button
                            type="button"
                            onClick={() => onAnswer(message.id, q.transactionCode, 'received')}
                            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--border-glass)',
                                color: 'var(--text-primary)',
                            }}
                        >
                            Money in
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
