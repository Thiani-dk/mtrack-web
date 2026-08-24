import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatShellProps {
    sidebarOpen: boolean;
    onCloseSidebar: () => void;
    sidebar: ReactNode;
    children: ReactNode;
}

export function ChatShell({ sidebarOpen, onCloseSidebar, sidebar, children }: ChatShellProps) {
    return (
        <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--bg-base)' }}>
            {/* Desktop sidebar */}
            <div
                className="hidden md:flex md:flex-col md:w-[280px] md:flex-shrink-0 border-r border-[var(--border-glass)]"
                style={{ background: 'var(--bg-surface)' }}
            >
                {sidebar}
            </div>

            {/* Mobile drawer */}
            <AnimatePresence>
                {sidebarOpen && (
                    <>
                        <motion.div
                            key="scrim"
                            className="fixed inset-0 z-scrim md:hidden"
                            style={{ background: 'var(--scrim)' }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={onCloseSidebar}
                        />
                        <motion.div
                            key="drawer"
                            className="fixed inset-y-0 left-0 z-modal w-[280px] max-w-[85vw] flex flex-col md:hidden"
                            style={{ background: 'var(--bg-overlay)' }}
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                        >
                            {sidebar}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Main chat column */}
            <div className="flex flex-col flex-1 min-w-0 h-screen">
                {children}
            </div>
        </div>
    );
}
