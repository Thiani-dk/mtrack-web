import { motion, useReducedMotion } from 'framer-motion';

// Sweeps a lighter band left-to-right across the bar, looping. Built from
// the existing --bg-surface/--bg-elevated tokens (not a hardcoded grey) so
// it reads correctly in both themes. Static (no animate prop at all) under
// prefers-reduced-motion — just the plain --bg-elevated fill.
const SHIMMER_STYLE: React.CSSProperties = {
    backgroundImage: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%)',
    backgroundSize: '200% 100%',
};

function ShimmerBar({ className, animate }: { className: string; animate: boolean }) {
    if (!animate) {
        return <div className={className} style={{ background: 'var(--bg-elevated)' }} />;
    }
    return (
        <motion.div
            className={className}
            style={SHIMMER_STYLE}
            animate={{ backgroundPosition: ['150% 0%', '-150% 0%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        />
    );
}

// Matches TransactionRow's collapsed layout exactly (same py-2, same gap,
// same two-line-left / amount-plus-chevron-right shape) so swapping between
// this and the real row causes zero layout shift.
export function TransactionSkeleton() {
    const reducedMotion = useReducedMotion();
    const animate = !reducedMotion;

    return (
        <div className="flex items-center justify-between gap-2 py-2 border-b border-[var(--border-glass)] last:border-0">
            <div className="min-w-0 flex-1 space-y-1.5">
                <ShimmerBar className="h-3 w-2/5 rounded" animate={animate} />
                <ShimmerBar className="h-2.5 w-1/4 rounded" animate={animate} />
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
                <ShimmerBar className="h-3 w-12 rounded" animate={animate} />
                <ShimmerBar className="h-3 w-3 rounded-full" animate={animate} />
            </div>
        </div>
    );
}
