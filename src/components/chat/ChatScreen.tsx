import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ParsedTransaction } from '../../types';
import { useChatSession } from '../../lib/useChatSession';
import { useReceiptStore } from '../../lib/useReceiptStore';
import { useAllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import type { AllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import { describeNewRecords } from '../../lib/aggregate/recordMessages';
import { parseAllMessages } from '../../lib/parsers';
import { generateDemoMessages } from '../../lib/demoData';
import { generateInsights, computeDaySpan, detectRecurring, type InsightContext } from '../../lib/insights';
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
    if (scoped.length < 3) {
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
    const { receipts, saveIfNew } = useReceiptStore();
    const { recordSession } = useAllTimeStats();

    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    // Demo sessions never touch useChatSession — they're fully ephemeral, so
    // they can never be saved to IndexedDB history or count toward anything
    // persisted. isDemoSession starts from the incoming flag but can drop to
    // false locally (e.g. the user starts a real new session mid-demo).
    const [isDemoSession, setIsDemoSession] = useState(demoMode);
    const [demoMessages, setDemoMessages] = useState<ChatMessage[]>([]);

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
            setIsProcessing(false);
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
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;

        addMsg({ role: 'user', kind: 'text', text });
        setIsProcessing(true);

        const thinkingId = addMsg({ role: 'bot', kind: 'thinking' });

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
        setIsProcessing(false);
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, receipts, recordSession, saveIfNew]);

    // Incoming Android share-target text lands directly in the chat flow's
    // parse step — auto-submitted the moment a real session exists, exactly
    // as if the user had pasted it themselves. Never applies during a demo.
    useEffect(() => {
        if (isDemoSession || !initialSharedText || sharedTextConsumed.current) return;
        if (!activeSession) return;
        sharedTextConsumed.current = true;
        // Deferred to a microtask — handleSend's first act is setIsProcessing,
        // and setState must not run synchronously inside an effect body.
        void Promise.resolve().then(() => handleSend(initialSharedText));
    }, [isDemoSession, initialSharedText, activeSession, handleSend]);

    const messages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
    const title = isDemoSession ? 'Sample data' : (activeSession?.title ?? 'New Receipt');
    const canCompose = isDemoSession || !!activeSession;

    return (
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

            {!isDemoSession && !isAvailable && (
                <p className="text-xs text-center text-[var(--text-muted)] py-2 px-4 flex-shrink-0">
                    Chat history unavailable in private browsing — this session won't be saved.
                </p>
            )}

            <ChatMessageList messages={messages} />

            <ChatComposer onSend={handleSend} disabled={!canCompose || isProcessing} />
        </ChatShell>
    );
}
