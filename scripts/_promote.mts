import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOGUE } from '../src/lib/conversation/scenarios';
import { runScenario, typesFor } from '../src/lib/conversation/harness';

const p = 'src/lib/conversation/scenarios.ts';
let src = readFileSync(p, 'utf8');
const promoted: string[] = [];
const regressed: string[] = [];
for (const s of CATALOGUE) {
    const passes = typesFor(s).every(t => runScenario(s, t).passed);
    if (passes && s.status === 'fail') {
        const block = new RegExp(`(id: '${s.id}',[\\s\\S]{0,400}?)status: 'fail',\\n(\\s*)note: (?:'[^']*'|\`[^\`]*\`),`, '');
        const before = src;
        src = src.replace(block, (_m, head: string) => `${head}status: 'pass',`);
        if (src !== before) promoted.push(s.id);
    }
    if (!passes && s.status === 'pass') regressed.push(s.id);
}
writeFileSync(p, src);
console.log('promoted:', promoted.join(' ') || '(none)');
console.log('REGRESSED:', regressed.join(' ') || '(none)');
