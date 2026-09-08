import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';

// A monospace, bordered, copy-to-clipboard block. Used once, in the demo, to
// show what a real M-Pesa message looks like so the user can send it back and
// watch the parser work on it.
export function ChatCopyBlock({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked (permissions, insecure context) — the user can
            // still select the text by hand.
            setCopied(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex justify-start"
        >
            <div className="glass-card max-w-[85%] w-full px-3 py-3">
                <div
                    className="rounded-xl p-3"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-glass)' }}
                >
                    <pre
                        className="text-xs leading-relaxed whitespace-pre-wrap break-words m-0"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: 'var(--text-primary)' }}
                    >{text}</pre>
                </div>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="btn-secondary mt-2.5 min-h-[36px] w-full rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
                >
                    {copied
                        ? <><Check className="w-3.5 h-3.5" /> Copied</>
                        : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
            </div>
        </motion.div>
    );
}
