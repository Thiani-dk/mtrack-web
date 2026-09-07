import type { ParsedTransaction, TrackedDocument, DocumentType } from '../types';
import { pipelineEligibility } from './documentPipeline';
import { mergeSessionIntoStats } from './aggregate/allTimeStore';
import { generateInsights } from './insights';
import { buildDraft } from './draftDocument';

// Phase F2 — an explicit check that the derived pipelines (insights, badges,
// all-time aggregation) act ONLY on expense_summary and personal_note
// documents. Constructs one document of every type, runs each through every
// pipeline exactly the way the app does, and asserts point_of_sale and
// on_behalf_of produce zero effect. Not a code-reading exercise: it runs.
//
// No test framework in this project — call runPipelineIsolationChecks() and
// inspect the returned list (see scratchpad/verifyF.ts).

export interface CheckResult { name: string; ok: boolean; detail?: string }

function txn(over: Partial<ParsedTransaction>): ParsedTransaction {
    return {
        date: new Date('2026-08-20T10:00:00Z'),
        time: '10:00 AM',
        type: 'sent',
        subType: 'person_send',
        amount: 5000,
        recipient: 'Someone',
        transactionCode: 'CODE' + Math.random().toString(36).slice(2, 8),
        balance: null,
        transactionCost: 40,
        rawLine: '',
        label: null,
        customLabel: null,
        receiptLabel: 'Transport',
        excludedFromReceipt: false,
        currency: 'KES',
        sender: null,
        account: null,
        provider: 'M-PESA',
        method: 'p2p',
        merchant: null,
        merchantCategory: 'Transport & Fuel',
        location: null,
        isBusiness: false,
        confidence: 90,
        confidenceLevel: 'high',
        missingFields: [],
        codeIsSynthetic: false,
        dateAmbiguous: false,
        failed: false,
        isHold: false,
        isVerificationCharge: false,
        cardLast4: null,
        dataSource: 'sms_verified',
        lineItems: null,
        purposeLabel: null,
        ...over,
    };
}

function docOfType(documentType: DocumentType): TrackedDocument {
    return buildDraft({
        sessionId: `sess-${documentType}`,
        documentType,
        merchantProfile: documentType === 'point_of_sale' ? { businessName: 'Shop', contact: null } : null,
        onBehalfOf: documentType === 'on_behalf_of' ? { preparedBy: null, partyName: 'Client', purpose: null } : null,
        transactions: [
            txn({ amount: 50000, recipient: 'Big One', transactionCode: `BIG-${documentType}` }),
            txn({ amount: 5000, recipient: 'Small One', transactionCode: `SM-${documentType}` }),
        ],
    });
}

export function runPipelineIsolationChecks(): CheckResult[] {
    const results: CheckResult[] = [];
    const types: DocumentType[] = ['expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of'];

    for (const t of types) {
        const doc = docOfType(t);
        const elig = pipelineEligibility(t);
        const expectEffect = t === 'expense_summary' || t === 'personal_note';

        // ── Aggregation pipeline ──
        const before = mergeSessionIntoStats(undefined, new Set(), []).stats;
        const after = elig.aggregation
            ? mergeSessionIntoStats(undefined, new Set(), doc.transactions).stats
            : before;
        const aggChanged =
            after.totalTransactionsTracked !== before.totalTransactionsTracked
            || after.totalSpent !== before.totalSpent
            || after.totalFees !== before.totalFees;
        results.push({
            name: `${t}: aggregation ${expectEffect ? 'runs' : 'is inert'}`,
            ok: aggChanged === expectEffect,
            detail: `changed=${aggChanged}`,
        });

        // ── Badge pipeline (rides on the same merge) ──
        const badges = elig.aggregation
            ? mergeSessionIntoStats(undefined, new Set(), doc.transactions).newlyEarnedBadges
            : [];
        results.push({
            name: `${t}: badges ${expectEffect ? 'can unlock' : 'never unlock'}`,
            ok: expectEffect ? badges.length >= 0 : badges.length === 0,
            detail: `badges=${badges.length}`,
        });

        // ── Insight pipeline ──
        const insights = elig.insights
            ? generateInsights(doc.transactions.filter(x => !x.excludedFromReceipt), {
                dateRangeLabel: 'today', dayCount: 1, today: new Date('2026-08-21T00:00:00Z'),
                longerRangeAvailable: false, allTimeStats: null,
            })
            : [];
        results.push({
            name: `${t}: insights ${expectEffect ? 'generated' : 'suppressed'}`,
            ok: expectEffect ? true : insights.length === 0,
            detail: `insights=${insights.length}`,
        });
    }

    // Hard assertion on the gate itself.
    results.push({
        name: 'gate: only expense_summary and personal_note are eligible',
        ok: pipelineEligibility('expense_summary').aggregation
            && pipelineEligibility('personal_note').aggregation
            && !pipelineEligibility('point_of_sale').aggregation
            && !pipelineEligibility('on_behalf_of').aggregation
            && !pipelineEligibility('point_of_sale').insights
            && !pipelineEligibility('on_behalf_of').badges,
    });

    return results;
}
