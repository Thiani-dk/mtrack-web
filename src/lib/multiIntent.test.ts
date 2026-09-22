import { describe, expect, it } from 'vitest';
import { extractDescription, extractLineItems } from './conversationalCapture';
import { understoodNothing } from './zeroUnderstanding';
import { classifyIntent, segmentMultiIntent, type MetaIntent } from './metaIntent';
import { answerMetaQuestion, answerOrAdmit } from './metaAnswers';

const NOW = new Date('2026-09-12T09:00:00');
const intentOf = (clause: string): MetaIntent => {
    const e = extractDescription(clause, NOW);
    return classifyIntent({ text: clause, extraction: e, nothingExtracted: understoodNothing(e) });
};

describe('segmenting a message that says two things', () => {
    it('separates the data clause from the question clause', () => {
        const { data, questions } = segmentMultiIntent(
            'bought bacon for 3100, also can you tell me what currencies you support', intentOf);
        expect(data.map(d => d.text)).toEqual(['bought bacon for 3100']);
        expect(questions.map(q => q.text)).toEqual(['can you tell me what currencies you support']);
    });

    it('does not split an ordinary itemised message', () => {
        const { data, questions } = segmentMultiIntent('bacon and pork cuts for 3100', intentOf);
        expect(questions).toHaveLength(0);
        expect(data.map(d => d.text)).toEqual(['bacon and pork cuts for 3100']);
    });

    it('keeps two priced clauses as two line items in one document', () => {
        // "also" is a discourse boundary for intent, and a re-split boundary
        // for itemisation, so both halves land as their own line.
        const found = extractLineItems('i bought bacon for 3100 also bought milk for 80', { allowBare: true });
        expect(found?.items.map(i => i.amount)).toEqual([3100, 80]);
        expect(found?.total).toBe(3180);
    });
});

describe('answering a question about the system', () => {
    it('answers the ones it actually knows', () => {
        expect(answerMetaQuestion('what currencies do you support?')).toContain('Shillings');
        expect(answerMetaQuestion('how do I delete an item?')).toMatch(/scratch that|leave a line out/);
        expect(answerMetaQuestion('can I export a pdf?')).toContain('PDF');
    });

    it('admits the gap rather than improvising a capability', () => {
        expect(answerMetaQuestion('do you do tax returns?')).toBeNull();
        expect(answerOrAdmit('do you do tax returns?')).toContain("don't have a good answer");
    });

    it('keeps every answer short, since it is interrupting something', () => {
        for (const q of ['what currencies?', 'how do I delete an item?', 'how does this work?']) {
            const a = answerMetaQuestion(q);
            expect(a).toBeTruthy();
            expect((a ?? '').length).toBeLessThan(230);
        }
    });
});
