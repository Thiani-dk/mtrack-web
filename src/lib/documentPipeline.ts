import type { DocumentType } from '../types';

// The single gate that decides which documents feed the derived pipelines
// (insights and all-time aggregation). This is a correctness requirement, not
// a preference: money spent on a client's behalf is not the user's spending,
// and sales revenue is not spending either. Only the user's own records count.
//
// Used at every call site: deliverInsights (suppresses insights) and
// handleApprove (skips recordSession).
export function pipelineEligibility(documentType: DocumentType): {
    insights: boolean;
    aggregation: boolean;
} {
    const eligible = documentType === 'expense_summary' || documentType === 'personal_note';
    return { insights: eligible, aggregation: eligible };
}
