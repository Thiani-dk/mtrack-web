import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    ChatMessage, ChatOption, ParsedTransaction, SkippedMessage,
    DocumentType, MerchantProfile, OnBehalfOfContext, TrackedDocument,
} from '../../types';
import { extractDescription, buildSelfReportedTransaction, parseConversationalDate } from '../../lib/conversationalCapture';
import { fmtProse } from '../../lib/transactionDisplay';
import { useDocumentStore } from '../../lib/useDocumentStore';
import { getDocument } from '../../lib/documentStore';
import { buildDraft } from '../../lib/draftDocument';
import { pipelineEligibility } from '../../lib/documentPipeline';
import { useChatSession } from '../../lib/useChatSession';
import { useReceiptStore } from '../../lib/useReceiptStore';
import { useAllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import type { AllTimeStats } from '../../lib/aggregate/useAllTimeStats';
import { parseAllMessages, type ParseStats, type LinkEnrichment, type NearDuplicatePair } from '../../lib/parsers';
import { generateDemoMessages } from '../../lib/demoData';
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
}

const GREETING = "I'm M-Track. Copy your M-Pesa, Airtel Money, or any transaction confirmation messages and send them here. I'll break down what you spent, spot patterns, and put together a receipt you can download.";

const RESUME_BUBBLE = "Still here. Copy your messages whenever you're ready.";

// ── Mode selection (Phase C) — the front door to the whole feature ──
const MODE_QUESTION =
    "What are we putting together? Your own spending, a receipt for a customer, or money you spent for someone else?";
const MODE_OPTIONS: ChatOption[] = [
    { id: 'own', label: 'My own spending', sublabel: 'Copy your messages, or describe what you spent', value: 'own' },
    { id: 'pos', label: 'A receipt for a customer', sublabel: 'Proof of purchase you hand over', value: 'point_of_sale' },
    { id: 'obo', label: 'Money I spent for someone else', sublabel: 'So they can pay you back', value: 'on_behalf_of' },
];
const OWN_PROMPT =
    "Copy your M-Pesa, Airtel Money, or bank messages in. If you don't have the message for something, just tell me what you spent and when.";
const POS_NAME_PROMPT = "What's the business name?";
const POS_ITEM_PROMPT =
    "Now tell me what they bought and the amount. You can paste the M-Pesa message instead if you have it.";
const OBO_PARTY_PROMPT = "Who was this for?";
const OBO_PURPOSE_PROMPT = "What was it for? Say skip if you'd rather leave that out.";
const OBO_INPUT_PROMPT =
    "Copy the M-Pesa messages, or tell me what you spent and when.";
const DATE_PROMPT =
    "When was that? A rough date is fine, but I'd rather leave it blank than guess.";
const OBO_AMBIGUOUS_DATE_PROMPT =
    "That date could be read two ways, day first or month first. On a claim a wrong date can get the whole thing rejected, so which is it?";
const EFFICIENCY_NUDGE =
    "If you've got the M-Pesa messages for these, copy them in. They carry the exact date and reference number, which makes this much harder to argue with.";

type PendingPrompt =
    | 'mode' | 'business-name' | 'party-name' | 'purpose'
    | 'field-date' | 'field-amount' | 'field-recipient' | 'confirm'
    | 'purpose-label' | 'input';

interface CaptureDraft {
    amount: number | null;
    currency: string;
    recipient: string | null;
    date: Date | null;
    dateAmbiguous: boolean;
    purposeLabel: string | null;
    type: 'sent' | 'received';
}

interface DocFlow {
    documentType: DocumentType;
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
    pending: PendingPrompt;
    draft: CaptureDraft;
    describedCount: number;
    nudgeShown: boolean;
    // Transaction codes still awaiting a guided purpose label (on_behalf_of).
    purposeQueue: string[];
    // The persisted draft TrackedDocument backing this flow (id === session id).
    draftDoc: TrackedDocument | null;
}

function emptyDraft(): CaptureDraft {
    return { amount: null, currency: 'KES', recipient: null, date: null, dateAmbiguous: false, purposeLabel: null, type: 'sent' };
}

function fmtShortDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DEMO_INTRO = "This is a demo run with made-up transactions, so you can see how it works before using your own.";
const DEMO_NEXT_STEP = 'Want to do this with your real messages? Start a new summary.';

const LEAD_INS = [
    "Here's what stood out.",
    'A few things I noticed.',
    'Worth knowing:',
    'Quick read on this lot:',
];

// A parsed-transaction count at or below this counts as "small" — worth
// saying so plainly rather than promising a rich summary.
const SMALL_RESULT_THRESHOLD = 3;

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
    documentType: DocumentType = 'expense_summary'
): Promise<void> {
    const scoped = fullTransactions.filter(t => !t.excludedFromReceipt);

    // No date-range question exists yet, so nothing is ever "out of range" —
    // passing 0 here means the 'all-out-of-range' and 'out-of-range' notices
    // can never fire.
    const notices = buildParseNotices(stats, { linkEnrichments, nearDuplicates });
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

    if (isDemo) {
        await sleep(400);
        addMsg({ role: 'bot', kind: 'text', text: DEMO_NEXT_STEP });
    }
}

export function ChatScreen({ demoMode, resumeSessionId, onBack }: ChatScreenProps) {
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

    const hasInitialized = useRef(false);
    const greetedSessionIds = useRef(new Set<string>());
    const resumeGreetedSessionIds = useRef(new Set<string>());
    const restoredDraftSessionIds = useRef(new Set<string>());
    const demoStarted = useRef(false);

    const addDemoMessage = useCallback<AddMessageFn>((msg) => {
        const id = crypto.randomUUID();
        const timestamp = Date.now();
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
        addMessage({ role: 'bot', kind: 'text', text: GREETING });
        addMessage({ role: 'bot', kind: 'options', text: MODE_QUESTION, options: MODE_OPTIONS });
        setDocFlow({
            documentType: 'expense_summary',
            merchantProfile: null,
            onBehalfOf: null,
            pending: 'mode',
            draft: emptyDraft(),
            describedCount: 0,
            nudgeShown: false,
            purposeQueue: [],
            draftDoc: null,
        });
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
        addMessage({ role: 'bot', kind: 'text', text: RESUME_BUBBLE });
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
                documentType: doc.documentType,
                merchantProfile: doc.merchantProfile,
                onBehalfOf: doc.onBehalfOf,
                pending: 'input',
                draft: emptyDraft(),
                describedCount: 0,
                nudgeShown: true,
                purposeQueue: [],
                draftDoc: doc,
            });
            if (doc.status === 'draft') {
                addMessage({ role: 'bot', kind: 'text', text: "Picking up where we left off. Edit anything on the document, or tap Approve when it looks right." });
            }
        })();
    }, [isDemoSession, activeSession, setDocFlow, addMessage]);

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

                const { transactions, stats, skippedMessages: parserSkipped, linkEnrichments, nearDuplicates } = parseAllMessages(generateDemoMessages());
                const withDefaults = transactions.map(t =>
                    t.isHold || t.failed || t.isVerificationCharge ? { ...t, excludedFromReceipt: true } : t
                );
                const inRange = withDefaults.filter(t => t.date >= cutoff);
                const excludedSkipped: SkippedMessage[] = inRange
                    .filter(t => t.excludedFromReceipt)
                    .map(t => ({ rawText: t.rawLine, reason: 'excluded', transactionCode: t.transactionCode }));

                // Demo history is fake and never persisted, so the "run a longer
                // range" hint (which reads real past sessions) never applies here,
                // and there's no aggregate to consult or update.
                await deliverInsights(
                    inRange, stats, [...parserSkipped, ...excludedSkipped], thinkingId,
                    addDemoMessage, updateDemoMessage, true, false, null,
                    linkEnrichments, nearDuplicates
                );
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

    // ── Phase C: mode selection + conversational capture ──────────────────

    const handleOptionSelect = useCallback((messageId: string, value: string) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        updateMsg(messageId, { answered: true, answeredValue: value });

        if (!isDemoSession && activeSession?.sessionStatus === 'awaiting_input') {
            updateSessionStatus(activeSession.id, 'active');
        }

        const base = {
            merchantProfile: null, onBehalfOf: null, draft: emptyDraft(),
            describedCount: 0, nudgeShown: false, purposeQueue: [] as string[], draftDoc: null,
        };
        if (value === 'own') {
            setDocFlow({ ...base, documentType: 'expense_summary', pending: 'input' });
            addMsg({ role: 'bot', kind: 'text', text: OWN_PROMPT });
        } else if (value === 'point_of_sale') {
            setDocFlow({ ...base, documentType: 'point_of_sale', pending: 'business-name' });
            addMsg({ role: 'bot', kind: 'text', text: POS_NAME_PROMPT });
        } else if (value === 'on_behalf_of') {
            setDocFlow({ ...base, documentType: 'on_behalf_of', pending: 'party-name' });
            addMsg({ role: 'bot', kind: 'text', text: OBO_PARTY_PROMPT });
        }
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, activeSession, updateSessionStatus, setDocFlow]);

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
            text: `What was the ${fmtProse(txn.amount)} to ${txn.merchant ?? txn.recipient} for? Say skip to leave it out.`,
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

    const commitDraft = useCallback(async (flow: DocFlow, draft: CaptureDraft) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;
        if (draft.amount == null || draft.amount <= 0 || !draft.recipient || !draft.date) return;

        const txn = buildSelfReportedTransaction({
            amount: draft.amount, currency: draft.currency, recipient: draft.recipient,
            date: draft.date, dateAmbiguous: draft.dateAmbiguous, purposeLabel: draft.purposeLabel, type: draft.type,
        });

        // A described transaction under "my own spending" is a personal note,
        // not an SMS-built expense summary.
        const resolvedType: DocumentType =
            flow.documentType === 'expense_summary' ? 'personal_note' : flow.documentType;

        const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
        const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
        const allTxns = receiptMsg?.transactions ? [...receiptMsg.transactions, txn] : [txn];
        if (receiptMsg?.transactions) {
            updateMsg(receiptMsg.id, { transactions: allTxns });
        } else {
            addMsg({
                role: 'bot', kind: 'receipt', transactions: allTxns, dateRange: fmtShortDate(draft.date),
                isDemo: false, documentType: resolvedType,
            });
        }

        setDocFlow({ ...flow, documentType: resolvedType, draft: emptyDraft(), pending: 'input' });
        syncDraft(allTxns);

        if (resolvedType === 'on_behalf_of' && !txn.purposeLabel) {
            setDocFlow(f => (f ? { ...f, purposeQueue: [txn.transactionCode], pending: 'purpose-label' } : f));
            await sleep(300);
            askPurposeFor(txn.transactionCode, allTxns);
        } else {
            addMsg({ role: 'bot', kind: 'text', text: "Added. Tell me the next one, or tap Approve when the document looks right." });
        }
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, demoMessages, activeSession, setDocFlow, syncDraft, askPurposeFor]);

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

    // date first (Phase C3), then amount, then who / what. Emits the next
    // question and returns which prompt we're now waiting on.
    const askNextField = useCallback((draft: CaptureDraft, documentType: DocumentType): PendingPrompt => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        if (!draft.date) { addMsg({ role: 'bot', kind: 'text', text: DATE_PROMPT }); return 'field-date'; }
        if (draft.amount == null || draft.amount <= 0) { addMsg({ role: 'bot', kind: 'text', text: 'How much was it?' }); return 'field-amount'; }
        if (!draft.recipient) {
            addMsg({ role: 'bot', kind: 'text', text: documentType === 'point_of_sale' ? 'What did they buy?' : 'Who was it paid to?' });
            return 'field-recipient';
        }
        return 'confirm';
    }, [isDemoSession, addDemoMessage, addMessage]);

    const confirmText = useCallback((draft: CaptureDraft): string => {
        const parts = [`${fmtProse(draft.amount ?? 0)} to ${draft.recipient}`];
        if (draft.purposeLabel) parts.push(`for ${draft.purposeLabel}`);
        if (draft.date) parts.push(`on ${fmtShortDate(draft.date)}`);
        return `${parts.join(', ')}. Right?`;
    }, []);

    const advanceAfterField = useCallback((flow: DocFlow, draft: CaptureDraft) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const next = askNextField(draft, flow.documentType);
        setDocFlow({ ...flow, draft, pending: next });
        if (next === 'confirm') addMsg({ role: 'bot', kind: 'text', text: confirmText(draft) });
    }, [isDemoSession, addDemoMessage, addMessage, askNextField, confirmText, setDocFlow]);

    // Runs a described transaction through the shared extraction components,
    // then either confirms in one turn or falls to one-field-at-a-time.
    const handleDescription = useCallback(async (text: string) => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const flow = docFlowRef.current;
        if (!flow) return;

        const r = extractDescription(text);
        const draft: CaptureDraft = {
            ...flow.draft,
            amount: r.amount ?? flow.draft.amount,
            currency: r.currency,
            recipient: r.recipient ?? flow.draft.recipient,
            date: r.date ?? flow.draft.date,
            dateAmbiguous: r.dateAmbiguous,
            purposeLabel: r.purposeLabel ?? flow.draft.purposeLabel,
        };
        const describedCount = flow.describedCount + 1;

        const fireNudge = () => {
            if (describedCount >= 2 && !docFlowRef.current?.nudgeShown) {
                addMsg({ role: 'bot', kind: 'text', text: EFFICIENCY_NUDGE });
                setDocFlow(f => (f ? { ...f, nudgeShown: true } : f));
            }
        };

        // Phase C5 — a day/month flip on a reimbursement claim can sink the
        // whole submission, so escalate it before doing anything else.
        if (draft.date && draft.dateAmbiguous && flow.documentType === 'on_behalf_of') {
            setDocFlow({ ...flow, draft: { ...draft, date: null }, pending: 'field-date', describedCount });
            addMsg({ role: 'bot', kind: 'text', text: OBO_AMBIGUOUS_DATE_PROMPT });
            fireNudge();
            return;
        }

        if (r.confidence === 'high' && draft.amount && draft.recipient && draft.date) {
            setDocFlow({ ...flow, draft, pending: 'confirm', describedCount });
            addMsg({ role: 'bot', kind: 'text', text: confirmText(draft) });
        } else {
            const next = askNextField(draft, flow.documentType);
            setDocFlow({ ...flow, draft, pending: next, describedCount });
            if (next === 'confirm') addMsg({ role: 'bot', kind: 'text', text: confirmText(draft) });
        }
        fireNudge();
    }, [isDemoSession, addDemoMessage, addMessage, askNextField, confirmText, setDocFlow]);

    // Handles a message while a specific prompt is pending. Returns true if it
    // consumed the input; false only when we're in the open 'input' state and
    // the caller should decide between a paste and a description.
    const handleDocFlow = useCallback(async (text: string): Promise<boolean> => {
        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const flow = docFlowRef.current;
        if (!flow) return false;
        const t = text.trim();

        switch (flow.pending) {
            case 'mode':
                addMsg({ role: 'bot', kind: 'text', text: "Tap one of the options above so I know what we're making." });
                return true;
            case 'business-name':
                if (!t) { addMsg({ role: 'bot', kind: 'text', text: POS_NAME_PROMPT }); return true; }
                setDocFlow({ ...flow, merchantProfile: { businessName: t, contact: null }, pending: 'input' });
                addMsg({ role: 'bot', kind: 'text', text: POS_ITEM_PROMPT });
                return true;
            case 'party-name':
                if (!t) { addMsg({ role: 'bot', kind: 'text', text: OBO_PARTY_PROMPT }); return true; }
                setDocFlow({ ...flow, onBehalfOf: { preparedBy: null, partyName: t, purpose: null }, pending: 'purpose' });
                addMsg({ role: 'bot', kind: 'text', text: OBO_PURPOSE_PROMPT });
                return true;
            case 'purpose': {
                const skip = !t || /^(skip|none|n\/?a|no|nothing)$/i.test(t);
                setDocFlow({
                    ...flow,
                    onBehalfOf: flow.onBehalfOf ? { ...flow.onBehalfOf, purpose: skip ? null : t } : flow.onBehalfOf,
                    pending: 'input',
                });
                addMsg({ role: 'bot', kind: 'text', text: OBO_INPUT_PROMPT });
                return true;
            }
            case 'field-date': {
                const d = parseConversationalDate(t);
                if (!d) {
                    addMsg({ role: 'bot', kind: 'text', text: "I still can't read a date there. A month and day is enough, a year helps too." });
                    return true;
                }
                if (d.ambiguous && flow.documentType === 'on_behalf_of') {
                    addMsg({ role: 'bot', kind: 'text', text: OBO_AMBIGUOUS_DATE_PROMPT });
                    return true;
                }
                advanceAfterField(flow, { ...flow.draft, date: d.date, dateAmbiguous: d.ambiguous });
                return true;
            }
            case 'field-amount': {
                const cleaned = t.replace(/[,\s]/g, '');
                const m = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
                if (!m) { addMsg({ role: 'bot', kind: 'text', text: 'How much, in Ksh?' }); return true; }
                advanceAfterField(flow, { ...flow.draft, amount: parseFloat(m[1]) });
                return true;
            }
            case 'field-recipient':
                if (!t) {
                    addMsg({ role: 'bot', kind: 'text', text: flow.documentType === 'point_of_sale' ? 'What did they buy?' : 'Who was it paid to?' });
                    return true;
                }
                advanceAfterField(flow, { ...flow.draft, recipient: t });
                return true;
            case 'purpose-label': {
                const [code, ...restQueue] = flow.purposeQueue;
                const skip = !t || /^(skip|none|n\/?a|no)$/i.test(t);
                const currentMessages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
                const receiptMsg = currentMessages.find(m => m.kind === 'receipt');
                let updatedTxns = receiptMsg?.transactions ?? [];
                if (!skip && code && receiptMsg?.transactions) {
                    updatedTxns = receiptMsg.transactions.map(tx =>
                        tx.transactionCode === code ? { ...tx, purposeLabel: t } : tx);
                    (isDemoSession ? updateDemoMessage : updateMessage)(receiptMsg.id, { transactions: updatedTxns });
                }
                if (restQueue.length > 0) {
                    setDocFlow({ ...flow, purposeQueue: restQueue });
                    askPurposeFor(restQueue[0], updatedTxns);
                } else {
                    setDocFlow({ ...flow, purposeQueue: [], pending: 'input' });
                    addMsg({ role: 'bot', kind: 'text', text: "That's every line explained. Tap Approve when the document looks right." });
                }
                syncDraft(updatedTxns);
                return true;
            }
            case 'confirm':
                if (/^(y\b|yes|yep|yeah|correct|right|ok|okay|sure|that'?s? right|👍)/i.test(t)) {
                    await commitDraft(flow, flow.draft);
                } else {
                    setDocFlow({
                        ...flow,
                        draft: { ...emptyDraft(), currency: flow.draft.currency, purposeLabel: flow.draft.purposeLabel },
                        pending: 'field-date',
                    });
                    addMsg({ role: 'bot', kind: 'text', text: `No problem, let's go through it. ${DATE_PROMPT}` });
                }
                return true;
            case 'input':
                return false;
        }
        return false;
    }, [isDemoSession, addDemoMessage, addMessage, updateDemoMessage, updateMessage, demoMessages, activeSession, advanceAfterField, commitDraft, setDocFlow, syncDraft, askPurposeFor]);

    // A pasted message is treated as a batch of transaction messages: parse
    // it, then walk the user through what stood out before offering to build
    // the actual summary.
    const handleSend = useCallback(async (text: string) => {
        // The user's first message ends the "awaiting input" window.
        if (!isDemoSession && activeSession && activeSession.sessionStatus === 'awaiting_input') {
            updateSessionStatus(activeSession.id, 'active');
        }

        const addMsg = isDemoSession ? addDemoMessage : addMessage;
        const updateMsg = isDemoSession ? updateDemoMessage : updateMessage;

        addMsg({ role: 'user', kind: 'text', text });

        // Route through the document flow first. A pending prompt consumes the
        // message outright; the open 'input' state falls through here so we can
        // tell a pasted message from a typed description.
        if (!isDemoSession && docFlowRef.current) {
            const consumed = await handleDocFlow(text);
            if (consumed) return;
            if (parseAllMessages(text).transactions.length === 0) {
                await handleDescription(text);
                return;
            }
        }

        setIsProcessing(true);

        const thinkingId = addMsg({ role: 'bot', kind: 'thinking' });

        try {
            const { transactions, stats: parseStats, skippedMessages: parserSkipped, linkEnrichments, nearDuplicates } = parseAllMessages(text);
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
            // it (and only for expense_summary / personal_note). deliverInsights
            // still gets the current all-time stats read-only, so the
            // month-over-month comparison and fee-trend insights can surface.
            const excludedSkipped: SkippedMessage[] = withDefaults
                .filter(t => t.excludedFromReceipt)
                .map(t => ({ rawText: t.rawLine, reason: 'excluded', transactionCode: t.transactionCode }));

            const flow = docFlowRef.current;
            await deliverInsights(
                withDefaults, parseStats, [...parserSkipped, ...excludedSkipped], thinkingId, addMsg, updateMsg, isDemoSession, longerRangeAvailable,
                allTimeStats,
                linkEnrichments, nearDuplicates,
                flow?.documentType ?? 'expense_summary'
            );

            if (!isDemoSession) {
                syncDraft(withDefaults);
                await maybeStartPurposeLabelling(withDefaults);
            }
        } catch (err) {
            console.error('handleSend failed:', err);
            updateMsg(thinkingId, { kind: 'text', text: PROCESSING_ERROR_TEXT });
        } finally {
            setIsProcessing(false);
        }
    }, [isDemoSession, activeSession, updateSessionStatus, addDemoMessage, addMessage, updateDemoMessage, updateMessage, receipts, allTimeStats, handleDocFlow, handleDescription, syncDraft, maybeStartPurposeLabelling]);

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

    // A near-duplicate question is only ever answered by a tap. "Keep both"
    // just locks the question. "Drop the small one" additionally flips the
    // smaller transaction out of the receipt — the same live receipt patch
    // the skipped-review handlers use, so computeReceiptData picks it up.
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
    }, [isDemoSession, demoMessages, activeSession, setDocFlow, syncDraft]);

    const documentContext = docFlow
        ? { documentType: docFlow.documentType, merchantProfile: docFlow.merchantProfile, onBehalfOf: docFlow.onBehalfOf }
        : null;

    const messages = isDemoSession ? demoMessages : (activeSession?.messages ?? []);
    const title = isDemoSession ? 'Sample data' : (activeSession?.title ?? 'New Receipt');

    // A short hint that tracks where the document flow is, so the composer
    // always says what to type next.
    const composerPlaceholder = (() => {
        switch (docFlow?.pending) {
            case 'mode': return 'Tap an option above...';
            case 'business-name': return 'Business name...';
            case 'party-name': return 'Who it was for...';
            case 'purpose': return "What it was for, or 'skip'...";
            case 'field-date': return 'A rough date...';
            case 'field-amount': return 'Amount in Ksh...';
            case 'field-recipient': return docFlow.documentType === 'point_of_sale' ? 'What they bought...' : 'Who it was paid to...';
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
                onOptionSelect={handleOptionSelect}
                documentContext={documentContext}
                onApproveDocument={isDemoSession ? undefined : handleApprove}
                onEditTransaction={isDemoSession ? undefined : handleEditTransaction}
                onEditContext={isDemoSession ? undefined : handleEditContext}
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
