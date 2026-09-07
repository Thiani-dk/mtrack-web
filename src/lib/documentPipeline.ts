import type { DocumentType } from '../types';

// Phase F2 — the single gate that decides which documents feed the derived
// pipelines. This is a correctness requirement, not a preference: money spent
// on a client's behalf is not the user's spending, and sales revenue is not
// spending either. Only the user's own records count.
//
// Used at every call site (Approve, deliverInsights) and asserted directly by
// pipelineIsolation.test.ts.
export function pipelineEligibility(documentType: DocumentType): {
    insights: boolean;
    badges: boolean;
    aggregation: boolean;
} {
    const eligible = documentType === 'expense_summary' || documentType === 'personal_note';
    return { insights: eligible, badges: eligible, aggregation: eligible };
}
