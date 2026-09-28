import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './scenarios';
import { runScenario, typesFor } from './harness';

// Every charted conversation path, through the production engine, in every
// document type it applies to.
//
// A scenario's `status` is its contract with this suite:
//
//   pass    — it works today and must keep working
//   fail    — it does NOT work today, and the suite asserts it still doesn't,
//             so the day the behaviour lands this test says "promote me"
//   blocked — three genuine fix attempts failed; the diagnosis is in the
//             scoreboard and the suite does not assert either way
//   decision— waiting on the owner; see DECISIONS.md
//
// That is how CI stays green without hiding a single known gap. A scenario may
// never be moved to 'pass' by loosening its assertions; see the scoreboard,
// where any change to an expectation needs a written reason.

describe('the scenario catalogue', () => {
    it('gives every non-passing scenario a written note', () => {
        const undocumented = CATALOGUE
            .filter(s => s.status !== 'pass' && !s.note)
            .map(s => s.id);
        expect(undocumented).toEqual([]);
    });

    it('has no duplicate ids', () => {
        const ids = CATALOGUE.map(s => s.id);
        expect(ids.length).toBe(new Set(ids).size);
    });
});

for (const scenario of CATALOGUE) {
    for (const documentType of typesFor(scenario)) {
        const name = `${scenario.id} (${documentType}) ${scenario.title}`;

        if (scenario.status === 'blocked' || scenario.status === 'decision') {
            it.skip(name, () => {});
            continue;
        }

        it(name, () => {
            const outcome = runScenario(scenario, documentType);
            const failures = outcome.steps.flatMap((s, i) =>
                s.failures.map(f => `step ${i + 1} (${s.step.tap !== undefined ? `tap ${s.step.tap}` : `"${s.step.send}"`}): ${f}`));

            if (scenario.status === 'pass') {
                expect(failures, `${name}\n${failures.join('\n')}`).toEqual([]);
            } else {
                // A known failure. If this ever comes back empty the behaviour
                // has landed and the scenario should be promoted to 'pass'.
                expect(
                    failures.length,
                    `${name} is marked 'fail' but now passes. Promote it to 'pass' in scenarios.ts.`,
                ).toBeGreaterThan(0);
            }
        });
    }
}
