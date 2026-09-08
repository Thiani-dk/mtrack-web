import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface ScrollToBottomButtonProps {
    visible: boolean;
    onClick: () => void;
    // Distance in px from the bottom of the scroll area. The default clears the
    // 28px gradient fade that sits above the composer; a screen with a taller
    // sticky bottom bar passes its own offset rather than reimplementing this.
    bottomOffset?: number;
}

// Shared jump-to-latest control for any scrolling message list. Presentational
// on purpose: the scroll container already knows its own distance from the
// bottom, so visibility is decided there and passed in, and no second scroll
// listener is attached.
export function ScrollToBottomButton({ visible, onClick, bottomOffset = 40 }: ScrollToBottomButtonProps) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.button
                    type="button"
                    onClick={onClick}
                    aria-label="Jump to the latest message"
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    whileTap={{ scale: 0.92 }}
                    className="glass-panel absolute right-4 z-chip-row flex items-center justify-center w-9 h-9 rounded-full"
                    style={{ bottom: bottomOffset, color: 'var(--text-primary)' }}
                >
                    <ChevronDown className="w-4 h-4" />
                </motion.button>
            )}
        </AnimatePresence>
    );
}
