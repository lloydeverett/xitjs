// Checks the built package (run by `pnpm test:dist`, after `pnpm build`): it
// loads through its own `exports`, works, and imports nothing from Node.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as xit from 'xitjs';

const source = 'Todos\n[ ] ..! a #t -> 2026-W45\n    more\n\n[x] b\n';
assert.equal(xit.stringify(xit.parse(source)), source);
assert.equal(xit.getItems(xit.parse(source))[0].dueDate.date, '2026-11-08');

const dist = new URL('../dist/', import.meta.url);
for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(new URL(file, dist), 'utf8');
  for (const [, specifier] of code.matchAll(/from\s+'([^']+)'/g)) {
    assert.ok(specifier.startsWith('./') && specifier.endsWith('.js'), `${file} imports ${specifier}`);
  }
}
console.log('dist ok');
