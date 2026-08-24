import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import type { ChatSession } from '../../types';

interface ChatSidebarProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onNewSession: () => void;
    onSelectSession: (id: string) => void;
    onDeleteSession: (id: string) => void;
}

function fmt(n: number): string {
    return `Ksh ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function shortRelativeTime(ts: number): string {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return 'now';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const week = Math.floor(day / 7);
    if (week < 5) return `${week}w ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month}mo ago`;
    const year = Math.floor(day / 365);
    return `${year}y ago`;
}

export function ChatSidebar({
    sessions, activeSessionId, onNewSession, onSelectSession, onDeleteSession,
}: ChatSidebarProps) {
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const handleDeleteTap = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirmDeleteId === id) {
            setConfirmDeleteId(null);
            onDeleteSession(id);
        } else {
            setConfirmDeleteId(id);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-[var(--border-glass)]">
                <motion.button
                    onClick={onNewSession}
                    className="btn-primary w-full min-h-[44px] rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
                    whileTap={{ scale: 0.97 }}
                >
                    <Plus className="w-4 h-4" />
                    New Receipt
                </motion.button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                {sessions.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] text-center py-8">No receipts yet</p>
                ) : (
                    sessions.map(session => {
                        const active = session.id === activeSessionId;
                        const confirming = confirmDeleteId === session.id;
                        return (
                            <motion.div
                                key={session.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => onSelectSession(session.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter') onSelectSession(session.id); }}
                                className="group relative w-full text-left rounded-xl px-3 py-2.5 cursor-pointer transition-colors"
                                style={active
                                    ? { background: 'var(--accent-subtle)', borderLeft: '2px solid var(--accent)' }
                                    : { borderLeft: '2px solid transparent' }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p
                                            className="text-sm font-medium truncate"
                                            style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}
                                        >
                                            {session.title}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                                            {shortRelativeTime(session.updatedAt)}
                                            {session.transactionCount > 0 &&
                                                ` · ${session.transactionCount} txn${session.transactionCount !== 1 ? 's' : ''} · ${fmt(session.totalSpent)}`}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => handleDeleteTap(e, session.id)}
                                        className="flex-shrink-0 p-1.5 rounded-lg transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        style={confirming
                                            ? { background: 'rgba(239,68,68,0.15)', color: '#ef4444', opacity: 1 }
                                            : { color: 'var(--text-muted)' }}
                                        aria-label="Delete session"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
