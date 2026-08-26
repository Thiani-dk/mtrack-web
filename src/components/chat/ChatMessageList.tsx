import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { ChatMessage, ParsedTransaction, SkippedMessage } from '../../types';
import { ChatBubble } from './ChatBubble';
import { ChatThinking } from './ChatThinking';
import { ChatInsight } from './ChatInsight';
import { ChatRecurring } from './ChatRecurring';
import { ChatBadge } from './ChatBadge';
import { ChatReceipt } from './ChatReceipt';
import { ChatSkippedReview } from './ChatSkippedReview';

interface ChatMessageListProps {
    messages: ChatMessage[];
    onLabelChange?: (messageId: string, transactionCode: string, label: string | null) => void;
    onViewSkipped?: (skippedReviewId: string) => void;
    skippedReviewExpandSignal?: { id: string; epoch: number };
    onIncludeSkipped?: (messageId: string, entry: SkippedMessage, transaction: ParsedTransaction) => void;
    onUnexcludeSkipped?: (messageId: string, transactionCode: string) => void;
}

// How close to the bottom (px) counts as "already there" — below this we
// keep auto-scrolling on new messages; above it we assume the user is
// reading history and leave their scroll position alone.
const NEAR_BOTTOM_THRESHOLD = 120;

const NO_SIGNAL = { id: '', epoch: 0 };

function ChatMessageItem({
    message, receiptTransactions, onLabelChange, onViewSkipped, skippedReviewExpandSignal, onIncludeSkipped, onUnexcludeSkipped,
}: {
    message: ChatMessage;
    receiptTransactions: ParsedTransaction[];
    onLabelChange?: (messageId: string, transactionCode: string, label: string | null) => void;
    onViewSkipped?: (skippedReviewId: string) => void;
    skippedReviewExpandSignal?: { id: string; epoch: number };
    onIncludeSkipped?: (messageId: string, entry: SkippedMessage, transaction: ParsedTransaction) => void;
    onUnexcludeSkipped?: (messageId: string, transactionCode: string) => void;
}) {
    switch (message.kind) {
        case 'text':
            return <ChatBubble message={message} onViewSkipped={onViewSkipped} />;
        case 'thinking':
            return <ChatThinking />;
        case 'insight':
            return message.insight ? <ChatInsight insight={message.insight} /> : null;
        case 'recurring':
            return message.recurringPatterns && message.recurringPatterns.length > 0
                ? <ChatRecurring patterns={message.recurringPatterns} />
                : null;
        case 'badge':
            return message.badgeId
                ? <ChatBadge badgeId={message.badgeId} leadIn={message.badgeLeadIn ?? 'Badge unlocked.'} />
                : null;
        case 'receipt':
            return message.transactions && message.dateRange
                ? (
                    <ChatReceipt
                        messageId={message.id}
                        transactions={message.transactions}
                        dateRange={message.dateRange}
                        isDemo={message.isDemo}
                        onLabelChange={onLabelChange && ((code, label) => onLabelChange(message.id, code, label))}
                    />
                )
                : null;
        case 'skipped-review':
            return message.skippedMessages && message.skippedMessages.length > 0 && onIncludeSkipped && onUnexcludeSkipped
                ? (
                    <ChatSkippedReview
                        messageId={message.id}
                        skippedMessages={message.skippedMessages}
                        transactions={receiptTransactions}
                        expandSignal={skippedReviewExpandSignal ?? NO_SIGNAL}
                        onInclude={onIncludeSkipped}
                        onUnexclude={onUnexcludeSkipped}
                    />
                )
                : null;
        default:
            // Still placeholders: options, dropzone, transactions (Phase 5B)
            return (
                <div className="text-xs text-[var(--text-muted)] italic px-2">
                    [{message.kind}] — coming in Phase 5B
                </div>
            );
    }
}

export function ChatMessageList({
    messages, onLabelChange, onViewSkipped, skippedReviewExpandSignal, onIncludeSkipped, onUnexcludeSkipped,
}: ChatMessageListProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const nearBottomRef = useRef(true);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        nearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    };

    useEffect(() => {
        if (nearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    // The one receipt message's transactions — the source a 'skipped-review'
    // message's 'excluded' rows look up against for their display label and
    // un-exclude action. At most one receipt per session in practice.
    const receiptMessage = messages.find(m => m.kind === 'receipt');
    const receiptTransactions = receiptMessage?.transactions ?? [];

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
        >
            {messages.length === 0 ? (
                <p className="text-center text-xs text-[var(--text-muted)] py-16">
                    Say hi to get started.
                </p>
            ) : (
                <AnimatePresence initial={false}>
                    {messages.map(message => (
                        <ChatMessageItem
                            key={message.id}
                            message={message}
                            receiptTransactions={receiptTransactions}
                            onLabelChange={onLabelChange}
                            onViewSkipped={onViewSkipped}
                            skippedReviewExpandSignal={skippedReviewExpandSignal}
                            onIncludeSkipped={onIncludeSkipped}
                            onUnexcludeSkipped={onUnexcludeSkipped}
                        />
                    ))}
                </AnimatePresence>
            )}
            <div ref={bottomRef} />
        </div>
    );
}
