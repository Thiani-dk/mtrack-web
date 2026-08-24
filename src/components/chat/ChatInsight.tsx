import { useState } from 'react';
import { motion } from 'framer-motion';
import { Share2, Check } from 'lucide-react';
import type { Insight } from '../../lib/insights/types';
import { buildInsightShareSnippet } from '../../lib/insights';
import { share } from '../../lib/shareUtils';

interface ChatInsightProps {
    insight: Insight;
}

export function ChatInsight({ insight }: ChatInsightProps) {
    const [done, setDone] = useState<'shared' | 'copied' | null>(null);

    const handleShare = async () => {
        const text = buildInsightShareSnippet(insight);
        const result = await share({ title: 'Something I found with M-Track', text });
        if (result === 'copied' || result === 'shared') {
            setDone(result);
            setTimeout(() => setDone(null), 2000);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[80%] px-4 py-3">
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                    {insight.emoji && <span className="mr-1.5">{insight.emoji}</span>}
                    {insight.headline}
                </p>
                {insight.detail && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{insight.detail}</p>
                )}
                {insight.shareable && (
                    <motion.button
                        onClick={handleShare}
                        className="mt-2 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg"
                        style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                        whileTap={{ scale: 0.95 }}
                    >
                        {done ? <Check className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                        {done === 'copied' ? 'Copied' : done === 'shared' ? 'Shared' : 'Share this'}
                    </motion.button>
                )}
            </div>
        </motion.div>
    );
}
