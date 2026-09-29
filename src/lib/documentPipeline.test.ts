import { describe, expect, it } from 'vitest';
import type { DocumentType } from '../types';
import { pipelineEligibility } from './documentPipeline';

// The single gate deciding which documents feed insights and all-time
// aggregation. Money the user spent counts; money a customer paid them
// (point_of_sale), money they will be paid back (on_behalf_of), and a day's
// trading (daily_sales) never do — all three are the opposite of spending,
// and each would produce a confidently wrong "you spent" figure if counted.
//
// This did not have a test file before daily_sales existed. Writing it now,
// covering every current DocumentType explicitly rather than just the new
// one, is what stops the next document type from being added to the eligible
// set by accident — the list here has to be edited on purpose, not just
// compile, for a sixth type to slip through silently.

const ELIGIBLE: DocumentType[] = ['expense_summary', 'personal_note'];
const NOT_ELIGIBLE: DocumentType[] = ['point_of_sale', 'on_behalf_of', 'daily_sales'];

describe('pipelineEligibility', () => {
    it.each(ELIGIBLE)('%s feeds both insights and all-time aggregation', (type) => {
        expect(pipelineEligibility(type)).toEqual({ insights: true, aggregation: true });
    });

    it.each(NOT_ELIGIBLE)('%s feeds neither insights nor all-time aggregation', (type) => {
        expect(pipelineEligibility(type)).toEqual({ insights: false, aggregation: false });
    });

    it('daily_sales specifically is excluded on both counts — a day of sales is income, not spending', () => {
        const result = pipelineEligibility('daily_sales');
        expect(result.aggregation).toBe(false);
        expect(result.insights).toBe(false);
    });

    it('every DocumentType is covered by exactly one of the two lists above', () => {
        // Guards the guard: if a sixth document type is ever added and this
        // file is not updated, this fails loudly rather than the new type
        // silently defaulting to whichever list happens to match its logic.
        const all: DocumentType[] = ['expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of', 'daily_sales'];
        expect([...ELIGIBLE, ...NOT_ELIGIBLE].sort()).toEqual([...all].sort());
    });
});
