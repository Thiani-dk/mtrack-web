import type {
    ActiveModeState, DocumentType, MerchantProfile, OnBehalfOfContext, ParsedTransaction, TrackedDocument,
} from '../types';
import { reconcileDocument } from './documentModel';
import { generateReceiptNumber } from './dbUpgrade';

// Builds (or updates) the draft TrackedDocument that backs an in-progress
// conversational document. Its id is the chat session's id — one draft per
// session — so a resume can find it with getDocument(sessionId).
//
// dataSource and coveringFrom/coveringTo are always recomputed from the
// current transactions by reconcileDocument; callers never set them.
export function buildDraft(params: {
    sessionId: string;
    // Active Mode sessions set this once, at creation. Everything else leaves
    // it false and gets the ordinary chat-built document.
    capturedViaActiveMode?: boolean;
    // Active Mode's bucket list. Preserved across saves; omitted leaves
    // whatever the existing draft already had.
    activeMode?: ActiveModeState | null;
    documentType: DocumentType;
    merchantProfile: MerchantProfile | null;
    onBehalfOf: OnBehalfOfContext | null;
    transactions: ParsedTransaction[];
    existing?: TrackedDocument | null;
    now?: number;
    // point_of_sale only — set after the fact (like the day card's
    // stallName), never during capture. Omitted leaves whatever the existing
    // draft already had; only an explicit value (including '') changes it.
    servedBy?: string | null;
    tip?: number | null;
    discount?: number | null;
}): TrackedDocument {
    const now = params.now ?? Date.now();
    const base: TrackedDocument = params.existing ?? {
        id: params.sessionId,
        createdAt: now,
        updatedAt: now,
        status: 'draft',
        documentType: params.documentType,
        dataSource: 'sms_verified',
        transactions: [],
        merchantProfile: null,
        onBehalfOf: null,
        coveringFrom: null,
        coveringTo: null,
        capturedViaActiveMode: params.capturedViaActiveMode ?? false,
        activeMode: params.activeMode ?? null,
        // Generated once, from the id this document will always keep — see
        // generateReceiptNumber's own note on why this replaced a
        // clock-read-on-every-render reference.
        receiptNumber: generateReceiptNumber(params.sessionId, now),
        servedBy: null,
        tip: null,
        discount: null,
    };

    return reconcileDocument({
        ...base,
        // status is preserved from `existing` (a draft stays a draft until an
        // explicit Approve); a fresh doc starts as a draft.
        documentType: params.documentType,
        merchantProfile: params.merchantProfile,
        onBehalfOf: params.onBehalfOf,
        transactions: params.transactions,
        activeMode: params.activeMode !== undefined ? params.activeMode : base.activeMode,
        servedBy: params.servedBy !== undefined ? params.servedBy : base.servedBy,
        tip: params.tip !== undefined ? params.tip : base.tip,
        discount: params.discount !== undefined ? params.discount : base.discount,
    }, now);
}
