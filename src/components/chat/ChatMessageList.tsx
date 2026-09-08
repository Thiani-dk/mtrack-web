import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { ChatMessage, ParsedTransaction, SkippedMessage } from '../../types';
import type { DocumentContext } from './ChatReceipt';
import { ChatBubble } from './ChatBubble';
import { ChatThinking } from './ChatThinking';
import { ChatInsight } from './ChatInsight';
import { ChatRecurring } from './ChatRecurring';
import { ChatReceipt } from './ChatReceipt';
import { ChatSkippedReview } from './ChatSkippedReview';
import { ChatNearDuplicate } from './ChatNearDuplicate';
import { ChatDirectionQuestion } from './ChatDirectionQuestion';
import { ChatOptions } from './ChatOptions';
import { ChatCopyBlock } from './ChatCopyBlock';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { isNearBottom, shouldShowJumpToLatest } from '../../lib/chatScroll';

interface ChatMessageListProps {
    messages: ChatMessage[];
    onLabelChange?: (messageId: string, transactionCode: string, label: string | null) => void;
    onViewSkipped?: (skippedReviewId: string) => void;
    skippedReviewExpandSignal?: { id: string; epoch: number };
    onIncludeSkipped?: (messageId: string, entry: SkippedMessage, transaction: ParsedTransaction) => void;
    onUnexcludeSkipped?: (messageId: string, transactionCode: string) => void;
    onNearDuplicateKeep?: (messageId: string) => void;
    onNearDuplicateDrop?: (messageId: string, smallerTransactionCode: string) => void;
    onDirectionAnswer?: (messageId: string, transactionCode: string, direction: 'sent' | 'received') => void;
    onOptionSelect?: (messageId: string, value: string) => void;
    documentContext?: DocumentContext | null;
    onApproveDocument?: (messageId: string) => void;
    onEditTransaction?: (messageId: string, transactionCode: string, patch: Partial<ParsedTransaction>) => void;
    onEditContext?: (patch: Partial<DocumentContext>) => void;
}

const NO_SIGNAL = { id: '', epoch: 0 };

function ChatMessageItem({
    message, receiptTransactions, onLabelChange, onViewSkipped, skippedReviewExpandSignal, onIncludeSkipped, onUnexcludeSkipped,
    onNearDuplicateKeep, onNearDuplicateDrop, onDirectionAnswer, onOptionSelect,
    documentContext, onApproveDocument, onEditTransaction, onEditContext,
}: {
    message: ChatMessage;
    receiptTransactions: ParsedTransaction[];
    onLabelChange?: (messageId: string, transactionCode: string, label: string | null) => void;
    onViewSkipped?: (skippedReviewId: string) => void;
    skippedReviewExpandSignal?: { id: string; epoch: number };
    onIncludeSkipped?: (messageId: string, entry: SkippedMessage, transaction: ParsedTransaction) => void;
    onUnexcludeSkipped?: (messageId: string, transactionCode: string) => void;
    onNearDuplicateKeep?: (messageId: string) => void;
    onNearDuplicateDrop?: (messageId: string, smallerTransactionCode: string) => void;
    onDirectionAnswer?: (messageId: string, transactionCode: string, direction: 'sent' | 'received') => void;
    onOptionSelect?: (messageId: string, value: string) => void;
    documentContext?: DocumentContext | null;
    onApproveDocument?: (messageId: string) => void;
    onEditTransaction?: (messageId: string, transactionCode: string, patch: Partial<ParsedTransaction>) => void;
    onEditContext?: (patch: Partial<DocumentContext>) => void;
}) {
    switch (message.kind) {
        case 'text':
            return <ChatBubble message={message} onViewSkipped={onViewSkipped} />;
        case 'options':
            return message.options && message.options.length > 0 && onOptionSelect
                ? <ChatOptions message={message} onSelect={onOptionSelect} />
                : null;
        case 'copyable':
            return message.text ? <ChatCopyBlock text={message.text} /> : null;
        case 'thinking':
            return <ChatThinking />;
        case 'insight':
            return message.insight ? <ChatInsight insight={message.insight} /> : null;
        case 'recurring':
            return message.recurringPatterns && message.recurringPatterns.length > 0
                ? <ChatRecurring patterns={message.recurringPatterns} />
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
                        documentContext={documentContext}
                        approved={message.documentStatus === 'approved'}
                        onApprove={onApproveDocument && (() => onApproveDocument(message.id))}
                        onEditTransaction={onEditTransaction && ((code, patch) => onEditTransaction(message.id, code, patch))}
                        onEditContext={onEditContext}
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
        case 'near-duplicate':
            return message.nearDuplicatePair && onNearDuplicateKeep && onNearDuplicateDrop
                ? (
                    <ChatNearDuplicate
                        message={message}
                        onKeepBoth={onNearDuplicateKeep}
                        onDropSmall={onNearDuplicateDrop}
                    />
                )
                : null;
        case 'direction-question':
            return message.directionQuestion && onDirectionAnswer
                ? <ChatDirectionQuestion message={message} onAnswer={onDirectionAnswer} />
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
    onNearDuplicateKeep, onNearDuplicateDrop, onDirectionAnswer, onOptionSelect,
    documentContext, onApproveDocument, onEditTransaction, onEditContext,
}: ChatMessageListProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const nearBottomRef = useRef(true);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);

    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        nearBottomRef.current = isNearBottom(el.scrollHeight, el.clientHeight, el.scrollTop);
        setShowJumpToLatest(shouldShowJumpToLatest(el.scrollHeight, el.clientHeight, el.scrollTop));
    }, []);

    const scrollToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, []);

    useEffect(() => {
        if (nearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        // A message arriving while the user is reading back should surface the
        // button, so re-evaluate on every change, not only on scroll.
        handleScroll();
    }, [messages, handleScroll]);

    // The one receipt message's transactions — the source a 'skipped-review'
    // message's 'excluded' rows look up against for their display label and
    // un-exclude action. At most one receipt per session in practice.
    const receiptMessage = messages.find(m => m.kind === 'receipt');
    const receiptTransactions = receiptMessage?.transactions ?? [];

    return (
        <div className="relative flex-1 min-h-0 flex flex-col">
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
                            onNearDuplicateKeep={onNearDuplicateKeep}
                            onNearDuplicateDrop={onNearDuplicateDrop}
                            onDirectionAnswer={onDirectionAnswer}
                            onOptionSelect={onOptionSelect}
                            documentContext={documentContext}
                            onApproveDocument={onApproveDocument}
                            onEditTransaction={onEditTransaction}
                            onEditContext={onEditContext}
                        />
                    ))}
                </AnimatePresence>
            )}
            <div ref={bottomRef} />
        </div>
        <ScrollToBottomButton visible={showJumpToLatest} onClick={scrollToBottom} />
        </div>
    );
}
