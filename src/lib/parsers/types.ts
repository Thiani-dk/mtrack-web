import type { ParsedTransaction, TransactionSubType } from '../../types';

export type { ParsedTransaction, TransactionSubType };

export interface AmountResult {
    amount: number;
    currency: string;
    confidence: number;
}

export interface DateResult {
    date: Date;
    ambiguous: boolean;
}

export interface CodeResult {
    code: string;
    synthetic: boolean;
    label: string;
}

export interface PartiesResult {
    sender: string | null;
    recipient: string | null;
    account: string | null;
}

export interface DirectionResult {
    type: 'sent' | 'received';
    confidence: number;
}

export interface ChannelResult {
    provider: string;
    method: string;
    confidence: number;
}

export interface MerchantResult {
    name: string;
    category: string | null;
    isBusiness: boolean;
    location: string | null;
}

export interface ConfidenceResult {
    score: number;
    missing: string[];
    level: 'high' | 'medium' | 'low';
}

export interface ParseStats {
    totalBlocks: number;
    parsed: number;
    rejected: number;
    duplicatesRemoved: number;
    byProvider: Record<string, number>;
    byMethod: Record<string, number>;
    byConfidence: { high: number; medium: number; low: number };
    ambiguousDates: number;
    syntheticCodes: number;
    holds: number;
    failed: number;
    unparsedSamples: string[];
}
