import { CATALOGUE } from '../src/lib/conversation/scenarios';
import { runScenario, typesFor } from '../src/lib/conversation/harness';
const want = process.argv.slice(2);
for (const s of CATALOGUE) {
    if (want.length && !want.includes(s.id)) continue;
    for (const t of typesFor(s)) {
        const o = runScenario(s, t);
        console.log(`\n== ${s.id} (${t}) ${o.passed ? 'PASS' : 'FAIL'} [recorded: ${s.status}]`);
        for (const st of o.steps) {
            console.log(`  > ${st.record.tapped ? '[tap] ' : ''}${st.record.user}`);
            for (const turn of st.record.turns) {
                console.log(`    M: ${turn.text}${turn.options ? '  {' + turn.options.map(x => x.value).join('|') + '}' : ''}   [${turn.copyId}]`);
            }
            for (const f of st.failures) console.log(`    !! ${f}`);
        }
    }
}
