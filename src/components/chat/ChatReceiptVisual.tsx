import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ParsedTransaction } from '../../types';
import type { ReceiptData } from '../../lib/receiptGenerator';
import { fmt, getRecipientShort, getProviderSuffix, categoryKeyFor } from '../../lib/receiptGenerator';
import { providerChipLabel } from '../../lib/transactionDisplay';
import { CountUp } from '../CountUp';
import { TransactionSkeleton } from './TransactionSkeleton';
import { StackedPanel } from './OverlayStack';

interface ChatReceiptVisualProps {
    data: ReceiptData;
    dateRange: string;
    playEntrance: boolean;
    onLabelChange?: (transactionCode: string, label: string | null) => void;
}

// Preset set carried over from the deleted ReviewScreen.tsx.
const LABEL_PRESETS = ['Transport', 'Accommodation', 'Fuel', 'Medical Aid'];

// ── Reveal timing — fixed anchors (not chained sums) so the sequence stays
// bounded regardless of transaction/category count. Seconds. ──────────────
// Card grow: stiffness 300 / damping 30 / mass 0.8 settles in ~0.5s.
const HEADER_START = 0.3;
const HEADER_STAGGER = 0.08;
const TX_START = 0.55;
const TX_PHASE_WIDTH = 0.85;
const TX_DISPLAY_CAP = 8;
const TX_GROUP_THRESHOLD = 12; // only group the remainder past the cap once there are this many or more
const CAT_START = 1.55;
const CAT_PHASE_WIDTH = 0.4;
const CAT_BAR_DURATION = 0.4;
const TALLY_START = 1.95;
const TALLY_STAGGER = 0.08;
const TALLY_DURATION = 0.4;
const GRAND_TOTAL_DELAY = TALLY_START + TALLY_STAGGER * 2 + TALLY_DURATION * 0.5 + 0.15;
const GLOW_DURATION = 0.6;

const headerContainer: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: HEADER_STAGGER, delayChildren: HEADER_START } },
};
const headerItem: Variants = {
    hidden: { opacity: 0, y: -6 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } },
};

function fmtCount(n: number): string {
    return String(Math.round(n));
}

// ── Label picker — inline within the row's existing .glass-panel, never a
// second glass surface stacked on top of it. ──────────────────────────────

function LabelPicker({ current, onSelect }: { current: string | null; onSelect: (label: string | null) => void }) {
    const [showOther, setShowOther] = useState(false);
    const [otherText, setOtherText] = useState('');

    const commitOther = () => {
        const trimmed = otherText.trim();
        if (trimmed) onSelect(trimmed);
        setShowOther(false);
        setOtherText('');
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
            {LABEL_PRESETS.map(preset => (
                <button
                    key={preset}
                    onClick={() => onSelect(preset)}
                    className="text-[10px] font-medium px-2 py-1 rounded-full"
                    style={current === preset
                        ? { background: 'var(--accent)', color: '#ffffff' }
                        : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                    {preset}
                </button>
            ))}
            {!showOther ? (
                <button
                    onClick={() => setShowOther(true)}
                    className="text-[10px] font-medium px-2 py-1 rounded-full"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                    Other
                </button>
            ) : (
                <input
                    autoFocus
                    value={otherText}
                    onChange={e => setOtherText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitOther(); }}
                    onBlur={commitOther}
                    placeholder="Custom label…"
                    className="text-[10px] px-2 py-1 rounded-full flex-1 min-w-[96px] outline-none"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                />
            )}
            {current != null && (
                <button
                    onClick={() => onSelect(null)}
                    className="text-[10px] font-medium px-2 py-1 text-[var(--text-muted)]"
                >
                    Clear
                </button>
            )}
        </div>
    );
}

// ── Transaction row ─────────────────────────────────────────────────────────

function TransactionRow({
    t, delay, animateEntrance, onLabelChange,
}: {
    t: ParsedTransaction; delay: number; animateEntrance: boolean;
    onLabelChange?: (label: string | null) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const sign = t.type === 'sent' ? '-' : '+';
    const providerTag = getProviderSuffix(t);

    return (
        <motion.div
            initial={animateEntrance ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={animateEntrance ? { type: 'spring', stiffness: 400, damping: 28, delay } : undefined}
            className="relative border-b border-[var(--border-glass)] last:border-0"
        >
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between gap-2 py-2 text-left"
            >
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {getRecipientShort(t)}
                        {providerTag && <span className="text-[var(--text-muted)] font-normal"> · {providerTag}</span>}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        {t.receiptLabel ? ` · ${t.receiptLabel}` : t.merchantCategory ? ` · ${t.merchantCategory}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                        {sign}{fmt(t.amount)}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {/* Skeleton crossfades out over the real row above, on the same
                stagger delay — a placeholder resolving into content, not a
                slide-in from nothing. */}
            {animateEntrance && (
                <motion.div
                    className="absolute inset-0 pointer-events-none"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28, delay }}
                >
                    <TransactionSkeleton />
                </motion.div>
            )}

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="glass-panel rounded-lg p-2 mb-2 space-y-1 text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-muted)]">Label</span>
                                <button
                                    onClick={() => setPickerOpen(o => !o)}
                                    className="font-medium text-right"
                                    style={{ color: t.receiptLabel ? 'var(--text-primary)' : 'var(--accent)' }}
                                >
                                    {t.receiptLabel ?? 'Add label'}
                                </button>
                            </div>
                            <AnimatePresence initial={false}>
                                {pickerOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="overflow-hidden"
                                    >
                                        {/* No scrim of its own — it's already inline inside this
                                            row's open detail panel. It still joins the shared stack
                                            purely so it recedes correctly if anything scrimmed ever
                                            opens above it. */}
                                        <StackedPanel id={`label-picker-${t.transactionCode}`} onClose={() => setPickerOpen(false)} scrim={false}>
                                            <LabelPicker
                                                current={t.receiptLabel}
                                                onSelect={label => {
                                                    onLabelChange?.(label);
                                                    setPickerOpen(false);
                                                }}
                                            />
                                        </StackedPanel>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            {t.merchant && (
                                <div className="flex justify-between gap-2">
                                    <span className="text-[var(--text-muted)]">Merchant</span>
                                    <span className="text-[var(--text-primary)]">{t.merchant}</span>
                                </div>
                            )}
                            {t.location && (
                                <div className="flex justify-between gap-2">
                                    <span className="text-[var(--text-muted)]">Location</span>
                                    <span className="text-[var(--text-primary)]">{t.location}</span>
                                </div>
                            )}
                            <div className="flex justify-between gap-2">
                                <span className="text-[var(--text-muted)]">Provider</span>
                                <span className="text-[var(--text-primary)]">{providerChipLabel(t)}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                                <span className="text-[var(--text-muted)]">Ref</span>
                                <span className="font-mono text-[var(--text-primary)]">{t.transactionCode}</span>
                            </div>
                            {t.transactionCost != null && t.transactionCost > 0 && (
                                <div className="flex justify-between gap-2">
                                    <span className="text-[var(--text-muted)]">Fee</span>
                                    <span className="text-[var(--text-primary)]">{fmt(t.transactionCost)}</span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ── Category bar ────────────────────────────────────────────────────────────

function CategoryBar({
    label, total, count, pct, delay, animateEntrance, hasSettled, transactions,
}: {
    label: string; total: number; count: number; pct: number; delay: number; animateEntrance: boolean;
    hasSettled: boolean;
    transactions: ParsedTransaction[];
}) {
    const [expanded, setExpanded] = useState(false);
    const reducedMotion = useReducedMotion();

    // Once the entrance sequence has settled, a bar's width still animates
    // when its total changes (e.g. a transaction gets relabelled into or out
    // of this category) — but as a quick, undelayed "update in place", not
    // a replay of the original staggered entrance timing. Reduced motion
    // disables this too, same as the entrance itself.
    const widthTransition = reducedMotion
        ? { duration: 0 }
        : animateEntrance && !hasSettled
            ? { duration: CAT_BAR_DURATION, delay, ease: 'easeOut' as const }
            : { duration: 0.3, ease: 'easeOut' as const };

    return (
        <div>
            <button onClick={() => setExpanded(e => !e)} className="w-full text-left py-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-[var(--text-secondary)] truncate">{label} <span className="text-[var(--text-muted)]">×{count}</span></span>
                    <span className="text-[11px] font-medium tabular-nums text-[var(--text-primary)] flex-shrink-0">{fmt(total)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'var(--accent)' }}
                        initial={animateEntrance ? { width: '0%' } : false}
                        animate={{ width: `${pct}%` }}
                        transition={widthTransition}
                    />
                </div>
            </button>

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="glass-panel rounded-lg p-2 mb-2 mt-1 space-y-1.5">
                            {transactions.map(t => (
                                <div key={t.transactionCode} className="flex items-center justify-between gap-2 text-[11px]">
                                    <div className="min-w-0 flex-1">
                                        <span className="text-[var(--text-secondary)]">
                                            {t.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                        </span>
                                        <span className="text-[var(--text-primary)] ml-1.5 truncate">{getRecipientShort(t)}</span>
                                    </div>
                                    <span className="font-medium text-[var(--text-primary)] tabular-nums flex-shrink-0">{fmt(t.amount)}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Main visual ──────────────────────────────────────────────────────────────

export function ChatReceiptVisual({ data, dateRange, playEntrance, onLabelChange }: ChatReceiptVisualProps) {
    const reducedMotion = useReducedMotion();
    const animateEntrance = playEntrance && !reducedMotion;
    const [grandReplay, setGrandReplay] = useState(0);
    const [restExpanded, setRestExpanded] = useState(false);

    // Flips once the entrance sequence has visually finished — after that,
    // data-driven changes (e.g. a label edit reshaping the category bars)
    // update in place with a quick tween instead of the anchored entrance
    // delays. Starts settled if there was no entrance to play in the first
    // place (reduced motion, or a message loaded from history).
    const [hasSettled, setHasSettled] = useState(!animateEntrance);
    useEffect(() => {
        if (!animateEntrance) return;
        const timer = setTimeout(() => setHasSettled(true), (GRAND_TOTAL_DELAY + GLOW_DURATION) * 1000);
        return () => clearTimeout(timer);
    }, [animateEntrance]);

    const txs = data.activeTransactions;
    const groupRemainder = txs.length > TX_GROUP_THRESHOLD;
    const capped = groupRemainder ? txs.slice(0, TX_DISPLAY_CAP) : txs;
    const rest = groupRemainder ? txs.slice(TX_DISPLAY_CAP) : [];
    const rowStagger = capped.length > 0 ? Math.min(0.09, Math.max(0.05, TX_PHASE_WIDTH / capped.length)) : 0;
    const restDelay = TX_START + capped.length * rowStagger;

    const categories = Object.entries(data.labelTotals).sort((a, b) => b[1] - a[1]);
    const maxCatTotal = Math.max(...categories.map(([, total]) => total), 1);
    const catStagger = categories.length > 0 ? Math.min(0.06, Math.max(0.02, CAT_PHASE_WIDTH / categories.length)) : 0;

    const countDelay = TALLY_START;
    const amountDelay = TALLY_START + TALLY_STAGGER;
    const costDelay = TALLY_START + TALLY_STAGGER * 2;

    return (
        <motion.div
            initial={animateEntrance ? { clipPath: 'inset(0 0 100% 0)' } : false}
            animate={{ clipPath: 'inset(0 0 0% 0)' }}
            transition={animateEntrance ? { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 } : undefined}
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-elevated)' }}
        >
            <div className="p-3">
                {/* Header */}
                <motion.div
                    variants={headerContainer}
                    initial={animateEntrance ? 'hidden' : false}
                    animate="show"
                    className="mb-2 pb-2 border-b border-[var(--border-glass)]"
                >
                    <motion.div variants={headerItem} className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                        <span>{data.secCode}</span>
                        <span>{data.currentDate}</span>
                    </motion.div>
                    <motion.div variants={headerItem} className="text-xs font-semibold text-[var(--text-primary)] mt-1">
                        REF: {data.receiptRef}
                    </motion.div>
                    <motion.div variants={headerItem} className="text-[10px] text-[var(--text-muted)]">
                        {dateRange.toUpperCase()}
                    </motion.div>
                </motion.div>

                {/* Transaction rows */}
                <div className="mb-2">
                    {capped.map((t, i) => (
                        <TransactionRow
                            key={t.transactionCode}
                            t={t}
                            delay={TX_START + i * rowStagger}
                            animateEntrance={animateEntrance}
                            onLabelChange={onLabelChange && (label => onLabelChange(t.transactionCode, label))}
                        />
                    ))}
                    {rest.length > 0 && (
                        <motion.div
                            initial={animateEntrance ? { opacity: 0, x: -16 } : false}
                            animate={{ opacity: 1, x: 0 }}
                            transition={animateEntrance ? { type: 'spring', stiffness: 400, damping: 28, delay: restDelay } : undefined}
                        >
                            <button
                                onClick={() => setRestExpanded(e => !e)}
                                className="w-full flex items-center justify-between py-2 text-xs text-[var(--accent)] font-medium"
                            >
                                <span>+{rest.length} more transaction{rest.length !== 1 ? 's' : ''}</span>
                                <ChevronDown className={`w-3 h-3 transition-transform ${restExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            <AnimatePresence initial={false}>
                                {restExpanded && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="overflow-hidden"
                                    >
                                        {rest.map(t => (
                                            <TransactionRow
                                                key={t.transactionCode}
                                                t={t}
                                                delay={0}
                                                animateEntrance={false}
                                                onLabelChange={onLabelChange && (label => onLabelChange(t.transactionCode, label))}
                                            />
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </div>

                {/* Category summary */}
                {categories.length > 0 && (
                    <div className="mb-2 pt-2 border-t border-[var(--border-glass)] space-y-2">
                        {categories.map(([label, total], i) => (
                            <CategoryBar
                                key={label}
                                label={label}
                                total={total}
                                count={data.labelCounts[label]}
                                pct={(total / maxCatTotal) * 100}
                                delay={CAT_START + i * catStagger}
                                animateEntrance={animateEntrance}
                                hasSettled={hasSettled}
                                transactions={txs.filter(t => categoryKeyFor(t) === label)}
                            />
                        ))}
                    </div>
                )}

                {/* Tally — finale */}
                <div className="pt-2 border-t border-[var(--border-glass)] space-y-1">
                    <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                        <span>Transactions counted</span>
                        <span className="tabular-nums">
                            <CountUp value={data.totalTransactionCount} format={fmtCount} duration={0.4} delay={countDelay} play={animateEntrance} />
                        </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                        <span>Total transaction amount</span>
                        <span className="tabular-nums">
                            <CountUp value={data.totalTransactionAmount} format={fmt} duration={TALLY_DURATION} delay={amountDelay} play={animateEntrance} />
                        </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                        <span>Total transaction cost</span>
                        <span className="tabular-nums">
                            <CountUp value={data.totalTransactionCost} format={fmt} duration={TALLY_DURATION} delay={costDelay} play={animateEntrance} />
                        </span>
                    </div>

                    <motion.button
                        onClick={() => setGrandReplay(k => k + 1)}
                        className="relative w-full flex justify-between items-center pt-2 mt-1 border-t border-[var(--border-glass)] text-left"
                        initial={animateEntrance ? { opacity: 0, scale: 0.9 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={animateEntrance ? { type: 'spring', stiffness: 260, damping: 15, delay: GRAND_TOTAL_DELAY } : undefined}
                        whileTap={{ scale: 0.97 }}
                    >
                        <AnimatePresence>
                            {!reducedMotion && (animateEntrance || grandReplay > 0) && (
                                <motion.div
                                    key={grandReplay}
                                    className="absolute inset-0 pointer-events-none rounded-lg"
                                    style={{ background: 'radial-gradient(circle at center, var(--accent-glow), transparent 70%)' }}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: [0, 1, 0] }}
                                    transition={{ duration: GLOW_DURATION, delay: grandReplay > 0 ? 0 : GRAND_TOTAL_DELAY }}
                                />
                            )}
                        </AnimatePresence>
                        <span className="text-sm font-bold relative" style={{ color: 'var(--accent)' }}>GRAND TOTAL</span>
                        <span className="text-sm font-bold tabular-nums relative" style={{ color: 'var(--accent)' }}>
                            <CountUp
                                value={data.grandTotal}
                                format={fmt}
                                duration={0.5}
                                delay={grandReplay > 0 ? 0 : GRAND_TOTAL_DELAY}
                                play={animateEntrance || grandReplay > 0}
                                replayKey={grandReplay}
                            />
                        </span>
                    </motion.button>
                </div>
            </div>
        </motion.div>
    );
}
