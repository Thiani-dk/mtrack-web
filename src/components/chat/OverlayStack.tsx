import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

// Shared card-stack depth metaphor for every .glass-panel overlay in the
// app: skipped-review, the badge evidence sheet, the label picker, and the
// manual-entry form that can open on top of a skipped-review row. A panel
// further down the stack recedes (scaled down, dimmed, shifted) rather than
// being replaced or hidden; closing the top panel reverses that exactly.
// One shared provider, mounted once at the app root, so every overlay
// anywhere participates in the same stack regardless of which screen it's on.
//
// StackedPanel deliberately does NOT own each panel's own fresh open/close
// transition — every existing overlay already has its own established
// entrance (the badge sheet slides up from the bottom, the inline panels
// height-expand) and duplicating that here would fight it. StackedPanel only
// ever adds one thing on top: the recede transform for whatever isn't
// currently at the top of the stack. Callers keep mounting/unmounting their
// own content exactly as they already do (their own AnimatePresence, their
// own conditional render) and just wrap the panel body in <StackedPanel>.

interface StackEntry {
    id: string;
    onClose: () => void;
    // Lightweight inline panels (e.g. the label picker, sitting inside an
    // already-open transaction row) don't need the app to go dark behind
    // them — they still track their position in the stack (so they recede
    // correctly if something else opens on top), they just don't
    // contribute their own scrim. The shared scrim renders whenever ANY
    // entry in the stack wants one.
    scrim: boolean;
}

interface OverlayStackContextValue {
    stack: StackEntry[];
    register: (entry: StackEntry) => void;
    unregister: (id: string) => void;
}

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null);

export function OverlayStackProvider({ children }: { children: ReactNode }) {
    const [stack, setStack] = useState<StackEntry[]>([]);
    const reducedMotion = useReducedMotion();

    const register = (entry: StackEntry) => {
        setStack(prev => [...prev.filter(e => e.id !== entry.id), entry]);
    };
    const unregister = (id: string) => {
        setStack(prev => prev.filter(e => e.id !== id));
    };

    const showScrim = stack.some(e => e.scrim);
    const closeTop = () => {
        // Tap-outside (or an explicit close control routed through the
        // scrim) always closes only the top of the stack, never everything
        // at once.
        stack[stack.length - 1]?.onClose();
    };

    return (
        <OverlayStackContext.Provider value={{ stack, register, unregister }}>
            {children}
            <AnimatePresence>
                {showScrim && (
                    <motion.div
                        className="fixed inset-0"
                        style={{ background: 'var(--scrim)', zIndex: 45 }}
                        initial={reducedMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={reducedMotion ? undefined : { opacity: 0 }}
                        onClick={closeTop}
                    />
                )}
            </AnimatePresence>
        </OverlayStackContext.Provider>
    );
}

function useOverlayStackContext(): OverlayStackContextValue {
    const ctx = useContext(OverlayStackContext);
    if (!ctx) throw new Error('StackedPanel must be rendered inside an OverlayStackProvider');
    return ctx;
}

interface StackedPanelProps {
    id: string;
    onClose: () => void;
    // Defaults true (a real modal/sheet). Set false for a panel that's
    // already inline in the page and has no backdrop of its own.
    scrim?: boolean;
    className?: string;
    children: ReactNode;
}

// Registers itself on the shared stack for as long as it's mounted (the
// caller controls mounting — their own AnimatePresence/conditional render,
// unchanged) and layers the current-depth recede transform on top of
// whatever `children` already renders.
export function StackedPanel({ id, onClose, scrim = true, className = '', children }: StackedPanelProps) {
    const { stack, register, unregister } = useOverlayStackContext();
    const reducedMotion = useReducedMotion();

    // Keeps the registration effect from needing `onClose` in its dependency
    // array (which would re-register — and briefly move this entry to the
    // top of the stack — on every render where the caller passes a fresh
    // closure). Updated in its own no-deps effect rather than during render,
    // since writing a ref synchronously in the render body isn't allowed.
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        register({ id, onClose: () => onCloseRef.current(), scrim });
        return () => unregister(id);
    }, [id, scrim, register, unregister]);

    const index = stack.findIndex(e => e.id === id);
    const depthFromTop = index === -1 ? 0 : stack.length - 1 - index;
    const receded = depthFromTop > 0;

    const scale = Math.max(0.88, 1 - 0.04 * depthFromTop);
    const shiftY = 8 * depthFromTop;
    const brightness = Math.max(0.7, 1 - 0.15 * depthFromTop);

    return (
        <motion.div
            className={className}
            // Positioning (fixed/absolute/inset/etc.) is entirely up to the
            // caller's className — this wrapper only ever adds zIndex, never
            // a `position` value, so it can't clobber a true fixed-position
            // modal's own positioning (inline styles beat classes).
            style={{ zIndex: 50 + Math.max(index, 0), pointerEvents: receded ? 'none' : 'auto' }}
            animate={{
                scale: receded ? scale : 1,
                y: receded ? shiftY : 0,
                filter: receded ? `brightness(${brightness})` : 'brightness(1)',
            }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
        >
            {children}
        </motion.div>
    );
}
