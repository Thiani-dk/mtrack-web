import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_COPY_IDS, COPY, copyEntry, type CopyKind } from './copy';
import { CATALOGUE } from './scenarios';

// The voice, enforced.
//
// VOICE.md is the prose version of this file. Anything in it that could be
// checked mechanically is checked here, because a style guide nobody can fail
// is a style guide nobody follows.

// Longest a message of each kind may be. Drawn from what the persona is for:
// an acknowledgement is one clause, a question is one sentence plus at most a
// short second, help is allowed three sentences because it is answering
// something, and a confirmation is as long as the thing being confirmed.
const LIMIT: Record<CopyKind, number> = {
    question: 165,
    acknowledgement: 120,
    confirmation: 260,
    help: 210,
    redirect: 200,
    terminal: 160,
    statement: 210,
    option: 60,
};

// Words that belong to a system talking to itself.
const BANNED = [
    'transaction processed', 'invalid input', 'invalid', 'parsed', 'parse',
    'entity', 'slot', 'query', 'field is required', 'processing', 'unsupported',
    'null', 'undefined', 'error occurred',
];

const EM_DASH = /[—–]/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}☀-➿]/u;
// A template whose last meaningful token is a placeholder carries its ending in
// whatever is substituted in. Those are checked where they are rendered, by the
// harness's endsWithNextStep, not here.
const ENDS_IN_PLACEHOLDER = /\{\w+\}[.\s]*$/;

describe('every registry entry', () => {
    for (const id of ALL_COPY_IDS) {
        const entry = copyEntry(id);
        for (const [i, variant] of entry.variants.entries()) {
            const label = `${id}${entry.variants.length > 1 ? ` [${i}]` : ''}`;

            it(`${label} uses no em dash`, () => {
                expect(EM_DASH.test(variant), `"${variant}"`).toBe(false);
            });

            it(`${label} uses no emoji`, () => {
                expect(EMOJI.test(variant), `"${variant}"`).toBe(false);
            });

            it(`${label} does not shout`, () => {
                expect((variant.match(/!/g) ?? []).length, `"${variant}"`).toBeLessThan(2);
            });

            it(`${label} avoids jargon`, () => {
                const found = BANNED.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(variant));
                expect(found, `"${variant}"`).toEqual([]);
            });

            it(`${label} is within the ${entry.kind} length limit`, () => {
                expect(variant.length, `"${variant}"`).toBeLessThanOrEqual(LIMIT[entry.kind]);
            });

            it(`${label} is sentence case, not Title Case`, () => {
                // Three or more capitalised words in a row is a heading, not a
                // sentence. Known proper nouns are exempt.
                const stripped = variant
                    .replace(/M-?Pesa|M-PESA|Java House|Naivas|KPLC|Airtel Money|Kenyan Shillings|Approve|Paste|Save as PDF|Active Mode/g, '');
                expect(/(?:\b[A-Z][a-z]+\b[ ]){2}\b[A-Z][a-z]+\b/.test(stripped), `"${variant}"`).toBe(false);
            });

            if (entry.kind === 'question') {
                it(`${label} actually ends in a question`, () => {
                    const ok = /\?\s*$/.test(variant) || ENDS_IN_PLACEHOLDER.test(variant);
                    expect(ok, `a question-kind entry must end with "?" or with a placeholder that does: "${variant}"`)
                        .toBe(true);
                });
            }
        }
    }
});

// ── Ids in code, and ids in the registry ────────────────────────────────────

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sourceFiles(full, acc);
        else if (/\.tsx?$/.test(name)) acc.push(full);
    }
    return acc;
}

const SOURCES = sourceFiles('src').filter(f => !f.endsWith('copy.ts'));
const PRODUCTION = SOURCES
    .filter(f => !f.includes('.test.') && !f.endsWith('scenarios.ts') && !f.endsWith('harness.ts'))
    .map(f => readFileSync(f, 'utf8'))
    .join('\n');

describe('the registry and the code agree', () => {
    it('has no entry nothing ever says', () => {
        // An id counts as used if production code names it. Partial ids built
        // from a document type (ask.party.*, follow.party.*, placeholder.party.*)
        // are matched by their prefix.
        const templated = /^(?:ask\.party|follow\.party|placeholder\.party)\./;
        const unused = ALL_COPY_IDS.filter(id => {
            if (templated.test(id)) {
                const prefix = id.slice(0, id.lastIndexOf('.'));
                return !PRODUCTION.includes(`${prefix}.`) && !PRODUCTION.includes(`\`${prefix}.`);
            }
            return !PRODUCTION.includes(`'${id}'`) && !PRODUCTION.includes(`"${id}"`);
        });
        expect(unused).toEqual([]);
    });

    it('holds every id production code asks for', () => {
        const namespaces = new Set(ALL_COPY_IDS.map(id => id.split('.')[0]));
        const missing = new Set<string>();
        for (const m of PRODUCTION.matchAll(/'([a-z][a-zA-Z]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,2})'/g)) {
            const id = m[1];
            if (namespaces.has(id.split('.')[0]) && !(id in COPY)) missing.add(id);
        }
        expect([...missing]).toEqual([]);
    });

    // A scenario is allowed to name an entry that does not exist yet, because
    // the catalogue is a floor for behaviour still to be built. A scenario
    // marked PASSING is not: if it passes, the entry it asserts on was said,
    // so it must be in the registry.
    it('holds every id a passing scenario asserts on', () => {
        const source = readFileSync('src/lib/conversation/scenarios.ts', 'utf8');
        const blocks = source.split(/\n {4}\{\n/).slice(1);
        const statusById = new Map(CATALOGUE.map(s => [s.id, s.status]));
        const missing: string[] = [];
        for (const block of blocks) {
            const idMatch = block.match(/id: '([^']+)'/);
            if (!idMatch || statusById.get(idMatch[1]) !== 'pass') continue;
            for (const m of block.matchAll(/\bused\(([^)]*)\)/g)) {
                for (const q of m[1].matchAll(/'([^']+)'/g)) {
                    if (!(q[1] in COPY)) missing.push(`${idMatch[1]} -> ${q[1]}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
