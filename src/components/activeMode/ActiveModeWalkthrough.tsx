import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { ParsedTransaction } from '../../types';
import { bucketTallies, capture, fileInto, readActiveModeState } from '../../lib/activeMode/session';
import {
    buildPracticeSaleMessage, SCREEN_SHARING_STEPS, SUGGESTED_BUCKETS,
} from '../../lib/activeMode/walkthrough';
import { fmtCurrency } from '../../lib/receiptGenerator';

// The first-run walkthrough: what this screen is for, how to get messages
// across from the SMS app, a head start on buckets, one practice sale, and a
// one-line recap.
//
// The practice round runs on this component's own throwaway state, using the
// same capture() and bucketTallies() the real screen uses. That is deliberate:
// the demo's standing rule is that nothing from a practice run is ever saved,
// and the surest way to honour it is for the practice capture to have nowhere
// to leak to. When this closes, the practice sale ceases to exist.

interface ActiveModeWalkthroughProps {
    onClose: () => void;
    // Buckets the vendor picked, handed to the real session on finish. The
    // only thing that survives — names are setup, not captured data.
    onSeedBuckets: (names: string[]) => void;
}

type Step = 'what' | 'sharing' | 'buckets' | 'practice' | 'recap';
const ORDER: Step[] = ['what', 'sharing', 'buckets', 'practice', 'recap'];

export function ActiveModeWalkthrough({ onClose, onSeedBuckets }: ActiveModeWalkthroughProps) {
    const [step, setStep] = useState<Step>('what');
    const [chosen, setChosen] = useState<string[]>([]);
    const [ownName, setOwnName] = useState('');
    const [copied, setCopied] = useState(false);

    // Practice state. Local, throwaway, never persisted.
    const practiceMessage = useMemo(() => buildPracticeSaleMessage(), []);
    const [practicePending, setPracticePending] = useState<ParsedTransaction | null>(null);
    const [practiceFiled, setPracticeFiled] = useState<ParsedTransaction[]>([]);
    const [practiceError, setPracticeError] = useState('');
    const practiceInputRef = useRef<HTMLTextAreaElement>(null);

    const practiceBuckets = readActiveModeState({ buckets: chosen.length > 0 ? chosen : SUGGESTED_BUCKETS });
    const practiceTallies = bucketTallies(practiceBuckets, practiceFiled);

    const index = ORDER.indexOf(step);
    const go = (to: Step) => setStep(to);

    const toggleBucket = (name: string) => {
        setChosen(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
    };

    const addOwn = () => {
        const name = ownName.trim();
        if (!name) return;
        if (!chosen.some(n => n.toLowerCase() === name.toLowerCase())) setChosen(prev => [...prev, name]);
        setOwnName('');
    };

    const copyPractice = async () => {
        try {
            await navigator.clipboard.writeText(practiceMessage);
            setCopied(true);
        } catch {
            // Clipboard blocked — the message is on screen and selectable, and
            // the field below accepts it typed or pasted by hand.
            setCopied(false);
        }
        practiceInputRef.current?.focus();
    };

    const runPractice = useCallback((text: string) => {
        const result = capture(text);
        if (!result.transaction) {
            setPracticeError("That didn't come through as a sale — paste the whole message.");
            return;
        }
        setPracticeError('');
        setPracticePending(result.transaction);
    }, []);

    const filePractice = (bucket: string) => {
        if (!practicePending) return;
        setPracticeFiled(prev => [...prev, fileInto(practicePending, bucket)]);
        setPracticePending(null);
    };

    const finish = () => {
        // Buckets carry over; the practice sale does not.
        onSeedBuckets(chosen);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
            <div
                className="w-full max-w-md rounded-2xl bg-[var(--bg-base)] border border-[var(--border-glass)] flex flex-col"
                style={{ maxHeight: '92dvh' }}
                role="dialog"
                aria-label="How Active Mode works"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-glass)] flex-shrink-0">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                        How Active Mode works · {index + 1} of {ORDER.length}
                    </p>
                    <button onClick={onClose} aria-label="Close" className="text-[var(--text-muted)] p-1">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
                    {step === 'what' && (
                        <>
                            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                Fast tracking for a busy day
                            </h2>
                            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                                This screen is built for a queue. There's no conversation and nothing to answer —
                                you paste each payment message as it arrives and tap which kind of sale it was.
                                That's it.
                            </p>
                            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                                The running total at the top updates as you go, and you can generate the day's
                                report whenever your shift ends.
                            </p>
                        </>
                    )}

                    {step === 'sharing' && (
                        <>
                            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                Getting the messages across
                            </h2>
                            {SCREEN_SHARING_STEPS.map(s => (
                                <div key={s.heading} className="rounded-xl border border-[var(--border-glass)] p-3">
                                    <p className="text-sm font-medium text-[var(--text-primary)]">{s.heading}</p>
                                    <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">{s.body}</p>
                                </div>
                            ))}
                        </>
                    )}

                    {step === 'buckets' && (
                        <>
                            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                What are you selling?
                            </h2>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Pick any that fit, or name your own. You can add more at any time later.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {SUGGESTED_BUCKETS.map(name => (
                                    <button
                                        key={name}
                                        onClick={() => toggleBucket(name)}
                                        className="rounded-full border px-3 py-1.5 text-xs"
                                        style={{
                                            borderColor: chosen.includes(name) ? 'var(--accent)' : 'var(--border-glass)',
                                            background: chosen.includes(name) ? 'var(--accent-subtle)' : 'transparent',
                                            color: 'var(--text-primary)',
                                        }}
                                    >
                                        {chosen.includes(name) && <Check className="w-3 h-3 inline mr-1" />}
                                        {name}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2 pt-1">
                                <input
                                    value={ownName}
                                    onChange={e => setOwnName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addOwn(); }}
                                    placeholder="Add your own"
                                    aria-label="Add your own bucket"
                                    className="flex-1 rounded-full border px-3 py-1.5 text-xs bg-transparent text-[var(--text-primary)] outline-none"
                                    style={{ borderColor: 'var(--border-glass-accent)' }}
                                />
                                <button onClick={addOwn} className="text-xs px-3 py-1.5 rounded-full text-[var(--accent)]">
                                    Add
                                </button>
                            </div>
                            {chosen.length > 0 && (
                                <p className="text-xs text-[var(--text-muted)]">
                                    Starting with: {chosen.join(', ')}
                                </p>
                            )}
                        </>
                    )}

                    {step === 'practice' && (
                        <>
                            <h2 className="text-lg font-semibold text-[var(--text-primary)]">One practice sale</h2>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Here's a pretend payment message. Copy it, paste it below, then tap a bucket —
                                exactly what you'll do for real. Nothing here gets saved.
                            </p>

                            <div className="rounded-xl border border-[var(--border-glass)] p-3">
                                <p className="text-xs text-[var(--text-secondary)] leading-relaxed break-words">
                                    {practiceMessage}
                                </p>
                                <button
                                    onClick={copyPractice}
                                    className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full text-white"
                                    style={{ background: 'var(--accent)' }}
                                >
                                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied' : 'Copy message'}
                                </button>
                            </div>

                            <textarea
                                ref={practiceInputRef}
                                rows={2}
                                placeholder="Paste it here"
                                aria-label="Practice paste field"
                                onPaste={e => {
                                    const text = e.clipboardData.getData('text');
                                    if (!text.trim()) return;
                                    e.preventDefault();
                                    runPractice(text);
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        runPractice((e.target as HTMLTextAreaElement).value);
                                    }
                                }}
                                className="w-full resize-none rounded-xl border px-3 py-2 text-sm bg-transparent text-[var(--text-primary)] outline-none"
                                style={{ borderColor: 'var(--border-glass)' }}
                            />
                            {practiceError && <p className="text-xs text-[var(--text-muted)]">{practiceError}</p>}

                            {practicePending && (
                                <div
                                    className="rounded-xl border p-3"
                                    style={{ background: 'var(--accent-subtle)', borderColor: 'var(--border-glass-accent)' }}
                                >
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                                        Now tap a bucket
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-[var(--text-primary)] tabular-nums">
                                        {fmtCurrency(practicePending.amount, practicePending.currency)}
                                    </p>
                                    <p className="text-sm text-[var(--text-secondary)] truncate">
                                        {practicePending.recipient}
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {practiceTallies.map(b => (
                                    <button
                                        key={b.name}
                                        onClick={() => filePractice(b.name)}
                                        disabled={!practicePending}
                                        className="flex-shrink-0 rounded-full border px-3 py-1.5 text-left disabled:opacity-50"
                                        style={{ borderColor: 'var(--border-glass)' }}
                                    >
                                        <span className="block text-xs text-[var(--text-primary)] whitespace-nowrap">{b.name}</span>
                                        <span className="block text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                                            {fmtCurrency(b.total, b.currency)} · {b.count}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {practiceFiled.length > 0 && (
                                <p className="text-sm text-[var(--text-primary)]">
                                    That's it — the bucket and the day's total went up on their own.
                                    This practice sale won't be saved.
                                </p>
                            )}
                        </>
                    )}

                    {step === 'recap' && (
                        <>
                            <h2 className="text-lg font-semibold text-[var(--text-primary)]">You're set</h2>
                            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                                Paste, tap a bucket, repeat. Add buckets anytime. Tap Finish when your shift's done.
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                                Need this again? It's behind the question mark at the top of the screen.
                            </p>
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border-glass)] flex-shrink-0">
                    <button
                        onClick={index === 0 ? onClose : () => go(ORDER[index - 1])}
                        className="text-xs text-[var(--text-muted)] px-2 py-1.5"
                    >
                        {index === 0 ? 'Skip' : 'Back'}
                    </button>
                    <button
                        onClick={step === 'recap' ? finish : () => go(ORDER[index + 1])}
                        className="rounded-full px-4 py-2 text-xs font-medium text-white"
                        style={{ background: 'var(--accent)' }}
                    >
                        {step === 'recap' ? 'Start tracking' : step === 'practice' ? 'Done practising' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}
