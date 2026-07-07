export type TimeRange = 'week' | 'month' | '3months' | '6months' | 'year';
export type AppMode = 'receipt' | 'ledger' | 'declutter';
export type AppStep =
    | 'home'
    | 'timeRange'
    | 'input'
    | 'review'
    | 'output'
    | 'declutterDiagnostic'
    | 'declutterOutput';

export type InputSource = 'manual' | 'xml';

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

// Preset receipt labels shown on OutputScreen for reimbursement receipts
export type ReceiptLabelPreset =
    | 'Transport'
    | 'Accommodation'
    | 'Fuel'
    | 'Medical Aid'
    | 'Other';

export interface AppState {
    mode: AppMode | null;
    step: AppStep;
    timeRange: TimeRange | null;
    smsText: string;
    cutoffDate: Date | null;
    inputSource: InputSource;
}

export interface ParsedTransaction {
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
    // Per-transaction label added on OutputScreen before downloading receipt
    receiptLabel: string | null;
    // Whether the user has toggled this transaction out of the receipt
    excludedFromReceipt: boolean;
}

// ---------------------------------------------------------------------------
// Gmail Declutter
// ---------------------------------------------------------------------------

export type GmailAge = 'under2' | '2to5' | '5plus';

export type GmailContent =
    | 'shopping'
    | 'newsletters'
    | 'social'
    | 'financial'
    | 'delivery'
    | 'calendar'
    | 'work'
    | 'apps';

export type GmailStorage = 'full' | 'somewhat' | 'fine';

export type GmailRuthlessness = 'light' | 'deep' | 'nuclear';

export type GmailKeepSafe = 'starred' | 'important' | 'primary';

export interface DeclutterAnswers {
    age: GmailAge | null;
    content: GmailContent[];
    storage: GmailStorage | null;
    ruthlessness: GmailRuthlessness | null;
    keepSafe: GmailKeepSafe[];
}

export interface DeclutterCommand {
    id: string;
    category: string;
    label: string;
    description: string;
    command: string;
    estimate: string;
    irreversible: boolean;
    included: boolean;
}