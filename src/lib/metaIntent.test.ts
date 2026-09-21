import { describe, expect, it } from 'vitest';
import { extractDescription } from './conversationalCapture';
import { understoodNothing } from './zeroUnderstanding';
import { classifyIntent, decideCancel, splitDiscourse, type MetaIntent } from './metaIntent';

const NOW = new Date('2026-09-12T09:00:00');

function intentOf(text: string): MetaIntent {
    const extraction = extractDescription(text, NOW);
    return classifyIntent({ text, extraction, nothingExtracted: understoodNothing(extraction) });
}

describe('cancel', () => {
    it('recognises the short closed list, as a whole message', () => {
        for (const t of ['never mind', 'nevermind', 'forget it', 'cancel', 'cancel this',
            'stop', 'start over', 'quit', 'Never mind.']) {
            expect(intentOf(t)).toBe('cancel');
        }
    });

    it('never fires on those words inside a longer sentence', () => {
        // Scrapping a half-built document over a substring match would be
        // unforgivable, so the match is against the whole message.
        expect(intentOf("I'll never mind the change")).not.toBe('cancel');
        expect(intentOf('bought a stop sign for 400, cancel culture book for 900')).not.toBe('cancel');
    });

    it('catches a cancel that arrives wearing a correction marker', () => {
        expect(intentOf("actually cancel this, I don't want to log it")).toBe('cancel');
    });

    it('skips the confirmation when there is nothing to lose', () => {
        expect(decideCancel({ summary: null }).kind).toBe('immediate');
    });

    it('asks before discarding real progress, with both options', () => {
        const d = decideCancel({ summary: 'bacon and pork cuts (3,100)' });
        expect(d.kind).toBe('confirm');
        expect(d.text).toContain('bacon and pork cuts');
        expect(d.options?.map(o => o.value)).toEqual(['discard', 'keep']);
    });
});

describe('correction', () => {
    it('recognises the markers wherever they sit', () => {
        for (const t of ['actually it was 3500', 'no wait, 3500', 'I meant 3500',
            'sorry, it was 3500', 'scratch that', 'make that 3500',
            'oh also the bacon was actually 3500 not 3000']) {
            expect(intentOf(t)).toBe('correction');
        }
    });

    it('beats multi-intent, so a correction is never filed as a second item', () => {
        expect(intentOf('oh also the bacon was actually 3500')).toBe('correction');
    });
});

describe('meta-question', () => {
    it('recognises a question about the system', () => {
        for (const t of ['what currencies do you support?', 'how do I delete an item?',
            'can you handle USD?', 'how does this work?']) {
            expect(intentOf(t)).toBe('meta_question');
        }
    });

    it('is not triggered by a question that carries real content', () => {
        expect(intentOf('did I say 3100? actually it was 3500')).toBe('correction');
        expect(intentOf('bought bacon for 3100, right?')).not.toBe('meta_question');
    });
});

describe('multi-intent', () => {
    it('splits on a discourse boundary, not on a bare "and"', () => {
        expect(splitDiscourse('bought bacon for 3100, also can you tell me what currencies you support'))
            .toEqual(['bought bacon for 3100', 'can you tell me what currencies you support']);
        // The line-item extractor depends on "and" NOT being a discourse
        // boundary: "bacon and pork cuts for 3100" is one item list.
        expect(splitDiscourse('bacon and pork cuts for 3100')).toEqual(['bacon and pork cuts for 3100']);
    });

    it('classifies a data clause plus a question clause as multi-intent', () => {
        expect(intentOf('bought bacon for 3100, also can you tell me what currencies you support'))
            .toBe('multi_intent');
    });
});

describe('data and unclear', () => {
    it('routes ordinary descriptions to the extraction pipeline', () => {
        expect(intentOf('bought bacon for 3100')).toBe('data');
        expect(intentOf('bought bacon')).toBe('data');
        expect(intentOf('3100')).toBe('data');
    });

    it('reports genuinely unreadable text as unclear', () => {
        expect(intentOf('zxcv qwer asdf')).toBe('unclear');
        expect(intentOf('hello there')).toBe('unclear');
    });
});
