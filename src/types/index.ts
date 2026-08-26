import type { Insight } from '../lib/insights/types';
import type { RecurringPattern } from '../lib/insights/recurring';

export type AppStep =
    | 'home'
    | 'history'
    | 'chat'
    | 'allTime'
    | 'badges';

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
// Conversational receipt builder (chat)
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'bot' | 'user' | 'system';

export type ChatMessageKind =
    | 'text'              // plain message bubble
    | 'options'           // tappable option cards
    | 'dropzone'          // the paste/upload input widget
    | 'transactions'      // parsed transaction list with label pickers
    | 'receipt'           // final receipt preview + download buttons
    | 'insight'           // a single generated observation
    | 'recurring'         // detected recurring payment patterns
    | 'badge'             // a newly-unlocked badge
    | 'thinking';         // animated typing indicator

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
    badgeId?: string;                   // for 'badge' kind
    badgeLeadIn?: string;                // for 'badge' kind — varied unlock copy
    // for 'text' kind — set on the 'partial' parse notice so it can render a
    // tappable "View skipped ->" affordance. Handler is stubbed until Part 6
    // wires it to the skipped-messages review panel.
    skippedCount?: number;
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