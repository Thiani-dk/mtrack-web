export type TimeRange = 'week' | 'month' | '3months' | '6months' | 'year';
export type AppMode = 'receipt' | 'ledger';
export type AppStep = 'home' | 'timeRange' | 'input' | 'output';

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

export interface AppState {
    mode: AppMode | null;
    step: AppStep;
    timeRange: TimeRange | null;
    smsText: string;
    cutoffDate: Date | null;
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
    rawLine: string;
}