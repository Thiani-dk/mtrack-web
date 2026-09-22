import { describe, expect, it } from 'vitest';
import type { DocumentType } from '../types';
import { partyQuestion, partyPlaceholder } from './partyQuestion';

const TYPES: DocumentType[] = ['expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of'];

describe('the party/recipient question', () => {
    it('is worded for the document being written', () => {
        expect(partyQuestion('expense_summary', 1)).toBe('Who was it paid to?');
        expect(partyQuestion('personal_note', 1)).toBe('Who was it paid to?');
        expect(partyQuestion('point_of_sale', 1)).toBe('What did they buy?');
        // A claim is money spent for someone else, not a payment to them.
        expect(partyQuestion('on_behalf_of', 1)).toBe('Where was this spent?');
    });

    it('never asks a claim who it was "paid to" — that is the other question', () => {
        for (let n = 1; n <= 6; n++) {
            expect(partyQuestion('on_behalf_of', n)).not.toContain('paid to');
            expect(partyQuestion('on_behalf_of', n)).not.toBe('Who was this for?');
        }
    });

    it('does not repeat itself verbatim on the next transaction', () => {
        for (const type of TYPES) {
            expect(partyQuestion(type, 2)).not.toBe(partyQuestion(type, 1));
        }
    });

    it('is the same words for the same transaction, so a resumed question can be put back exactly', () => {
        for (const type of TYPES) {
            expect(partyQuestion(type, 3)).toBe(partyQuestion(type, 3));
        }
    });

    it('is a real question for every type, however many have come before', () => {
        for (const type of TYPES) {
            for (let n = 0; n <= 8; n++) {
                expect(partyQuestion(type, n).endsWith('?')).toBe(true);
            }
        }
    });

    it('has a placeholder in the same voice', () => {
        expect(partyPlaceholder('point_of_sale')).toBe('What they bought...');
        expect(partyPlaceholder('on_behalf_of')).toBe('Where it was spent...');
        expect(partyPlaceholder('expense_summary')).toBe('Who it was paid to...');
    });
});
