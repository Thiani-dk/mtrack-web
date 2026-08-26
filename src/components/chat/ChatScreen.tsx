import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage, ParsedTransaction } from '../../types';
import { useChatSession } from '../../lib/useChatSession';
import { useReceiptStore } from '../../lib/useReceiptStore';
import { useAllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import type { AllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import { describeNewRecords } from '../../lib/aggregate/recordMessages';
import { parseAllMessages } from '../../lib/parsers';
import { generateDemoMessages } from '../../lib/demoData';
import { generateInsights, computeDaySpan, detectRecurring, type InsightContext } from '../../lib/insights';
import { getPendingDraft, setPendingDraft, clearPendingDraft } from '../../lib/pendingDraft';
import { ChatShell } from './ChatShell';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';

interface ChatScreenProps {
    demoMode: boolean;
    initialSharedText?: string | null;
    onBack: () => void;
}

const GREETING = "Hi! I'm M-Track. I'll help you turn your M-PESA messages into an organised expense summary. Paste them in whenever you're ready.";

const DEMO_INTRO = "This is a demo run with made-up transactions, so you can see how it works before using your own.";
const DEMO_NEXT_STEP = 'Want to do this with your real messages? Start a new summary.';

const LEAD_INS = [
    "Here's what stood out.",
    'A few things I noticed.',
    'Worth knowing:',
    'Quick read on this lot:',
];

const BADGE_LEAD_INS = [
    'Badge unlocked.',
    "That's a new one.",
    'You just earned something.',
];

// Safety net for anything unexpected in the parse/insight/save pipeline —
// never leave the "thinking" bubble (and the composer, disabled while
// isProcessing) stuck forever. Deliberately generic: no raw error.message,
// which would read as broken rather than handled and could leak internals.
const PROCESSING_ERROR_TEXT =
    "Something went wrong while I was working on that. Nothing was lost — try sending it again.";

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pickRandom<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

type AddMessageFn = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
type UpdateMessageFn = (id: string, patch: Partial<ChatMessage>) => void;

// Shared by both a real pasted message and the demo auto-run: turn a parsed,
// in-scope transaction set into a "thinking" bubble converted to a lead-in,
// followed by staggered insight bubbles and a closing line. Personal-record
// and badge announcements run independently of whether the insight engine
// itself had anything to say — even a tiny summary can be your first, or
// quietly set a record.
async function deliverInsights(
    scoped: ParsedTransaction[],
    thinkingId: string,
    addMsg: AddMessageFn,
    updateMsg: UpdateMessageFn,
    isDemo: boolean,
    longerRangeAvailable: boolean,
    allTimeStats: AllTimeStats | null,
    previousStats: AllTimeStats | undefined,
    newlyEarnedBadges: string[]
): Promise<void> {
    if (scoped.length === 0) {
        // Every transaction was excluded (holds, failed, verification
        // charges) or nothing parsed at all — say so plainly instead of
        // promising "here's your summary" and then showing no receipt card
        // at all, which the guard below would otherwise silently skip.
        updateMsg(thinkingId, {
            kind: 'text',
            text: 'Nothing left to include — every transaction was filtered or excluded.',
        });
    } else if (scoped.length < 3) {
        updateMsg(thinkingId, {
            kind: 'text',
            text: `Not much to go on with ${scoped.length} transaction${scoped.length === 1 ? '' : 's'} — but here's your summary.`,
        });
    } else {
        const dayCount = computeDaySpan(scoped);
        const context: InsightContext = {
            dateRangeLabel: dayCount <= 1 ? 'today' : `over the past ${dayCount} days`,
            dayCount,
            today: new Date(),
            longerRangeAvailable,
            allTimeStats,
        };
        const insights = generateInsights(scoped, context);

        if (insights.length === 0) {
            updateMsg(thinkingId, { kind: 'text', text: "Nothing jumped out, but here's your summary." });
        } else {
            updateMsg(thinkingId, { kind: 'text', text: pickRandom(LEAD_INS) });

            for (const insight of insights) {
                await sleep(400);
                addMsg({ role: 'bot', kind: 'insight', insight });
            }

            // Recurring patterns get their own rich, expandable bubble alongside
            // the short narrative "recurring" insight above (when it makes the cut).
            const patterns = detectRecurring(scoped);
            if (patterns.length > 0) {
                await sleep(400);
                addMsg({ role: 'bot', kind: 'recurring', recurringPatterns: patterns });
            }
        }
    }

    // Demo sessions never touch the aggregate, so there's nothing to record
    // or unlock.
    if (!isDemo && allTimeStats) {
        for (const recordText of describeNewRecords(previousStats, allTimeStats)) {
            await sleep(400);
            addMsg({ role: 'bot', kind: 'text', text: recordText });
        }

        for (const badgeId of newlyEarnedBadges) {
            await sleep(600);
            addMsg({ role: 'bot', kind: 'badge', badgeId, badgeLeadIn: pickRandom(BADGE_LEAD_INS) });
        }
    }

    // The actual summary — Save/Share buttons live on the card itself, so
    // there's nothing left to promise after this.
    if (scoped.length > 0) {
        await sleep(400);
        const dayCount = computeDaySpan(scoped);
        const receiptRangeLabel = dayCount <= 1 ? 'today' : `past ${dayCount} days`;
        addMsg({ role: 'bot', kind: 'receipt', transactions: scoped, dateRange: receiptRangeLabel, isDemo });
    }

    if (isDemo) {
        await sleep(400);
        addMsg({ role: 'bot', kind: 'text', text: DEMO_NEXT_STEP });
    }
}

export function ChatScreen({ demoMode, initialSharedText, onBack }: ChatScreenProps) {
    const {
        sessions,
        activeSession,
        isLoading,
        isAvailable,
        newSession,
        loadSession,
        deleteSession,
        addMessage,
        updateMessage,
    } = useChatSession();
    const { receipts, saveIfNew, isAvailable: isReceiptStoreAvailable } = useReceiptStore();
    const { recordSession, recheckBadges } = useAllTimeStats();

    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    // Demo sessions never touch useChatSession — they're fully ephemeral, so
    // they can never be saved to IndexedDB history or count toward anything
    // persisted. isDemoSession starts from the incoming flag but can drop to
    // false locally (e.g. the user starts a real new session mid-demo).
    const [isDemoSession, setIsDemoSession] = useState(demoMode);
    const [demoMessages, setDemoMessages] = useState<ChatMessage[]>([]);

    // Computed once at mount from the share-target URL param + whatever was
    // already pending in sessionStorage (both external-to-React state) — a
    // lazy initializer rather than an effect, since sessionStorage.getItem
    // is a pure read (safe under a render-phase double-invoke) and this way
    // the very first paint already reflects the right choice, no flash of
    // an empty composer before an effect catches up.
    function initialComposerState(): { key: number; value: string } {
        if (isDemoSession || !initialSharedText) return { key: 0, value: '' };
        const existing = getPendingDraft();
        return { key: 0, value: existing.trim().length > 0 ? existing : initialSharedText };
    }
    function initialSharePrompt(): { incoming: string; existing: string } | null {
        if (isDemoSession || !initialSharedText) return null;
        const existing = getPendingDraft();
        return existing.trim().length > 0 ? { incoming: initialSharedText, existing } : null;
    }

    // Forces the composer to pick up a new starting value (share arrivals,
    // prompt resolutions) — bumping `key` remounts it fresh, since its
    // internal text state is otherwise self-owned and won't pick up a
    // changed `initialValue` prop after the first mount.
    const [composerSeed, setComposerSeed] = useState(initialComposerState);
    const seedComposer = (value: string) => setComposerSeed(s => ({ key: s.key + 1, value }));
    // Set only when a second share arrives while pendingDraft already has
    // something in it.
    const [sharePrompt, setSharePrompt] = useState(initialSharePrompt);

    const hasInitialized = useRef(false);
    const greetedSessionIds = useRef(new Set<string>());
    const demoStarted = useRef(false);
    const sharedTextConsumed = useRef(false);

    const addDemoMessage = useCallback<AddMessageFn>((msg) => {
        const id = crypto.randomUUID();
        const timestamp = Date.now();
        setDemoMessages(prev => [...prev, { ...msg, id, timestamp }]);
        return id;
    }, []);

    const updateDemoMessage = useCallback<UpdateMessageFn>((id, patch) => {
        setDemoMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    }, []);

    // Create a real session on first mount if none is active yet — skipped
    // entirely while a demo is running.
    useEffect(() => {
        if (isDemoSession) return;
        if (isLoading || hasInitialized.current) return;
        if (!activeSession) {
            hasInitialized.current = true;
            newSession();
        } else {
            hasInitialized.current = true;
        }
    }, [isDemoSession, isLoading, activeSession, newSession]);

    // Phase 5A placeholder: a single hardcoded greeting for real sessions.
    useEffect(() => {
        if (isDemoSession) return;
        if (!activeSession) return;
        if (activeSession.messages.length > 0) return;
        if (greetedSessionIds.current.has(activeSession.id)) return;
        greetedSessionIds.current.add(activeSession.id);
        addMessage({ role: 'bot', kind: 'text', text: GREETING });
    }, [isDemoSession, activeSession, addMessage]);

    // Demo bootstrap: intro line, a beat of "thinking", then the demo data
    // auto-parses and flows through the exact same insights pipeline as a
    // real paste. Runs once. Skip the date-range question entirely — the
    // demo data is always the last 14 days, so a 15-day cutoff guarantees
    // the Phase 6 range filter passes it all through rather than binning it.
    useEffect(() => {
        if (!isDemoSession || demoStarted.current) return;
        demoStarted.current = true;

        (async () => {
            addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_INTRO });
            setIsProcessing(true);

            const thinkingId = addDemoMessage({ role: 'bot', kind: 'thinking' });
            try {
                await sleep(800);

                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 15);

                const { transactions } = parseAllMessages(generateDemoMessages());
                const withDefaults = transactions.map(t =>
                    t.isHold || t.failed || t.isVerificationCharge ? { ...t, excludedFromReceipt: true } : t
                );
                const inRange = withDefaults.filter(t => t.date >= cutoff);
                const scoped = inRange.filter(t => !t.excludedFromReceipt);

                // Demo history is fake and never persisted, so the "run a longer
                // range" hint (which reads real past sessions) never applies here,
                // and there's no aggregate/badges to consult or update.
                await deliverInsights(scoped, thinkingId, addDemoMessage, updateDemoMessage, true, false, null, undefined, []);
            } catch (err) {
                console.error('Demo bootstrap failed:', err);
                updateDemoMessage(thinkingId, { kind: 'text', text: PROCESSING_ERROR_TEXT });
            } finally {
                setIsProcessing(false);
            }
        })();
    }, [isDemoSession, addDemoMessage, updateDemoMessage]);

    const handleSelectSession = (id: string) => {
        setIsDemoSession(false);
        loadSession(id);
        setSidebarOpen(false);
    };

    const handleNewSession = () => {
        setIsDemoSession(false);
        newSession();
        setSidebarOpen(false);
    };

    // A pasted message is treated as a batch of transaction messages: parse
    // it, then walk the user through what stood out before offering to build
    // the actual summary.
    const handleSend = useCallback(async (text: string) => {
        // Whatever was pending is now confirmed — nothing left to reconcile
        // a future share against.
        clearPendingDraft();

        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;

        addMsg({ role: 'user', kind: 'text', text });
        setIsProcessing(true);

        const thinkingId = addMsg({ role: 'bot', kind: 'thinking' });

        try {
            const { transactions } = parseAllMessages(text);
            const withDefaults = transactions.map(t =>
                t.isHold || t.failed || t.isVerificationCharge ? { ...t, excludedFromReceipt: true } : t
            );
            const scoped = withDefaults.filter(t => !t.excludedFromReceipt);

            // Give the "thinking" bubble a beat before it resolves, then convert
            // it in place into the first real reply — no separate remove step.
            await sleep(500);
            const longerRangeAvailable = !isDemoSession &&
                receipts.some(r => computeDaySpan(r.transactions) > computeDaySpan(scoped));

            // Every real summary feeds the running all-time picture — this is
            // also what lets comparison/fee-trend/milestone insights and badges
            // reflect this session, not just history as of the last visit. Demo
            // sessions are excluded entirely from both history and the aggregate.
            let recordResult = null;
            if (!isDemoSession) {
                const dayCount = computeDaySpan(scoped);
                const receiptRangeLabel = dayCount <= 1 ? 'today' : `past ${dayCount} days`;
                [recordResult] = await Promise.all([
                    recordSession(scoped, false),
                    saveIfNew(scoped, receiptRangeLabel),
                ]);
            }

            await deliverInsights(
                scoped, thinkingId, addMsg, updateMsg, isDemoSession, longerRangeAvailable,
                recordResult?.stats ?? null, recordResult?.previousStats, recordResult?.newlyEarnedBadges ?? []
            );
        } catch (err) {
            console.error('handleSend failed:', err);
            updateMsg(thinkingId, { kind: 'text', text: PROCESSING_ERROR_TEXT });
        } finally {
            setIsProcessing(false);
        }
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, receipts, recordSession, saveIfNew]);

    // Fired from the interactive receipt's tap-to-label UI. Updates the
    // message's own transactions in place (persisted through the normal
    // updateMessage/updateDemoMessage debounce, same as any other message
    // edit) and — for real sessions only — re-checks badges against the new
    // label state, since the original badge check ran before the receipt
    // (and any chance to label) even existed. Deliberately does NOT call
    // recordSession again: that would double-count this session's totals.
    const handleLabelChange = useCallback(async (messageId: string, transactionCode: string, label: string | null) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const msg = currentMessages.find(m => m.id === messageId);
        if (!msg?.transactions) return;

        const updatedTransactions = msg.transactions.map(t =>
            t.transactionCode === transactionCode ? { ...t, receiptLabel: label } : t
        );

        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { transactions: updatedTransactions });

        if (isDemoSession) return; // demo sessions never touch badges/aggregate

        const newlyEarnedBadges = await recheckBadges(updatedTransactions, false);
        for (const badgeId of newlyEarnedBadges) {
            await sleep(600);
            addMessage({ role: 'bot', kind: 'badge', badgeId, badgeLeadIn: pickRandom(BADGE_LEAD_INS) });
        }
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage, recheckBadges, addMessage]);

    // Incoming Android share-target text populates the composer for review —
    // it does NOT auto-submit, so the user can see/edit what came in (and so
    // a second share while this is still sitting there has something to
    // reconcile against — see initialComposerState/initialSharePrompt above,
    // which already decided the no-conflict-vs-prompt outcome for this
    // render). Never applies during a demo.
    //
    // A repeat share is a real browser navigation (manifest.json's
    // share_target is GET, not an in-page event), which reloads the whole
    // app — so this only needs to persist the no-conflict case's resolved
    // text to sessionStorage (an external-system write, not React state) so
    // THAT reload has something to detect a conflict against next time.
    useEffect(() => {
        if (isDemoSession || !initialSharedText || sharedTextConsumed.current) return;
        sharedTextConsumed.current = true;
        if (getPendingDraft().trim().length === 0) {
            setPendingDraft(initialSharedText);
        }
    }, [isDemoSession, initialSharedText]);

    const resolveSharePrompt = (choice: 'add' | 'fresh') => {
        if (!sharePrompt) return;
        const resolved = choice === 'add'
            ? `${sharePrompt.existing}\n\n${sharePrompt.incoming}`
            : sharePrompt.incoming;
        setPendingDraft(resolved);
        seedComposer(resolved);
        setSharePrompt(null);
    };

    const messages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
    const title = isDemoSession ? 'Sample data' : (activeSession?.title ?? 'New Receipt');
    const canCompose = isDemoSession || !!activeSession;

    return (
        <>
        <ChatShell
            sidebarOpen={sidebarOpen}
            onCloseSidebar={() => setSidebarOpen(false)}
            sidebar={
                <ChatSidebar
                    sessions={sessions}
                    activeSessionId={isDemoSession ? null : (activeSession?.id ?? null)}
                    onNewSession={handleNewSession}
                    onSelectSession={handleSelectSession}
                    onDeleteSession={deleteSession}
                />
            }
        >
            <ChatHeader
                title={title}
                demo={isDemoSession}
                onBack={onBack}
                onToggleSidebar={() => setSidebarOpen(prev => !prev)}
            />

            {!isDemoSession && (!isAvailable || !isReceiptStoreAvailable) && (
                <p className="text-xs text-center text-[var(--text-muted)] py-2 px-4 flex-shrink-0">
                    Chat history unavailable in private browsing — this session won't be saved.
                </p>
            )}

            <ChatMessageList messages={messages} onLabelChange={handleLabelChange} />

            <ChatComposer
                key={composerSeed.key}
                initialValue={composerSeed.value}
                onChange={value => (value.trim() ? setPendingDraft(value) : clearPendingDraft())}
                onSend={handleSend}
                disabled={!canCompose || isProcessing}
            />
        </ChatShell>

        <AnimatePresence>
            {sharePrompt && (
                <>
                    <motion.div
                        className="fixed inset-0 z-scrim"
                        style={{ background: 'var(--scrim)' }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setSharePrompt(null)}
                    />
                    <motion.div
                        className="glass-panel fixed inset-x-0 bottom-0 z-modal rounded-t-3xl max-w-md mx-auto p-5"
                        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                    >
                        <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                            You've already got something pending
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mb-4">
                            Add this to what you already have, or start fresh?
                        </p>
                        <div className="flex flex-col gap-2">
                            <motion.button
                                onClick={() => resolveSharePrompt('add')}
                                className="btn-primary min-h-[40px] rounded-xl text-sm font-medium"
                                whileTap={{ scale: 0.97 }}
                            >
                                Add to what I have
                            </motion.button>
                            <motion.button
                                onClick={() => resolveSharePrompt('fresh')}
                                className="btn-secondary min-h-[40px] rounded-xl text-sm font-medium"
                                whileTap={{ scale: 0.97 }}
                            >
                                Start fresh
                            </motion.button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
        </>
    );
}
