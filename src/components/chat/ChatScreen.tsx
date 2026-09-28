import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    ChatMessage, ChatOption, ParsedTransaction, SkippedMessage,
    DocumentType, MerchantProfile, OnBehalfOfContext, TrackedDocument,
} from '../../types';
import { partyPlaceholder } from '../../lib/partyQuestion';
import { matchTypedAnswer, type TypedChoice } from '../../lib/chatOptions';
import { chooseMode, emptyConvState, MODE_VALUES, openConversation, receive } from '../../lib/conversation/engine';
import { copyEntry, render } from '../../lib/conversation/copy';
import type { BotTurn, ConvState, TurnResult } from '../../lib/conversation/types';
import { fmtProse, fmtProseCurrency, fmtTxDate, hasUsableDate } from '../../lib/transactionDisplay';
import { useDocumentStore } from '../../lib/useDocumentStore';
import { getDocument } from '../../lib/documentStore';
import { buildDraft } from '../../lib/draftDocument';
import { pipelineEligibility } from '../../lib/documentPipeline';
import { useChatSession, markNewlyCreatedMessage } from '../../lib/useChatSession';
import { useReceiptStore } from '../../lib/useReceiptStore';
import { useAllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import type { AllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import { parseAllMessages, deriveSubType, type ParseStats, type LinkEnrichment, type NearDuplicatePair, type ReversalPair } from '../../lib/parsers';
import { scoreWithContext } from '../../lib/parsers/confidence';
import { computeReceiptData } from '../../lib/receiptGenerator';
import {
    demoPartyOptions, demoErrandOptions, demoCategoryOptions, demoPlaceOptions,
    demoAmountOptions, demoPurposeOptions, demoLoopOptions, demoPartyName,
    buildDemoTransaction, buildDemoPasteMessage, DEMO_CATEGORIES, DEMO_PLENTY_COUNT,
    type DemoStep, type DemoCategory, type DemoParty,
} from '../../lib/demoFlow';
import { generateInsights, computeDaySpan, detectRecurring, type InsightContext } from '../../lib/insights';
import { buildParseNotices } from '../../lib/parseNotices';
import { ChatShell } from './ChatShell';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';

interface ChatScreenProps {
    demoMode: boolean;
    // A session id to resume into directly on mount, in place of the normal
    // "create a fresh session" behavior — set by App.tsx when it finds a
    // session still 'awaiting_input' at app load. Only ever meaningful once,
    // right after mount; not re-checked on later re-renders.
    resumeSessionId?: string | null;
    onBack: () => void;
    // Offered once, from the demo's closing summary. The demo itself is
    // otherwise unchanged.
    onOpenActiveMode?: () => void;
}

// Every bot-facing sentence lives in the copy registry now; this component
// says nothing of its own. What it still owns is the message list, IndexedDB,
// the SMS pipeline and the guided demo.

// The conversation state, plus the one thing the engine has no business
// knowing about: the persisted draft TrackedDocument backing this flow (its id
// is the session id, so a resume finds it).
type DocFlow = ConvState & { draftDoc: TrackedDocument | null };

// One bot turn, as a chat message. The only place a BotTurn becomes something
// the user can see.
function messageFor(turn: BotTurn): Omit<ChatMessage, 'id' | 'timestamp'> {
    return turn.options
        ? { role: 'bot', kind: 'options', text: turn.text, options: turn.options }
        : { role: 'bot', kind: 'text', text: turn.text };
}


// The guided demo's ephemeral state machine — a parallel to DocFlow that only
// ever runs in a demo session. Never persisted, never touches IndexedDB.
interface DemoFlow {
    step: DemoStep;
    party: DemoParty;
    partyName: string;
    preparedBy: string | null;
    errandLabel: string;
    // The category of the line currently being built. null while a custom
    // ("Something else") category is in progress — customCategoryLabel holds
    // its text and the place / amount questions fall to free text.
    draftCategory: DemoCategory | null;
    customCategoryLabel: string;
    draftPlace: string | null;
    txns: ParsedTransaction[];
    // Transaction code -> the category it was filed under, for the purpose
    // questions later (a fuel line offers different purposes than a food one).
    txnCategory: Record<string, DemoCategory | null>;
    // Transaction codes still waiting on a purpose label, walked one at a time.
    purposeQueue: string[];
    // Set to the current step while a "Something else" free-text prompt is open.
    awaitingText: DemoStep | null;
    // Pass 2 — the fake M-Pesa message shown for the paste lesson, the code of
    // the tapped line it was built from, and that line's purpose label (carried
    // onto the parsed line if the user sends the sample back).
    pasteFake: string | null;
    pasteSourceCode: string | null;
    pastePurpose: string | null;
}

function fmtShortDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The one "money in or out?" question shape, used by both the SMS batch path
// (deliverInsights) and conversational capture (commitDraft) — one mechanism,
// answered by handleDirectionAnswer either way.
function directionQuestionMessage(t: ParsedTransaction): Omit<ChatMessage, 'id' | 'timestamp'> {
    const dateLabel = fmtTxDate(t, { day: 'numeric', month: 'short' });
    const party = t.merchant ?? t.recipient;
    return {
        role: 'bot', kind: 'direction-question',
        text: `I couldn't tell which way this one went. ${fmtProseCurrency(t.amount, t.currency)}, ${party}, ${dateLabel}. Money in or out?`,
        directionQuestion: {
            transactionCode: t.transactionCode,
            amountLabel: fmtProseCurrency(t.amount, t.currency),
            partyLabel: party,
            dateLabel,
        },
    };
}

// The claim's real covering span, drawn from the dates the user's lines landed
// on ("21 Aug to 2 Sep"), for the demo receipt card's range label.
function demoCoveringLabel(txns: ParsedTransaction[]): string {
    const times = txns.filter(hasUsableDate).map(t => t.date.getTime()).sort((a, b) => a - b);
    if (times.length === 0) return 'sample';
    const from = new Date(times[0]);
    const to = new Date(times[times.length - 1]);
    const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return from.toDateString() === to.toDateString() ? f(from) : `${f(from)} to ${f(to)}`;
}

// ── Guided demo: a reimbursement claim the user co-authors, one tap at a time.
// Every question is a tappable pick; every pick has a "Something else" escape to
// free text, but tapping alone completes the whole run. ──
const DEMO_OPENER =
    "Let's build a claim for money you spent on someone else's behalf. Made-up numbers, nothing saved. You pick, I'll put it together.";
const DEMO_PARTY_Q = 'Who are you claiming from?';
const DEMO_ERRAND_Q = 'What was the errand?';
const DEMO_ERRAND_ACK = 'Good. Now the spending, one line at a time.';
const DEMO_CATEGORY_Q = 'What did you spend on?';
const DEMO_CATEGORY_Q_AGAIN = 'What was the next one on?';
const DEMO_PLACE_Q = 'Where?';
const DEMO_AMOUNT_Q = 'How much?';
const DEMO_CUSTOM_PLACE_Q = 'Where did you spend it?';
const DEMO_CUSTOM_AMOUNT_Q = 'How much was it, in Ksh?';
const DEMO_LOOP_Q = 'Added. Another one, or is that enough?';
const DEMO_LOOP_Q_PLENTY = "Added. That's plenty to work with. Add more if you want, or move on.";
const DEMO_PURPOSE_INTRO =
    "Last part. Let's say what each line was for. An unexplained line is what gets a claim sent back.";
const DEMO_PRE_RECEIPT = "That's everything. Here's the claim you just built.";
const DEMO_TAP_NUDGE = 'Tap one of the options above to keep going.';
const demoPasteIntro = (who: string) =>
    `One more thing. Most of the time you'll copy the actual M-Pesa message instead of tapping it in. Here's what the ${who} one would look like.`;
const DEMO_PASTE_ASK = 'Copy that and send it back to me, the way you would a real one.';
const DEMO_PASTE_FAILED = "That didn't read as a transaction message, but no matter. Here's the claim you built.";
const demoPasteCallout = (t: ParsedTransaction): string => {
    const bits = ['the exact amount', 'the date', 'the reference number'];
    if (t.transactionCost != null && t.transactionCost > 0) bits.push(`the Ksh ${t.transactionCost} fee`);
    const list = `${bits.slice(0, -1).join(', ')}, and ${bits[bits.length - 1]}`;
    return `Notice what came across on its own: ${list}. That line comes straight from the message now. That's why copying beats typing when you have it.`;
};

// A recap of what the user just did — not a feature list. Only names steps the
// run actually walked through.
const demoSummary = (pasteLanded: boolean): string => {
    const pasteClause = pasteLanded
        ? ', copied a real message and watched the details come across on their own,'
        : ',';
    return `That's it. You just built a claim by tapping through it${pasteClause} labelled what each line was for, and got a document with the fees included in the total.\n\n`
        + `There's also an Active Mode for tracking a lot of sales quickly at a stand or on a busy day.\n\n`
        + `The real thing works the same way. Ready to make one?`;
};
// One extra exit, not an extension of this demo's own flow.
const DEMO_SUMMARY_OPTIONS: ChatOption[] = [
    { id: 'real', label: 'Make a real one', value: 'real' },
    { id: 'active', label: 'Show me Active Mode', value: 'active' },
    { id: 'back', label: 'Back to start', value: 'back' },
];

// Shown when the user taps "Something else" on a given question.
const DEMO_ELSE_PROMPTS: Record<string, string> = {
    party: 'Who are you claiming from?',
    errand: 'What was the errand?',
    category: 'What did you spend on?',
    place: 'Where was it?',
    amount: 'How much was it, in Ksh?',
    purpose: 'What was it for?',
};

const LEAD_INS = [
    "Here's what stood out.",
    'A few things I noticed.',
    'Worth knowing:',
    'Quick read on this lot:',
];

// A parsed-transaction count at or below this counts as "small" — worth
// saying so plainly rather than promising a rich summary.
const SMALL_RESULT_THRESHOLD = 3;

// Never interrogate someone about more than this many unresolved directions in
// one batch — ask about the largest by amount, mark the rest.
const MAX_DIRECTION_QUESTIONS = 5;

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
// followed by staggered insight bubbles and a closing line.
//
// buildParseNotices is the primary path for describing what happened during
// parsing itself (skipped messages, ambiguous dates, holds/failures left
// out, duplicates). The zero/small/all-sorted messages below only remain as
// last-resort fallbacks for whatever notices don't cover — a fully clean
// parse still needs something to say about the result, and "nothing left to
// summarize" still needs saying even when notices already explained why.
//
// fullTransactions carries every parsed transaction, including ones flagged
// excludedFromReceipt — the receipt message stores this full set (not a
// pre-filtered one) so Part 6's skipped-review "Include" action has an
// actual transaction to flip back on; computeReceiptData (and every screen
// that reads a receipt message) already does its own !excludedFromReceipt
// filtering downstream, so this doesn't change what's displayed or totaled.
async function deliverInsights(
    fullTransactions: ParsedTransaction[],
    stats: ParseStats,
    skippedMessages: SkippedMessage[],
    thinkingId: string,
    addMsg: AddMessageFn,
    updateMsg: UpdateMessageFn,
    isDemo: boolean,
    longerRangeAvailable: boolean,
    allTimeStats: AllTimeStats | null,
    linkEnrichments: LinkEnrichment[] = [],
    nearDuplicates: NearDuplicatePair[] = [],
    documentType: DocumentType = 'expense_summary',
    reversalPairs: ReversalPair[] = []
): Promise<void> {
    const scoped = fullTransactions.filter(t => !t.excludedFromReceipt);
    const currencyCount = computeReceiptData(scoped).distinctCurrencies.length;
    const balanceMismatchCount = scoped.filter(t => t.balanceMismatch).length;

    // No date-range question exists yet, so nothing is ever "out of range" —
    // passing 0 here means the 'all-out-of-range' and 'out-of-range' notices
    // can never fire.
    const notices = buildParseNotices(stats, { linkEnrichments, nearDuplicates, reversalPairs, currencyCount, balanceMismatchCount });
    const nothingNotice = notices.find(n => n.id === 'nothing');

    if (nothingNotice) {
        // Nothing was parsed at all. There's no receipt, no insights, and
        // nothing left to add that wouldn't just repeat this.
        updateMsg(thinkingId, { kind: 'text', text: nothingNotice.text });
        return;
    }

    // The first notice (if any) converts the "thinking" bubble in place,
    // same as every other first-reply below; every notice after that, and
    // everything that follows once notices run out, is a new staggered
    // message rather than a further patch to the same bubble. Returns the
    // id of whichever message actually carried this text, so the 'partial'
    // notice can be linked to the skipped-review card below it.
    let thinkingUsed = false;
    const emitBotText = async (text: string, extra: Partial<ChatMessage> = {}): Promise<string> => {
        if (!thinkingUsed) {
            thinkingUsed = true;
            updateMsg(thinkingId, { kind: 'text', text, ...extra });
            return thinkingId;
        } else {
            await sleep(400);
            return addMsg({ role: 'bot', kind: 'text', text, ...extra });
        }
    };

    let partialNoticeId: string | null = null;
    for (const notice of notices) {
        if (notice.kind === 'near-duplicate') continue; // rendered as a question below
        const id = await emitBotText(notice.text, notice.id === 'partial' ? { skippedCount: stats.rejected } : {});
        if (notice.id === 'partial') partialNoticeId = id;
    }

    // Near-duplicate pairs are a judgement call: surface each as its own
    // tappable question ("keep both" / "drop the small one"), never as a
    // statement, and never remove anything on our own.
    for (const notice of notices) {
        if (notice.kind !== 'near-duplicate' || !notice.nearDuplicate) continue;
        await sleep(400);
        addMsg({ role: 'bot', kind: 'near-duplicate', text: notice.text, nearDuplicatePair: notice.nearDuplicate });
    }

    // Anything set aside — parser-rejected or auto-excluded — gets its own
    // review card: collapsed by default, expandable on its own tap or via
    // the partial notice's "View skipped" link when one exists. Can fire
    // even with zero notices above (e.g. a lone verification-charge
    // exclusion, which no notice currently narrates).
    if (skippedMessages.length > 0) {
        await sleep(400);
        const skippedReviewId = addMsg({ role: 'bot', kind: 'skipped-review', skippedMessages });
        if (partialNoticeId) {
            updateMsg(partialNoticeId, { skippedReviewId });
        }
    }

    // Insights and recurring detection apply ONLY to the user's own spending.
    // A point-of-sale receipt or a reimbursement claim is generated, previewed
    // and stored, nothing else.
    const insightsEligible = pipelineEligibility(documentType).insights;

    if (!insightsEligible) {
        if (scoped.length === 0) {
            await emitBotText("I couldn't find any transactions in that. Try copying the full message from your SMS app.");
        } else {
            await emitBotText("Here's the document. Check it over, edit anything, then tap Approve.");
        }
    } else if (scoped.length === 0) {
        // Every transaction was excluded (holds, failed, verification
        // charges) — notices above may already explain why, but there's
        // still no receipt to build, so say so plainly instead of
        // promising "here's your summary" and then showing no receipt card
        // at all, which the guard below would otherwise silently skip.
        await emitBotText("I couldn't find any transactions in that. Try copying the full message from your SMS app, starting from the MPESA confirmation.");
    } else if (scoped.length <= SMALL_RESULT_THRESHOLD) {
        await emitBotText(`Only ${scoped.length} transaction${scoped.length === 1 ? '' : 's'} in there, but here's what I found.`);
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
            await emitBotText("All sorted. Nothing unusual this time, but here's your summary.");
        } else {
            await emitBotText(pickRandom(LEAD_INS));

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

    // The actual summary — Save/Share buttons live on the card itself, so
    // there's nothing left to promise after this.
    if (scoped.length > 0) {
        await sleep(400);
        const dayCount = computeDaySpan(scoped);
        const receiptRangeLabel = dayCount <= 1 ? 'today' : `past ${dayCount} days`;
        addMsg({
            role: 'bot', kind: 'receipt', transactions: fullTransactions, dateRange: receiptRangeLabel, isDemo,
            documentType,
        });
    }

    // Ask about transactions the oracle could not place. Batch, cap at 5 —
    // beyond that, ask about the largest by amount and leave the rest marked.
    const unresolved = scoped
        .filter(t => t.directionUnresolved)
        .sort((a, b) => b.amount - a.amount);
    for (const t of unresolved.slice(0, MAX_DIRECTION_QUESTIONS)) {
        await sleep(350);
        addMsg(directionQuestionMessage(t));
    }
    if (unresolved.length > MAX_DIRECTION_QUESTIONS) {
        await sleep(300);
        await emitBotText(`${unresolved.length - MAX_DIRECTION_QUESTIONS} more like that are marked on the document for you to set.`);
    }
}

export function ChatScreen({ demoMode, resumeSessionId, onBack, onOpenActiveMode }: ChatScreenProps) {
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
        updateSessionStatus,
    } = useChatSession();
    const { receipts, isAvailable: isReceiptStoreAvailable } = useReceiptStore();
    const { stats: allTimeStats, recordSession } = useAllTimeStats();
    const { saveDocument: persistDocument } = useDocumentStore();

    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    // Demo sessions never touch useChatSession — they're fully ephemeral, so
    // they can never be saved to IndexedDB history or count toward anything
    // persisted. isDemoSession starts from the incoming flag but can drop to
    // false locally (e.g. the user starts a real new session mid-demo).
    const [isDemoSession, setIsDemoSession] = useState(demoMode);
    const [demoMessages, setDemoMessages] = useState<ChatMessage[]>([]);

    // The four-way document flow (Phase C). Deliberately ephemeral state, never
    // written to the persisted session — a page reload drops the business name
    // / party name entirely, by design. The ref is the source of truth for
    // async handlers; the state copy drives renders (e.g. the composer hint).
    const [docFlow, setDocFlowState] = useState<DocFlow | null>(null);
    const docFlowRef = useRef<DocFlow | null>(null);
    const setDocFlow = useCallback((next: DocFlow | null | ((prev: DocFlow | null) => DocFlow | null)) => {
        const resolved = typeof next === 'function' ? (next as (p: DocFlow | null) => DocFlow | null)(docFlowRef.current) : next;
        docFlowRef.current = resolved;
        setDocFlowState(resolved);
    }, []);

    // The guided demo flow. Same ref-plus-state-mirror shape as DocFlow: the
    // ref is what async handlers read, the state copy drives renders.
    const [demoFlow, setDemoFlowState] = useState<DemoFlow | null>(null);
    const demoFlowRef = useRef<DemoFlow | null>(null);
    const setDemoFlow = useCallback((next: DemoFlow | null | ((prev: DemoFlow | null) => DemoFlow | null)) => {
        const resolved = typeof next === 'function' ? (next as (p: DemoFlow | null) => DemoFlow | null)(demoFlowRef.current) : next;
        demoFlowRef.current = resolved;
        setDemoFlowState(resolved);
    }, []);

    const hasInitialized = useRef(false);
    const greetedSessionIds = useRef(new Set<string>());
    const resumeGreetedSessionIds = useRef(new Set<string>());
    const restoredDraftSessionIds = useRef(new Set<string>());
    const demoStarted = useRef(false);

    const addDemoMessage = useCallback<AddMessageFn>((msg) => {
        const id = crypto.randomUUID();
        const timestamp = Date.now();
        // Same entrance-animation bookkeeping addMessage does for real sessions,
        // so the demo receipt animates in the same way. Purely in-memory.
        markNewlyCreatedMessage(id);
        setDemoMessages(prev => [...prev, { ...msg, id, timestamp }]);
        return id;
    }, []);

    const updateDemoMessage = useCallback<UpdateMessageFn>((id, patch) => {
        setDemoMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    }, []);

    // On first mount, either resume the session App.tsx found still
    // 'awaiting_input' (see resumeSessionId), or create a fresh one if there
    // isn't one to resume into. Skipped entirely while a demo is running.
    useEffect(() => {
        if (isDemoSession) return;
        if (isLoading || hasInitialized.current) return;
        if (resumeSessionId) {
            hasInitialized.current = true;
            loadSession(resumeSessionId);
        } else if (!activeSession) {
            hasInitialized.current = true;
            newSession();
        } else {
            hasInitialized.current = true;
        }
    }, [isDemoSession, isLoading, activeSession, newSession, resumeSessionId, loadSession]);

    // Phase 5A placeholder: a single hardcoded greeting for real sessions.
    useEffect(() => {
        if (isDemoSession) return;
        if (!activeSession) return;
        if (activeSession.messages.length > 0) return;
        if (greetedSessionIds.current.has(activeSession.id)) return;
        greetedSessionIds.current.add(activeSession.id);
        const opened = openConversation();
        for (const turn of opened.turns) addMessage(messageFor(turn));
        setDocFlow({ ...opened.state!, draftDoc: null });
    }, [isDemoSession, activeSession, addMessage, setDocFlow]);

    // Resuming into a session that already has the greeting (and maybe more)
    // gets a short continuation line instead — never the full greeting again.
    // Gated on resumeSessionId specifically so this never fires for an
    // ordinary manual session switch from the sidebar, only the one-time
    // app-mount resume.
    useEffect(() => {
        if (isDemoSession || !resumeSessionId) return;
        if (!activeSession || activeSession.id !== resumeSessionId) return;
        if (resumeGreetedSessionIds.current.has(activeSession.id)) return;
        resumeGreetedSessionIds.current.add(activeSession.id);
        addMessage({ role: 'bot', kind: 'text', text: copyEntry('open.resume').variants[0] });
    }, [isDemoSession, resumeSessionId, activeSession, addMessage]);

    // Phase D4 — resume mid-document-build. If a draft (or approved) document
    // is stored against this session, rebuild the ephemeral flow so tap-to-edit,
    // the purpose questions and Approve all keep working after a reload. The
    // business name / party name come back from the document, not the session.
    useEffect(() => {
        if (isDemoSession || !activeSession) return;
        if (activeSession.messages.length === 0) return;
        if (restoredDraftSessionIds.current.has(activeSession.id)) return;
        if (docFlowRef.current) return;
        restoredDraftSessionIds.current.add(activeSession.id);
        const sessionId = activeSession.id;
        (async () => {
            const doc = await getDocument(sessionId);
            if (!doc || docFlowRef.current) return;
            setDocFlow({
                ...emptyConvState(doc.documentType),
                merchantProfile: doc.merchantProfile,
                onBehalfOf: doc.onBehalfOf,
                pending: 'input',
                nudgeShown: true,
                draftDoc: doc,
            });
            if (doc.status === 'draft') {
                addMessage({ role: 'bot', kind: 'text', text: copyEntry('open.resumeDraft').variants[0] });
            }
        })();
    }, [isDemoSession, activeSession, setDocFlow, addMessage]);

    // Demo bootstrap: open with what's about to happen, then ask the first
    // question. Everything after this is driven by taps (see the demo handlers
    // below). Runs once. No parsing, no IndexedDB — the whole run is ephemeral.
    useEffect(() => {
        if (!isDemoSession || demoStarted.current) return;
        demoStarted.current = true;

        (async () => {
            addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_OPENER });
            setDemoFlow({
                step: 'party', party: 'boss', partyName: '', preparedBy: null, errandLabel: '',
                draftCategory: null, customCategoryLabel: '', draftPlace: null,
                txns: [], txnCategory: {}, purposeQueue: [], awaitingText: null,
                pasteFake: null, pasteSourceCode: null, pastePurpose: null,
            });
            await sleep(600);
            addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_PARTY_Q, options: demoPartyOptions() });
        })();
    }, [isDemoSession, addDemoMessage, setDemoFlow]);

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

    // ── Guided demo handlers ─────────────────────────────────────────────
    // A parallel to the real document flow, running entirely on demoMessages
    // and demoFlow — no useChatSession, no documentStore, no aggregate.

    // The claim the user just built, rendered through the normal receipt path
    // (isDemo flags every surface as sample data), then a plain-language recap
    // of what they did and the two ways out.
    const emitDemoReceipt = useCallback(async (txns: ParsedTransaction[], pasteLanded: boolean) => {
        await sleep(400);
        addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_PRE_RECEIPT });
        await sleep(500);
        addDemoMessage({
            role: 'bot', kind: 'receipt', transactions: txns,
            dateRange: demoCoveringLabel(txns), isDemo: true, documentType: 'on_behalf_of',
        });
        setDemoFlow(f => (f ? { ...f, step: 'summary' } : f));
        await sleep(700);
        addDemoMessage({ role: 'bot', kind: 'options', text: demoSummary(pasteLanded), options: DEMO_SUMMARY_OPTIONS });
    }, [addDemoMessage, setDemoFlow]);

    // Pass 2 — the paste lesson. Build one fake M-Pesa message from the biggest
    // line the user tapped in, show it in a copyable block, and wait for them to
    // send it back so it runs through the real parsing pipeline.
    const startDemoPaste = useCallback(async (flow: DemoFlow, txns: ParsedTransaction[]) => {
        const src = [...txns].sort((a, b) => b.amount - a.amount)[0];
        const category = src ? (flow.txnCategory[src.transactionCode] ?? null) : null;
        const fake = src
            ? buildDemoPasteMessage({ recipient: src.recipient, amount: src.amount, date: src.date, category })
            : '';
        setDemoFlow({
            ...flow, txns, step: 'paste', awaitingText: null,
            pasteFake: fake, pasteSourceCode: src?.transactionCode ?? null, pastePurpose: src?.purposeLabel ?? null,
        });
        await sleep(400);
        addDemoMessage({ role: 'bot', kind: 'text', text: demoPasteIntro(src?.recipient ?? 'M-Pesa') });
        await sleep(500);
        addDemoMessage({ role: 'bot', kind: 'copyable', text: fake });
        await sleep(400);
        addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_PASTE_ASK });
    }, [setDemoFlow, addDemoMessage]);

    const askDemoPurpose = useCallback((code: string, txns: ParsedTransaction[], cats: Record<string, DemoCategory | null>) => {
        const txn = txns.find(t => t.transactionCode === code);
        if (!txn) return;
        addDemoMessage({
            role: 'bot', kind: 'options',
            text: `What was the ${fmtProse(txn.amount)} at ${txn.recipient} for?`,
            options: demoPurposeOptions(cats[code] ?? null),
        });
    }, [addDemoMessage]);

    const applyDemoPurpose = useCallback(async (flow: DemoFlow, label: string) => {
        const [code, ...rest] = flow.purposeQueue;
        const txns = flow.txns.map(t => (t.transactionCode === code ? { ...t, purposeLabel: label } : t));
        if (rest.length > 0) {
            setDemoFlow({ ...flow, txns, purposeQueue: rest, awaitingText: null });
            await sleep(300);
            askDemoPurpose(rest[0], txns, flow.txnCategory);
        } else {
            const next: DemoFlow = { ...flow, txns, purposeQueue: [], awaitingText: null };
            setDemoFlow(next);
            await startDemoPaste(next, txns);
        }
    }, [setDemoFlow, askDemoPurpose, startDemoPaste]);

    const startDemoPurposes = useCallback(async (flow: DemoFlow) => {
        const queue = flow.txns.map(t => t.transactionCode);
        setDemoFlow({ ...flow, step: 'purpose', purposeQueue: queue, awaitingText: null });
        await sleep(400);
        addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_PURPOSE_INTRO });
        await sleep(500);
        askDemoPurpose(queue[0], flow.txns, flow.txnCategory);
    }, [setDemoFlow, addDemoMessage, askDemoPurpose]);

    // Three taps (category, place, amount) become one self-reported line.
    const addDemoLine = useCallback(async (flow: DemoFlow, amount: number) => {
        const place = flow.draftPlace ?? 'Unknown';
        const index = flow.txns.length;
        const txn = buildDemoTransaction({ place, amount, index });
        const txns = [...flow.txns, txn];
        const txnCategory = { ...flow.txnCategory, [txn.transactionCode]: flow.draftCategory };
        setDemoFlow({
            ...flow, step: 'loop', txns, txnCategory,
            draftCategory: null, customCategoryLabel: '', draftPlace: null, awaitingText: null,
        });
        await sleep(400);
        const spentOn = flow.draftCategory
            ? DEMO_CATEGORIES[flow.draftCategory].spentOn
            : (flow.customCategoryLabel || 'this').toLowerCase();
        addDemoMessage({
            role: 'bot', kind: 'text',
            text: `${fmtProse(amount)} at ${place} for ${spentOn}, ${fmtShortDate(txn.date)}.`,
        });
        await sleep(400);
        addDemoMessage({
            role: 'bot', kind: 'options',
            text: txns.length >= DEMO_PLENTY_COUNT ? DEMO_LOOP_Q_PLENTY : DEMO_LOOP_Q,
            options: demoLoopOptions(),
        });
    }, [setDemoFlow, addDemoMessage]);

    const handleDemoOption = useCallback(async (messageId: string, value: string) => {
        updateDemoMessage(messageId, { answered: true, answeredValue: value });
        const flow = demoFlowRef.current;
        if (!flow) return;

        if (value === 'else') {
            setDemoFlow({ ...flow, awaitingText: flow.step });
            addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_ELSE_PROMPTS[flow.step] ?? 'Tell me more.' });
            return;
        }

        switch (flow.step) {
            case 'party': {
                const party = value as DemoParty;
                setDemoFlow({ ...flow, step: 'errand', party, partyName: demoPartyName(party) });
                await sleep(400);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_ERRAND_Q, options: demoErrandOptions(party) });
                break;
            }
            case 'errand': {
                setDemoFlow({ ...flow, step: 'category', errandLabel: value });
                await sleep(400);
                addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_ERRAND_ACK });
                await sleep(500);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_CATEGORY_Q, options: demoCategoryOptions() });
                break;
            }
            case 'category': {
                const category = value as DemoCategory;
                setDemoFlow({ ...flow, step: 'place', draftCategory: category, customCategoryLabel: '' });
                await sleep(400);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_PLACE_Q, options: demoPlaceOptions(category) });
                break;
            }
            case 'place': {
                if (!flow.draftCategory) break;
                setDemoFlow({ ...flow, step: 'amount', draftPlace: value });
                await sleep(400);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_AMOUNT_Q, options: demoAmountOptions(flow.draftCategory) });
                break;
            }
            case 'amount':
                await addDemoLine(flow, Number(value));
                break;
            case 'loop':
                if (value === 'another') {
                    setDemoFlow({ ...flow, step: 'category' });
                    await sleep(300);
                    addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_CATEGORY_Q_AGAIN, options: demoCategoryOptions() });
                } else {
                    await startDemoPurposes(flow);
                }
                break;
            case 'purpose':
                await applyDemoPurpose(flow, value);
                break;
            case 'summary':
                // Nothing from the demo is carried into either exit — no
                // document, no session, no aggregate was ever written.
                if (value === 'real') {
                    setDemoFlow(null);
                    setIsDemoSession(false);
                    newSession();
                    setSidebarOpen(false);
                } else if (value === 'active') {
                    setDemoFlow(null);
                    setIsDemoSession(false);
                    onOpenActiveMode?.();
                } else {
                    onBack();
                }
                break;
        }
    }, [updateDemoMessage, addDemoMessage, setDemoFlow, addDemoLine, startDemoPurposes, applyDemoPurpose, newSession, onBack, onOpenActiveMode]);

    // The "Something else" free-text path. Tapping is always enough to finish
    // the demo; this only runs when the user chose to type instead.
    const handleDemoText = useCallback(async (text: string) => {
        const flow = demoFlowRef.current;
        if (!flow) return;
        const t = text.trim();
        const step = flow.awaitingText;

        if (!step) {
            addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_TAP_NUDGE });
            return;
        }

        switch (step) {
            case 'party':
                setDemoFlow({ ...flow, step: 'errand', party: 'other', partyName: t || 'Someone', awaitingText: null });
                await sleep(300);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_ERRAND_Q, options: demoErrandOptions('other') });
                break;
            case 'errand':
                setDemoFlow({ ...flow, step: 'category', errandLabel: t || 'An errand', awaitingText: null });
                await sleep(300);
                addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_ERRAND_ACK });
                await sleep(500);
                addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_CATEGORY_Q, options: demoCategoryOptions() });
                break;
            case 'category':
                setDemoFlow({ ...flow, step: 'place', draftCategory: null, customCategoryLabel: t || 'Spending', awaitingText: 'place' });
                await sleep(300);
                addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_CUSTOM_PLACE_Q });
                break;
            case 'place':
                if (flow.draftCategory) {
                    setDemoFlow({ ...flow, step: 'amount', draftPlace: t || 'Unknown', awaitingText: null });
                    await sleep(300);
                    addDemoMessage({ role: 'bot', kind: 'options', text: DEMO_AMOUNT_Q, options: demoAmountOptions(flow.draftCategory) });
                } else {
                    setDemoFlow({ ...flow, step: 'amount', draftPlace: t || 'Unknown', awaitingText: 'amount' });
                    await sleep(300);
                    addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_CUSTOM_AMOUNT_Q });
                }
                break;
            case 'amount': {
                const m = t.replace(/[,\s]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
                if (!m) {
                    addDemoMessage({ role: 'bot', kind: 'text', text: 'Give me a number, in Ksh.' });
                    return;
                }
                await addDemoLine({ ...flow, awaitingText: null }, parseFloat(m[1]));
                break;
            }
            case 'purpose':
                await applyDemoPurpose({ ...flow, awaitingText: null }, t || 'A work errand');
                break;
            default:
                addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_TAP_NUDGE });
        }
    }, [addDemoMessage, setDemoFlow, addDemoLine, applyDemoPurpose]);

    // The paste lesson's send: whatever the user sends goes through the real
    // parsing pipeline. The sample message joins the claim (replacing the line
    // it was based on, now verified); anything else is added if it parses, or
    // shrugged off if it doesn't. Then the claim renders.
    const handleDemoPaste = useCallback(async (flow: DemoFlow, text: string) => {
        const { transactions } = parseAllMessages(text);
        const parsed = transactions[0];

        if (!parsed) {
            addDemoMessage({ role: 'bot', kind: 'text', text: DEMO_PASTE_FAILED });
            await emitDemoReceipt(flow.txns, false);
            return;
        }

        const src = flow.pasteSourceCode
            ? flow.txns.find(t => t.transactionCode === flow.pasteSourceCode)
            : undefined;
        const isSample = !!src
            && Math.abs(parsed.amount - src.amount) < 1
            && src.recipient.toLowerCase().startsWith(parsed.recipient.toLowerCase().slice(0, 5));

        const joined: ParsedTransaction = {
            ...parsed,
            purposeLabel: parsed.purposeLabel ?? flow.pastePurpose ?? src?.purposeLabel ?? null,
        };
        const merged = isSample && src
            ? flow.txns.map(t => (t.transactionCode === src.transactionCode ? joined : t))
            : [...flow.txns, joined];

        setDemoFlow({ ...flow, txns: merged });
        await sleep(400);
        addDemoMessage({ role: 'bot', kind: 'text', text: demoPasteCallout(parsed) });
        await emitDemoReceipt(merged, true);
    }, [addDemoMessage, setDemoFlow, emitDemoReceipt]);


    // A near-duplicate question is only ever answered by a tap. "Keep both"
    // just locks the question. "Drop the small one" additionally flips the
    // smaller transaction out of the receipt — the same live receipt patch
    // the skipped-review handlers use, so computeReceiptData picks it up.
    // Persists (debounced) the draft TrackedDocument backing this flow. Its id
    // is the session id — one draft per session — so a resume finds it. Draft
    // status and covering dates / dataSource are recomputed by buildDraft.
    const syncDraft = useCallback((transactions: ParsedTransaction[]) => {
        if (isDemoSession) return;
        const flow = docFlowRef.current;
        const sid = activeSession?.id;
        if (!flow || !sid) return;
        const doc = buildDraft({
            sessionId: sid,
            documentType: flow.documentType,
            merchantProfile: flow.merchantProfile,
            onBehalfOf: flow.onBehalfOf,
            transactions,
            existing: flow.draftDoc,
        });
        setDocFlow(f => (f ? { ...f, draftDoc: doc } : f));
        persistDocument(doc);
    }, [isDemoSession, activeSession, persistDocument, setDocFlow]);

    const askPurposeFor = useCallback((code: string, transactions: ParsedTransaction[]) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const txn = transactions.find(t => t.transactionCode === code);
        if (!txn) return;
        addMsg({
            role: 'bot', kind: 'text',
            text: render(copyEntry('purpose.ask').variants[0], {
                amount: fmtProseCurrency(txn.amount, txn.currency),
                party: txn.merchant ?? txn.recipient,
            }),
        });
    }, [isDemoSession, addDemoMessage, addMessage]);

    // Phase D1 — in on_behalf_of mode, actively walk every unlabelled line one
    // at a time. An unexplained line is what gets a reimbursement rejected.
    const maybeStartPurposeLabelling = useCallback(async (transactions: ParsedTransaction[]) => {
        const flow = docFlowRef.current;
        if (!flow || flow.documentType !== 'on_behalf_of') return;
        const queue = transactions
            .filter(t => !t.excludedFromReceipt && !t.purposeLabel)
            .map(t => t.transactionCode);
        if (queue.length === 0) return;
        setDocFlow({ ...flow, purposeQueue: queue, pending: 'purpose-label' });
        await sleep(500);
        askPurposeFor(queue[0], transactions);
    }, [setDocFlow, askPurposeFor]);

    // ── The conversation ─────────────────────────────────────────────────
    //
    // Everything the bot says, and everything it waits for next, is decided in
    // lib/conversation/engine. What follows is the adapter: it turns BotTurns
    // into chat messages and Effects into the actions only a component can
    // take. There is no second copy of the routing here, which is the whole
    // point — the scenario harness drives the same `receive` this does.

    // The SMS batch path: parse, narrate, then offer the document. Reached
    // through a parse-batch effect rather than by the component deciding for
    // itself what counts as a pasted message.
    const runParseBatch = useCallback(async (text: string) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        setIsProcessing(true);
        const thinkingId = addMsg({ role: 'bot', kind: 'thinking' });
        try {
            const { transactions, stats: parseStats, skippedMessages: parserSkipped, linkEnrichments, nearDuplicates, reversalPairs } = parseAllMessages(text);
            const withDefaults = transactions.map(t =>
                t.isHold || t.failed || t.isVerificationCharge ? { ...t, excludedFromReceipt: true } : t
            );
            const scoped = withDefaults.filter(t => !t.excludedFromReceipt);

            // Give the "thinking" bubble a beat before it resolves, then convert
            // it in place into the first real reply — no separate remove step.
            await sleep(500);
            const longerRangeAvailable = !isDemoSession &&
                receipts.some(r => computeDaySpan(r.transactions) > computeDaySpan(scoped));

            // Nothing is written to the running aggregate here — the batch
            // produces a DRAFT document, and only an explicit Approve records
            // it (and only for expense_summary / personal_note).
            const excludedSkipped: SkippedMessage[] = withDefaults
                .filter(t => t.excludedFromReceipt)
                .map(t => ({ rawText: t.rawLine, reason: 'excluded', transactionCode: t.transactionCode }));

            const flow = docFlowRef.current;
            await deliverInsights(
                withDefaults, parseStats, [...parserSkipped, ...excludedSkipped], thinkingId, addMsg, updateMsg, isDemoSession, longerRangeAvailable,
                allTimeStats,
                linkEnrichments, nearDuplicates,
                flow?.documentType ?? 'expense_summary', reversalPairs
            );

            if (!isDemoSession) {
                syncDraft(withDefaults);
                await maybeStartPurposeLabelling(withDefaults);
            }
        } catch (err) {
            console.error('runParseBatch failed:', err);
            updateMsg(thinkingId, { kind: 'text', text: copyEntry('system.error').variants[0] });
        } finally {
            setIsProcessing(false);
        }
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, receipts, allTimeStats, syncDraft, maybeStartPurposeLabelling]);

    // Effects are applied before turns are said: a receipt card belongs above
    // the "Added." that announces it, and a purpose question is asked of a
    // document that already holds the line it is asking about.
    const applyResult = useCallback(async (result: TurnResult) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');

        setDocFlow(prev => (result.state ? { ...result.state, draftDoc: prev?.draftDoc ?? null } : null));

        let latest = receiptMsg?.transactions ?? [];
        let batched: string | null = null;

        for (const effect of result.effects) {
            switch (effect.kind) {
                case 'parse-batch':
                    batched = effect.text;
                    break;
                case 'commit': {
                    const txn = effect.transaction;
                    latest = [...latest, txn];
                    if (receiptMsg) {
                        updateMsg(receiptMsg.id, { transactions: latest });
                    } else {
                        addMsg({
                            role: 'bot', kind: 'receipt', transactions: latest,
                            dateRange: hasUsableDate(txn) ? fmtShortDate(txn.date) : 'undated',
                            isDemo: false,
                            documentType: result.state?.documentType ?? 'personal_note',
                        });
                    }
                    // Direction the capture couldn't settle: ask, using the same
                    // tappable question the SMS path uses.
                    if (txn.directionUnresolved) {
                        await sleep(300);
                        addMsg(directionQuestionMessage(txn));
                    }
                    break;
                }
                case 'update-transactions':
                    latest = effect.transactions;
                    if (receiptMsg) updateMsg(receiptMsg.id, { transactions: latest });
                    break;
                case 'sync-draft':
                    syncDraft(latest);
                    break;
            }
        }

        for (const turn of result.turns) addMsg(messageFor(turn));
        if (batched !== null) await runParseBatch(batched);
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, demoMessages, activeSession, setDocFlow, syncDraft, runParseBatch]);

    // One user message, through the engine.
    const runTurn = useCallback(async (text: string) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        await applyResult(receive(docFlowRef.current, text, {
            now: new Date(),
            transactions: receiptMsg?.transactions ?? [],
        }));
    }, [isDemoSession, demoMessages, activeSession, applyResult]);

    // ── Mode selection ────────────────────────────────────────────────────

    const handleOptionSelect = useCallback((messageId: string, value: string) => {
        if (isDemoSession) {
            void handleDemoOption(messageId, value);
            return;
        }
        updateMessage(messageId, { answered: true, answeredValue: value });

        if (activeSession?.sessionStatus === 'awaiting_input') {
            updateSessionStatus(activeSession.id, 'active');
        }

        const flow = docFlowRef.current;
        if (!flow) return;
        // Anything that isn't one of the three mode choices belongs to the
        // question the conversation is currently waiting on.
        if (!(MODE_VALUES as readonly string[]).includes(value)) {
            void runTurn(value);
            return;
        }
        void applyResult(chooseMode(flow, value));
    }, [isDemoSession, handleDemoOption, updateMessage, activeSession, updateSessionStatus, runTurn, applyResult]);

    // The one action that finalises a document. Only after Approve does an
    // expense_summary / personal_note feed the all-time totals;
    // point_of_sale / on_behalf_of never do.
    const handleApprove = useCallback(async (messageId: string) => {
        if (isDemoSession) return;
        const sid = activeSession?.id;
        if (!sid) return;
        const msg = (activeSession?.messages ?? []).find(m => m.id === messageId);
        const transactions = msg?.transactions ?? [];
        const flow = docFlowRef.current;
        const documentType: DocumentType = flow?.documentType ?? msg?.documentType ?? 'expense_summary';

        const doc = buildDraft({
            sessionId: sid, documentType,
            merchantProfile: flow?.merchantProfile ?? null,
            onBehalfOf: flow?.onBehalfOf ?? null,
            transactions,
            existing: flow?.draftDoc ?? null,
        });
        const approved: TrackedDocument = { ...doc, status: 'approved', updatedAt: Date.now() };
        await persistDocument(approved);
        setDocFlow(f => (f ? { ...f, draftDoc: approved } : f));
        updateMessage(messageId, { documentStatus: 'approved' });

        if (pipelineEligibility(documentType).aggregation) {
            await recordSession(transactions, false);
        }

        await sleep(300);
        addMessage({ role: 'bot', kind: 'text', text: 'Approved and saved. It is in your history now.' });
    }, [isDemoSession, activeSession, persistDocument, setDocFlow, updateMessage, recordSession, addMessage]);

    const handleNearDuplicateKeep = useCallback((messageId: string) => {
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { answered: true, answeredValue: 'keep' });
    }, [isDemoSession, updateDemoMessage, updateMessage]);

    const handleNearDuplicateDrop = useCallback(async (messageId: string, smallerTransactionCode: string) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { answered: true, answeredValue: 'drop' });

        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        if (!receiptMsg?.transactions) return;

        const updatedTransactions = receiptMsg.transactions.map(t =>
            t.transactionCode === smallerTransactionCode ? { ...t, excludedFromReceipt: true } : t
        );
        updateMsg(receiptMsg.id, { transactions: updatedTransactions });
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage]);

    // The user answers "money in / out" for a transaction the parser could not
    // place. Sets the direction, re-derives subType, clears the unresolved
    // flag, and re-scores confidence (direction now counts for full points).
    const handleDirectionAnswer = useCallback((messageId: string, transactionCode: string, direction: 'sent' | 'received') => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { answered: true, answeredValue: direction });

        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        if (!receiptMsg?.transactions) return;

        const updated = receiptMsg.transactions.map(t => {
            if (t.transactionCode !== transactionCode) return t;
            const next: ParsedTransaction = {
                ...t,
                type: direction,
                subType: deriveSubType(t.method, direction, t.isBusiness, t.merchant ?? t.recipient),
                directionUnresolved: false,
                directionSource: 'keyword',
                sender: direction === 'received' ? (t.sender ?? t.recipient) : null,
            };
            const scored = scoreWithContext(next, next.rawLine);
            next.confidence = scored.score;
            next.confidenceLevel = scored.level;
            next.missingFields = scored.missing;
            return next;
        });
        updateMsg(receiptMsg.id, { transactions: updated });
        if (!isDemoSession) syncDraft(updated);
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage, syncDraft]);

    // A typed answer that exactly matches a tappable option's label does the
    // same thing tapping it does. Generic over the message list, so a question
    // added later using the 'options' kind supports this with no extra code.
    const dispatchTypedAnswer = useCallback((choice: TypedChoice) => {
        switch (choice.kind) {
            case 'options':
                handleOptionSelect(choice.messageId, choice.value);
                break;
            case 'near-duplicate':
                if (choice.value === 'keep') handleNearDuplicateKeep(choice.messageId);
                else if (choice.transactionCode) void handleNearDuplicateDrop(choice.messageId, choice.transactionCode);
                break;
            case 'direction-question':
                if (choice.transactionCode) {
                    handleDirectionAnswer(choice.messageId, choice.transactionCode, choice.value as 'sent' | 'received');
                }
                break;
        }
    }, [handleOptionSelect, handleNearDuplicateKeep, handleNearDuplicateDrop, handleDirectionAnswer]);

    // A pasted message is treated as a batch of transaction messages: parse
    // it, then walk the user through what stood out before offering to build
    // the actual summary.
    const handleSend = useCallback(async (text: string) => {
        // The user's first message ends the "awaiting input" window.
        if (!isDemoSession && activeSession && activeSession.sessionStatus === 'awaiting_input') {
            updateSessionStatus(activeSession.id, 'active');
        }

        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        addMsg({ role: 'user', kind: 'text', text });

        // Typed answers to tappable questions, before anything else looks at
        // the text — a question that shows "Skip" also accepts "skip" typed.
        const answerable = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const typedChoice = matchTypedAnswer(answerable, text);
        if (typedChoice) {
            dispatchTypedAnswer(typedChoice);
            return;
        }

        // The guided demo is tap-first. A typed message is either a "Something
        // else" free-text answer or, during the paste lesson, a message to run
        // through the real pipeline. Never persists either way.
        if (isDemoSession) {
            const df = demoFlowRef.current;
            if (df?.step === 'paste') await handleDemoPaste(df, text);
            else await handleDemoText(text);
            return;
        }

        // Everything else is one turn of the conversation. Whether the message
        // is an answer, a correction, a pasted batch or none of those is the
        // engine's call, not this component's.
        await runTurn(text);
    }, [isDemoSession, activeSession, demoMessages, updateSessionStatus, addDemoMessage, addMessage, dispatchTypedAnswer, handleDemoText, handleDemoPaste, runTurn]);

    // Fired from the interactive receipt's tap-to-label UI. Updates the
    // message's own transactions in place (persisted through the normal
    // updateMessage/updateDemoMessage debounce, same as any other message edit);
    // computeReceiptData picks the new label up on its own.
    const handleLabelChange = useCallback((messageId: string, transactionCode: string, label: string | null) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const msg = currentMessages.find(m => m.id === messageId);
        if (!msg?.transactions) return;

        const updatedTransactions = msg.transactions.map(t =>
            t.transactionCode === transactionCode ? { ...t, receiptLabel: label } : t
        );

        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { transactions: updatedTransactions });
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage]);

    // A one-shot "please expand" signal for a skipped-review card, fired by
    // the partial notice's "View skipped" link (see ChatBubble/ChatSkippedReview).
    // Bumping epoch — rather than a plain boolean — lets the same target id
    // be re-signalled later without needing to first reset to a falsy value.
    const [skippedReviewSignal, setSkippedReviewSignal] = useState<{ id: string; epoch: number }>({ id: '', epoch: 0 });
    const handleViewSkipped = useCallback((skippedReviewId: string) => {
        setSkippedReviewSignal(s => ({ id: skippedReviewId, epoch: s.epoch + 1 }));
    }, []);

    function skippedEntryMatches(a: SkippedMessage, b: SkippedMessage): boolean {
        return a.rawText === b.rawText && a.reason === b.reason && a.transactionCode === b.transactionCode;
    }

    // Fired once a skipped-review row has a transaction ready to merge in —
    // either the loosened-threshold retry succeeded, or the manual-entry
    // form was submitted. Live-updates the receipt (patch the receipt
    // message's own transactions, which computeReceiptData picks up on its own).
    const handleIncludeSkipped = useCallback((
        skippedReviewMessageId: string, entry: SkippedMessage, transaction: ParsedTransaction
    ) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        const reviewMsg = currentMessages.find(m => m.id === skippedReviewMessageId);
        if (!receiptMsg?.transactions || !reviewMsg?.skippedMessages) return;

        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;

        const updatedTransactions = [...receiptMsg.transactions, transaction];
        updateMsg(receiptMsg.id, { transactions: updatedTransactions });

        const updatedSkipped = reviewMsg.skippedMessages.filter(m => !skippedEntryMatches(m, entry));
        updateMsg(skippedReviewMessageId, { skippedMessages: updatedSkipped });
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage]);

    // The simpler §6.4 path — the transaction already exists in full (a
    // hold/failed/verification-charge that parsed fine but was auto-excluded),
    // so this just flips excludedFromReceipt back off rather than re-parsing
    // or asking for manual entry.
    const handleUnexcludeSkipped = useCallback((skippedReviewMessageId: string, transactionCode: string) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        const reviewMsg = currentMessages.find(m => m.id === skippedReviewMessageId);
        if (!receiptMsg?.transactions || !reviewMsg?.skippedMessages) return;

        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;

        const updatedTransactions = receiptMsg.transactions.map(t =>
            t.transactionCode === transactionCode ? { ...t, excludedFromReceipt: false } : t
        );
        updateMsg(receiptMsg.id, { transactions: updatedTransactions });

        const updatedSkipped = reviewMsg.skippedMessages.filter(m => m.transactionCode !== transactionCode);
        updateMsg(skippedReviewMessageId, { skippedMessages: updatedSkipped });
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage]);

    // Phase D2 — tap-to-edit on the preview. Mutates only the message's own
    // transactions (and the draft document); PDF/HTML blobs are untouched
    // until Save or Share.
    const handleEditTransaction = useCallback((messageId: string, transactionCode: string, patch: Partial<ParsedTransaction>) => {
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const msg = currentMessages.find(m => m.id === messageId);
        if (!msg?.transactions) return;
        const updated = msg.transactions.map(tx => tx.transactionCode === transactionCode ? { ...tx, ...patch } : tx);
        (isDemoSession ? updateDemoMessage : updateMessage)(messageId, { transactions: updated });
        syncDraft(updated);
    }, [isDemoSession, demoMessages, activeSession, updateDemoMessage, updateMessage, syncDraft]);

    const handleEditContext = useCallback((patch: { merchantProfile?: MerchantProfile | null; onBehalfOf?: OnBehalfOfContext | null }) => {
        if (isDemoSession) {
            const f = demoFlowRef.current;
            if (!f || !patch.onBehalfOf) return;
            setDemoFlow({
                ...f,
                partyName: patch.onBehalfOf.partyName || 'Someone',
                preparedBy: patch.onBehalfOf.preparedBy,
                errandLabel: patch.onBehalfOf.purpose ?? '',
            });
            return;
        }
        const flow = docFlowRef.current;
        if (!flow) return;
        setDocFlow({
            ...flow,
            merchantProfile: patch.merchantProfile !== undefined ? patch.merchantProfile : flow.merchantProfile,
            onBehalfOf: patch.onBehalfOf !== undefined ? patch.onBehalfOf : flow.onBehalfOf,
        });
        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        syncDraft(receiptMsg?.transactions ?? flow.draftDoc?.transactions ?? []);
    }, [isDemoSession, demoMessages, activeSession, setDocFlow, setDemoFlow, syncDraft]);

    const documentContext = isDemoSession
        ? (demoFlow
            ? {
                documentType: 'on_behalf_of' as const,
                merchantProfile: null,
                onBehalfOf: { preparedBy: demoFlow.preparedBy, partyName: demoFlow.partyName || 'Someone', purpose: demoFlow.errandLabel || null },
            }
            : null)
        : (docFlow
            ? { documentType: docFlow.documentType, merchantProfile: docFlow.merchantProfile, onBehalfOf: docFlow.onBehalfOf }
            : null);

    const messages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
    const title = isDemoSession ? 'Sample data' : (activeSession?.title ?? 'New Receipt');

    // A short hint that tracks where the document flow is, so the composer
    // always says what to type next.
    const composerPlaceholder = (() => {
        if (isDemoSession) {
            if (demoFlow?.step === 'paste') return 'Send the message like a real one...';
            if (demoFlow?.awaitingText === 'amount') return 'Amount in Ksh...';
            if (demoFlow?.awaitingText) return 'Type your answer...';
            return 'Tap an option above...';
        }
        switch (docFlow?.pending) {
            case 'mode': return 'Tap an option above...';
            case 'zero-escape': return 'Tap an option above...';
            case 'cancel-confirm': return 'Tap an option above...';
            case 'correction-target': return 'Tap the one you meant...';
            case 'business-name': return 'Business name...';
            case 'party-name': return 'Who it was for...';
            case 'purpose': return "What it was for, or 'skip'...";
            case 'field-date': return 'A rough date...';
            // Prompting "in Ksh" while the conversation is running in USD is
            // the same silent coercion this flow was fixed for.
            case 'field-amount': return docFlow.draft.currency.explicit
                ? `Amount in ${docFlow.draft.currency.code}...`
                : 'Amount...';
            case 'field-recipient': return partyPlaceholder(docFlow.documentType);
            case 'confirm': return "'yes' to confirm, or tell me what's off...";
            default: return 'Copy your messages, or describe what you spent...';
        }
    })();
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

            {!isDemoSession && (!isAvailable || !isReceiptStoreAvailable) && (
                <p className="text-xs text-center text-[var(--text-muted)] py-2 px-4 flex-shrink-0">
                    Chat history unavailable in private browsing — this session won't be saved.
                </p>
            )}

            <ChatMessageList
                messages={messages}
                onLabelChange={handleLabelChange}
                onViewSkipped={handleViewSkipped}
                skippedReviewExpandSignal={skippedReviewSignal}
                onIncludeSkipped={handleIncludeSkipped}
                onUnexcludeSkipped={handleUnexcludeSkipped}
                onNearDuplicateKeep={handleNearDuplicateKeep}
                onNearDuplicateDrop={handleNearDuplicateDrop}
                onDirectionAnswer={handleDirectionAnswer}
                onOptionSelect={handleOptionSelect}
                documentContext={documentContext}
                onApproveDocument={isDemoSession ? undefined : handleApprove}
                onEditTransaction={handleEditTransaction}
                onEditContext={handleEditContext}
            />

            <ChatComposer
                onSend={handleSend}
                disabled={!canCompose || isProcessing}
                autoFocus={!isDemoSession && !!resumeSessionId}
                placeholder={composerPlaceholder}
            />
        </ChatShell>
    );
}
