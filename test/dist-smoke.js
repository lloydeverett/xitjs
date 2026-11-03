// Checks the built package (run by `pnpm test:dist`, after `pnpm build`): it
// loads through its own `exports`, works, and imports nothing from Node.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as xit from 'xitjs';

const source = 'Todos\n[ ] ..! a #t -> 2026-W45\n    more\n\n[x] b\n';
assert.equal(xit.stringify(xit.parse(source)), source);
assert.equal(xit.getItems(xit.parse(source))[0].dueDate.date, '2026-11-08');
assert.deepEqual(xit.tokenize(source).map((t) => t.type).slice(0, 4), ['title', 'checkbox', 'priority', 'text']);

const codemirror = await import('xitjs/codemirror');
assert.equal(codemirror.xit().language, codemirror.xitLanguage);

// Only xitjs/codemirror imports anything outside the package (its peer
// dependencies), and nothing the main entry loads imports it.
const PEERS = ['@codemirror/language', '@lezer/highlight'];
const dist = new URL('../dist/', import.meta.url);
for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(new URL(file, dist), 'utf8');
  for (const [, specifier] of code.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)) {
    const ok = (specifier.startsWith('./') && specifier.endsWith('.js') && specifier !== './codemirror.js') ||
      (file === 'codemirror.js' && PEERS.includes(specifier));
    assert.ok(ok, `${file} imports ${specifier}`);
  }
}
console.log('dist ok');
