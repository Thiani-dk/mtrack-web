import { describe, expect, it } from 'vitest';
import type { DocumentType } from '../types';
import { composeDescription, composeDraftAnswer, emptyCaptureDraft, type CaptureDraft } from './captureDraft';
import { composeSlotQuestion, openSlots } from './conversationalCapture';
import { partyQuestion } from './partyQuestion';
import { EXTRACTION_SHAPES, type ExtractionShape, type ShapeCase } from './extractionShapes.fixtures';

// Every known extraction shape, through every document type.
//
// Written as a loop over the fixture file rather than as per-mode tests on
// purpose: each of these bugs was fixed in the one mode it was reported in and
// then found again, months later, in another. A shape added to
// extractionShapes.fixtures.ts is tested in all four modes from that moment,
// with no test written for it.
//
// The composition below is the production one — composeDescription,
// openSlots, composeSlotQuestion and partyQuestion are the same functions
// ChatScreen's askNextField calls, in the same order. A hand-written model of
// the flow is how thirty green tests once co-existed with a broken flow.

const NOW = new Date('2026-09-12T09:00:00');

const TYPES: readonly DocumentType[] = [
    'expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of',
];

// What the flow would ask next, word for word. Mirrors askNextField.
function nextQuestion(draft: CaptureDraft, documentType: DocumentType): string | null {
    return composeSlotQuestion(openSlots(draft), {
        date: 'When was that?',
        amount: 'How much was it?',
        description: partyQuestion(documentType, 1),
    }, documentType)?.text ?? null;
}

function run(shape: ExtractionShape, documentType: DocumentType): {
    expected: ShapeCase; draft: CaptureDraft; settled: CaptureDraft; asked: string | null;
} {
    const expected = shape.byType[documentType];
    const draft = composeDescription(emptyCaptureDraft(), expected.message, NOW).draft;
    // The date is the one slot these messages are allowed to leave open, so it
    // is answered before asking what is still missing. A shape that dates
    // itself is already settled.
    const settled = shape.datedInMessage
        ? draft
        : composeDraftAnswer(draft, 'date', 'yesterday', NOW).draft;
    return { expected, draft, settled, asked: nextQuestion(settled, documentType) };
}

describe.each(EXTRACTION_SHAPES.map(s => [s.name, s] as const))('%s', (_name, shape) => {
    describe.each(TYPES)('%s', documentType => {
        it('reads the total the message states', () => {
            const { expected, draft } = run(shape, documentType);
            expect(draft.amount).toBe(expected.amount ?? shape.amount);
        });

        it('keeps what the message said was bought', () => {
            const { expected, draft } = run(shape, documentType);
            expect(draft.recipient).toBe(expected.description);
        });

        it('itemises exactly when the message is a list of priced things', () => {
            const { expected, draft } = run(shape, documentType);
            const items = expected.items !== undefined ? expected.items : shape.items;
            expect(draft.lineItems?.map(i => i.description) ?? null).toEqual(items);
        });

        if (shape.currency) {
            it('keeps the currency the message named', () => {
                const { draft } = run(shape, documentType);
                expect(draft.currency).toEqual({ code: shape.currency, explicit: true });
            });
        }

        if (shape.datedInMessage) {
            it('takes the date from the message itself', () => {
                const { draft } = run(shape, documentType);
                expect(draft.date).not.toBeNull();
            });
        }

        // The one that matters. Every bug in this file was visible to the user
        // as a question asked about something they had already said.
        it('asks nothing further once the date is settled', () => {
            const { asked } = run(shape, documentType);
            expect(asked).toBeNull();
        });
    });
});

describe('the harness itself', () => {
    it('covers every document type for every shape', () => {
        for (const shape of EXTRACTION_SHAPES) {
            expect(Object.keys(shape.byType).sort()).toEqual([...TYPES].sort());
        }
    });

    it('carries every shape that has broken extraction so far', () => {
        // A deletion from the fixture file is a shape stopping being tested
        // everywhere, which is exactly how this class of bug kept returning.
        expect(EXTRACTION_SHAPES).toHaveLength(6);
    });
});
