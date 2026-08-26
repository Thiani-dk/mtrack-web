import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

interface ChatComposerProps {
    onSend: (text: string) => void;
    disabled?: boolean;
    placeholder?: string;
}

const LINE_HEIGHT_PX = 20;
const MAX_LINES = 5;
const MAX_HEIGHT_PX = LINE_HEIGHT_PX * MAX_LINES;

export function ChatComposer({ onSend, disabled = false, placeholder = 'Message M-Track...' }: ChatComposerProps) {
    const [value, setValue] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
        el.style.height = `${next}px`;
        el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
    }, [value]);

    const handleSend = () => {
        const trimmed = value.trim();
        if (!trimmed || disabled) return;
        onSend(trimmed);
        setValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="relative flex-shrink-0">
            {/* Gradient fade so messages scroll out cleanly instead of clipping under the bar */}
            <div className="bottom-fade z-bottom-bar" style={{ position: 'absolute', bottom: '100%' }} />
            <div
                className="border-t border-[var(--border-glass)] p-3 md:p-4 z-bottom-bar relative"
                style={{
                    background: 'color-mix(in srgb, var(--bg-header-solid) 96%, transparent)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.12)',
                }}
            >
            <div className="flex items-end gap-2 rounded-2xl px-3 py-2 max-w-3xl mx-auto"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-glass)' }}>
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder={placeholder}
                    rows={1}
                    style={{ maxHeight: MAX_HEIGHT_PX }}
                    className="flex-1 resize-none bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] py-1.5 leading-tight disabled:opacity-50"
                />
                <motion.button
                    onClick={handleSend}
                    disabled={disabled || !value.trim()}
                    className="btn-primary flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl disabled:cursor-not-allowed"
                    whileTap={{ scale: 0.88 }}
                    aria-label="Send message"
                >
                    <ArrowUp className="w-4 h-4" />
                </motion.button>
            </div>
            </div>
        </div>
    );
}
