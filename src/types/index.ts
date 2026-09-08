import type { Insight } from '../lib/insights/types';
import type { RecurringPattern } from '../lib/insights/recurring';
import type { NearDuplicatePair } from '../lib/parsers/nearDuplicates';

export type AppStep =
    | 'home'
    | 'history'
    | 'chat'
    | 'allTime';

export type TransactionSubType =
    | 'person_send'
    | 'person_receive'
    | 'pochi_send'
    | 'paybill'
    | 'airtime'
    | 'data'
    | 'withdrawal'
    | 'mshwari'
    | 'investment'
    | 'unknown';

export type ExpenseLabel =
    | 'Cost of Sales'
    | 'Transport & Travel'
    | 'Utilities'
    | 'Airtime & Data'
    | 'Supplier Payment'
    | 'Staff Payment'
    | 'Meals & Entertainment'
    | 'Medical'
    | 'Rent & Accommodation'
    | 'Equipment & Supplies'
    | 'Investment / Savings'
    | 'Personal'
    | 'Other Business Expense'
    | null;

// ---------------------------------------------------------------------------
// Unified document model (see documentStore.ts)
// ---------------------------------------------------------------------------

export type DocumentType = 'expense_summary' | 'personal_note' | 'point_of_sale' | 'on_behalf_of';
export type DocumentStatus = 'draft' | 'approved';

// A single transaction's provenance, and — one level up — a whole document's.
// 'sms_verified': produced by the SMS parsing pipeline.
// 'self_reported': entered conversationally or through a manual form.
// 'mixed': document-level only, when its included transactions disagree.
export type DataSource = 'sms_verified' | 'self_reported' | 'mixed';

export interface LineItem {
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    amount: number;
}

export interface MerchantProfile {
    businessName: string;
    contact: string | null;
}

export interface OnBehalfOfContext {
    preparedBy: string | null;
    partyName: string;
    purpose: string | null;
}

export interface TrackedDocument {
    id: string;
    createdAt: number;
    updatedAt: number;
    status: DocumentStatus;
    documentType: DocumentType;
    // Computed from the included transactions, never stored independently —
    // always recompute with computeDataSource(). Persisted only as a
    // denormalised convenience; treat computeDataSource as the source of truth.
    dataSource: DataSource;
    transactions: ParsedTransaction[];
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
    // Min / max transaction date across the INCLUDED transactions, recomputed
    // whenever that set changes. Both null when no included transaction has a
    // usable date. Never populated from a relative range selection.
    coveringFrom: number | null;
    coveringTo: number | null;
}

export interface ParsedTransaction {
    // core (existing fields preserved for compatibility)
    date: Date;
    time: string;
    type: 'sent' | 'received';
    subType: TransactionSubType;
    amount: number;
    recipient: string;
    transactionCode: string;
    balance: number | null;
    // Parsed directly from "Transaction cost, Ksh7.00" in the SMS
    transactionCost: number | null;
    rawLine: string;
    label: ExpenseLabel;
    customLabel: string | null;
    // Per-transaction label added before downloading the receipt
    receiptLabel: string | null;
    // Whether the user has toggled this transaction out of the receipt
    excludedFromReceipt: boolean;

    // new normalised fields (field-extraction parsing engine)
    currency: string;                // 'KES' | 'USD' | ...
    sender: string | null;
    account: string | null;          // paybill account number
    provider: string;                // 'M-PESA' | 'Co-operative Bank' | 'Unknown'
    method: string;                  // 'p2p' | 'till' | 'paybill' | 'card' | 'airtime' | ...
    merchant: string | null;         // 'Netflix', 'Naivas'
    merchantCategory: string | null; // 'Streaming & Subscriptions'
    location: string | null;         // 'Los Gatos NL'
    isBusiness: boolean;             // P2B vs P2P

    // quality metadata
    confidence: number;              // 0-100
    confidenceLevel: 'high' | 'medium' | 'low';
    missingFields: string[];
    codeIsSynthetic: boolean;
    dateAmbiguous: boolean;
    failed: boolean;                 // "Was Declined" / "Unsuccessful"
    isHold: boolean;                 // zero-value authorisation hold
    isVerificationCharge: boolean;   // paired Ksh<=5 sent/received test charge (e.g. GlobalPay card verification)
    cardLast4: string | null;        // last 3-4 digits from "card ****3388", when present

    // The Fuliza (overdraft) portion of a payment that drew on Fuliza, when
    // the message mentions one. The transaction amount is still the amount
    // sent, not this. null when no Fuliza was involved.
    fulizaAmount: number | null;
    // For a reversal message: the transaction code of the original payment
    // it reverses. null otherwise.
    reversalOf: string | null;
    // Set on BOTH sides of a matched reversal pair (the original and its
    // reversal) — they cancel each other, so both are excluded by default.
    isReversed: boolean;

    // ── direction / amount oracle (balance reconciliation) ──
    // The amount was confirmed by arithmetic: the balance on this message
    // minus the balance on the previous message on the same ledger equals
    // exactly +amount (received) or -(amount + fee) (sent).
    amountVerified: boolean;
    // The balance moved by an amount that matches neither hypothesis — weak
    // evidence the amount extractor picked the wrong number from a
    // multi-amount message. Surfaced for review, never acted on automatically.
    balanceMismatch: boolean;
    // How `type` was decided, strongest first: 'balance' (reconciliation),
    // 'keyword' (an unambiguous verb/phrase), 'structural' (preposition +
    // possessive), or 'unresolved' (we genuinely could not tell — `type`
    // holds a best guess but directionUnresolved is set).
    directionSource: 'balance' | 'keyword' | 'structural' | 'unresolved';
    // The balance oracle proved a direction that contradicts what the wording
    // said. Either the message is worded misleadingly or the amount is wrong.
    directionDisputed: boolean;
    // We could not determine direction. `type` is a neutral guess; the app
    // asks the user rather than acting on it. Forces confidenceLevel 'low'.
    directionUnresolved: boolean;

    // ── unified document model (Phase A) ──
    // 'sms_verified' for anything from the SMS parsing pipeline,
    // 'self_reported' for anything entered conversationally or by hand.
    dataSource: 'sms_verified' | 'self_reported';
    // Itemised breakdown for a point-of-sale line. null when the transaction
    // is a single undifferentiated amount.
    lineItems: LineItem[] | null;
    // Free text a person writes to explain one line to one reader
    // ("client lunch at Galitos, met the Kisumu team"). Deliberately separate
    // from receiptLabel, which is a category from a fixed preset — do not
    // merge them or fall one back to the other.
    purposeLabel: string | null;
}

// ---------------------------------------------------------------------------
// Receipt history (IndexedDB)
// ---------------------------------------------------------------------------

export interface StoredReceipt {
    id: string;              // crypto.randomUUID()
    createdAt: number;       // Date.now() timestamp
    dateRange: string;       // "past 7 days", "past 30 days" etc
    transactionCount: number;
    totalSpent: number;      // sum of all sent transactions
    totalReceived: number;
    totalFees: number;
    // The actual receipt content for re-download
    transactions: ParsedTransaction[];
    // Quick summary for the dashboard card
    topRecipients: string[]; // top 3 recipients by total amount
    labels: string[];        // unique receipt labels used
}

// ---------------------------------------------------------------------------
// Skipped-message recovery (Part 6)
// ---------------------------------------------------------------------------

// 'not-a-transaction' — classified as something other than a transaction
// (service notice, security alert, promotional, unknown noise).
// 'duplicate' — a successfully-parsed transaction removed by dedup.
// 'unreadable' — classified as a transaction but extraction couldn't
// produce a trustworthy record (missing amount/date, or score too low).
// 'excluded' — parsed fine, but auto-excluded from the receipt (hold,
// failed payment, verification charge) — see getExclusionReason().
export interface SkippedMessage {
    rawText: string;
    reason: 'not-a-transaction' | 'duplicate' | 'unreadable' | 'excluded';
    // Set only for 'excluded' entries — identifies the already-parsed
    // transaction (already present in the receipt message's own
    // `transactions` array, just flagged excludedFromReceipt) that this
    // entry is standing in for, so "Include" can find and un-exclude it
    // without re-parsing or asking for manual entry.
    transactionCode?: string;
}

// ---------------------------------------------------------------------------
// Conversational receipt builder (chat)
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'bot' | 'user' | 'system';

export type ChatMessageKind =
    | 'text'              // plain message bubble
    | 'options'           // tappable option cards
    | 'copyable'          // a monospace, copy-to-clipboard block (demo paste lesson)
    | 'dropzone'          // the paste/upload input widget
    | 'transactions'      // parsed transaction list with label pickers
    | 'receipt'           // final receipt preview + download buttons
    | 'insight'           // a single generated observation
    | 'recurring'         // detected recurring payment patterns
    | 'skipped-review'    // recoverable messages the parser set aside
    | 'near-duplicate'    // a tappable "keep both / drop the small one" question
    | 'direction-question' // "money in or out?" for a transaction the parser couldn't place
    | 'thinking';         // animated typing indicator

export interface DirectionQuestion {
    transactionCode: string;
    amountLabel: string;   // "Ksh 500"
    partyLabel: string;    // "KPLC" / "Unknown"
    dateLabel: string;     // "21 Aug"
}

export interface ChatOption {
    id: string;
    label: string;
    sublabel?: string;
    icon?: string;        // lucide icon name
    value: string;        // what gets passed back when tapped
}

export interface ChatMessage {
    id: string;
    role: ChatMessageRole;
    kind: ChatMessageKind;
    text?: string;                      // for 'text' kind
    options?: ChatOption[];             // for 'options' kind
    transactions?: ParsedTransaction[]; // for 'transactions' and 'receipt' kinds
    dateRange?: string;                 // for 'receipt' kind
    isDemo?: boolean;                   // for 'receipt' kind — watermarks the PDF/HTML
    insight?: Insight;                  // for 'insight' kind
    recurringPatterns?: RecurringPattern[]; // for 'recurring' kind
    // for 'text' kind — set on the 'partial' parse notice so it can render a
    // tappable "View skipped ->" affordance, wired to open the paired
    // 'skipped-review' message identified by skippedReviewId.
    skippedCount?: number;
    skippedReviewId?: string;           // for 'text' kind (the 'partial' notice)
    skippedMessages?: SkippedMessage[]; // for 'skipped-review' kind
    nearDuplicatePair?: NearDuplicatePair; // for 'near-duplicate' kind
    directionQuestion?: DirectionQuestion; // for 'direction-question' kind
    // for 'receipt' kind — which of the four documents this builds, plus the
    // session-scoped context gathered for it. These ride on the message (not
    // the persisted session) so a resumed draft can rebuild its state.
    documentType?: DocumentType;
    merchantProfile?: MerchantProfile | null;
    onBehalfOf?: OnBehalfOfContext | null;
    documentStatus?: DocumentStatus; // for 'receipt' kind — 'approved' once locked in
    timestamp: number;
    // Once the user has answered an options message, lock it
    answered?: boolean;
    answeredValue?: string;
}

// 'awaiting_input' — session exists, composer still empty, no message sent yet.
// 'active' — the user has sent at least one message. Optional (not `?`-free)
// because sessions persisted before this field existed have no value here;
// treat a missing sessionStatus the same as 'active' (never auto-resume into
// a pre-existing session that predates this feature).
export type ChatSessionStatus = 'awaiting_input' | 'active';

export interface ChatSession {
    id: string;
    createdAt: number;
    updatedAt: number;
    title: string;              // e.g. "Expense Summary — Aug 22"
    messages: ChatMessage[];
    // Denormalised for the sidebar preview
    transactionCount: number;
    totalSpent: number;
    isComplete: boolean;        // true once a receipt was generated
    sessionStatus?: ChatSessionStatus;
}