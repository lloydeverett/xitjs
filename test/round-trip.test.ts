// Writing back what was read: stringify(parse(s)) === s.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import {
  XitStringifyError, parse, stringify, updateItem, type Block, type Item,
} from '../src/index.ts';

const roundTrip = (source: string) => stringify(parse(source));

/** Hand-picked documents, each with something that's easy to lose. */
const CORPUS: Record<string, string> = {
  empty: '',
  'one newline': '\n',
  'only blank lines': '\n\n   \n\t\n',
  'blank lines of whitespace': '[ ] a\n  \n \n\t \n[ ] b\n',
  'several blank lines between groups': 'A\n[ ] a\n\n\n\nB\n[ ] b\n',
  'leading blank lines': '\n\nTitle\n[ ] a\n',
  'trailing blank lines': '[ ] a\n\n\n',
  'every status': '[ ] a\n[x] b\n[@] c\n[~] d\n[?] e\n',
  'priority padding': '[ ] ..! a\n[ ] !!. b\n[ ] ... c\n[ ] !!!!!!!!!! d\n[ ] . ! e\n',
  'priority without description': '[ ] !\n[ ] !! \n[ ] ..\n',
  'empty and space-only descriptions': '[ ]\n[ ] \n[ ]       \n[x]  \n',
  'trailing spaces': '[ ] a   \nTitle  \n',
  'extra spaces': '[ ]   a\n[ ] !   b\n    c   \n',
  continuations: '[ ] a\n    b\n       c\n    [ ] d\n    -> 2022-01-31 #t\n',
  'tags and due dates': '[ ] #a=1 #b="x y" #c=\'z\' #d= #e="unclosed -> 2022-Q4 -> 2023 (-> 2024/W01)\n',
  'invalid lines everywhere': ' x\n[*] y\n[ ]z\n[ ] ok\nnot a title\n   bad indent\n\tbad\n\n    orphan\n[Todos]\n',
  'titles and groups': 'Todos\n[ ] a\n[x] b\n\nEmpty group\n\nMore\n[@] c\n',
  'unicode text': '今日は\n[ ] 小包を受け取る #σκληρά\n[ ] 💼 #𠀀 -> 2022\n\nΕλληνικά\n[x] ☀️\n',
  'lone carriage returns': '[ ] a\rb\nTi\rtle\n',
  'non-breaking spaces': '[ ] x\n[ ] a\n    b\n',
  'warnings only': '[ ]    ! a\n[ ] .!. b\n[ ] -> 2022-13-01\n[ ] -> 2022 -> 2023\n',
  'a realistic file':
    'Groceries\n[ ] Milk #shop\n[x] ! Eggs -> 2026-11-04\n[@] Bread #shop=bakery\n    (the sourdough one)\n\n' +
    'Work\n[ ] !! Finish report -> 2026-W45 #work\n[~] Old task\n[?] Maybe? #idea="needs thought"\n\n' +
    '[ ] Ungrouped\n',
};

/** Every combination of line ending, final newline, and byte-order mark. */
function variants(source: string): string[] {
  const bodies = [source, source.replaceAll('\n', '\r\n')];
  const out = new Set<string>();
  for (const body of bodies) {
    const trimmed = body.replace(/\r?\n$/, '');
    for (const b of [body, trimmed]) {
      out.add(b);
      out.add(`\uFEFF${b}`);
    }
  }
  return [...out];
}

describe('round trip: corpus', () => {
  for (const [name, source] of Object.entries(CORPUS)) {
    test(name, () => {
      for (const variant of variants(source)) assert.equal(roundTrip(variant), variant, JSON.stringify(variant));
    });
  }
});

describe('round trip: syntax guide', () => {
  const { listings } = JSON.parse(
    readFileSync(new URL('./fixtures/syntax-guide.json', import.meta.url), 'utf8'),
  ) as { listings: Array<{ source: string }> };

  test('every listing, as a whole', () => {
    for (const { source } of listings) {
      for (const variant of variants(source)) assert.equal(roundTrip(variant), variant, JSON.stringify(variant));
    }
  });

  test('every line, on its own', () => {
    for (const { source } of listings) {
      for (const line of source.split('\n')) {
        for (const variant of variants(`${line}\n`)) assert.equal(roundTrip(variant), variant, JSON.stringify(variant));
      }
    }
  });

  test('all listings, as one file', () => {
    const all = listings.map((l) => l.source).join('\n');
    for (const variant of variants(all)) assert.equal(roundTrip(variant), variant);
  });
});

describe('round trip: mixed line endings', () => {
  test('are written with the first one, and then read back the same', () => {
    const doc = parse('[ ] a\r\n    b\n[ ] c\r\n\n');
    assert.equal(stringify(doc), '[ ] a\r\n    b\r\n[ ] c\r\n\r\n');
    assert.deepEqual(parse(stringify(doc)), doc);
  });
});

describe('round trip: editing', () => {
  const source = CORPUS['a realistic file']! + CORPUS['invalid lines everywhere']! + CORPUS['priority padding']!;

  /** The source lines that differ between two documents' text. */
  function changedLines(before: string, after: string): Array<[string | undefined, string | undefined]> {
    const a = before.split('\n');
    const b = after.split('\n');
    const changes: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changes.push([a[i], b[i]]);
    return changes;
  }

  test('changing one item rewrites only its lines', () => {
    const doc = parse(source);
    const index = doc.blocks.findIndex((b) => b.type === 'item' && b.description.startsWith('Bread'));
    const blocks = doc.blocks.with(index, updateItem(doc.blocks[index] as Item, { status: 'checked' }));
    assert.deepEqual(changedLines(source, stringify({ ...doc, blocks })), [
      ['[@] Bread #shop=bakery', '[x] Bread #shop=bakery'],
    ]);
  });

  test('spreading in a change works too, and other padded priorities are kept', () => {
    const doc = parse(source);
    const index = doc.blocks.findIndex((b) => b.type === 'item' && b.raw === '[ ] ..! a');
    const blocks = doc.blocks.with(index, { ...(doc.blocks[index] as Item), priority: 2 });
    assert.deepEqual(changedLines(source, stringify({ ...doc, blocks })), [['[ ] ..! a', '[ ] !! a']]);
  });

  test('removing and inserting items leaves every other line alone', () => {
    const doc = parse(source);
    const removed = doc.blocks.filter((b) => !(b.type === 'item' && b.description === 'Old task'));
    const out = stringify({ ...doc, blocks: removed });
    assert.equal(out, source.replace('[~] Old task\n', ''));

    const at = doc.blocks.findIndex((b) => b.type === 'item' && b.description === 'Old task');
    const inserted = doc.blocks.toSpliced(at, 0, updateItem(doc.blocks[at] as Item, { description: 'New task' }));
    assert.equal(stringify({ ...doc, blocks: inserted }), source.replace('[~] Old task\n', '[~] New task\n[~] Old task\n'));
  });
});

// Property tests -------------------------------------------------------------
// `pnpm test:fuzz` runs them many more times (XIT_FUZZ multiplies the runs).

const runs = (n: number) => ({ numRuns: n * Number(process.env.XIT_FUZZ ?? 1) });

/** Pieces of [x]it! syntax, plus whitespace and other characters that matter to it. */
const fragment = fc.constantFrom(
  '[ ]', '[x]', '[@]', '[~]', '[?]', '[', ']', '[X]', '[]', ' ', '    ', '\t', ' ', '\r',
  '!', '!!', '.', '..', '#', '#tag', '=', '"', "'", '->', '-> ', '2022', '-01', '/01', '-31', '-W01', '-Q2', 'W', 'Q',
  '-', '/', '(', ')', 'a', 'Title', 'é', '今', '🥳', '̈', '\uFEFF',
);
/** A line: any mix of fragments, but no line ending (and none hiding at its end). */
const line = fc.array(fragment, { maxLength: 12 }).map((parts) => parts.join('')).filter((l) => !l.endsWith('\r'));
const document = fc.record({
  lines: fc.array(line, { maxLength: 15 }),
  newline: fc.constantFrom('\n', '\r\n'),
  finalNewline: fc.boolean(),
  bom: fc.boolean(),
}).map(({ lines, newline, finalNewline, bom }) =>
  (bom ? '\uFEFF' : '') + lines.join(newline) + (finalNewline && lines.length > 0 ? newline : ''));

/** Any text at all, including lone surrogates, as lines joined by \n. */
const anyLine = fc.string({ unit: 'binary', maxLength: 40 }).map((s) => s.replace(/[\r\n]/g, ''));
const anyDocument = fc.array(anyLine, { maxLength: 10 }).map((lines) => lines.join('\n'));

/** Anything, including mixed and stray line endings. */
const anything = fc.string({ unit: fc.constantFrom('\n', '\r', '\r\n', ' ', '[ ]', '[x]', 'a', '!', '    ', '#t', '-> 2022'), maxLength: 30 });

/** Blocks without their `raw` formatting. */
const plain = (blocks: Block[]) => blocks.map((b) => {
  const { raw: _, ...rest } = b as Block & { raw?: string };
  return rest;
});

describe('round trip: properties', () => {
  test('xit-like documents are written back exactly', () => {
    fc.assert(fc.property(document, (source) => roundTrip(source) === source), runs(3000));
  });

  test('any text (with one kind of line ending) is written back exactly', () => {
    fc.assert(fc.property(anyDocument, (source) => roundTrip(source) === source), runs(1000));
  });

  test('whatever the input, what is written reads back as the same document, and writes the same again', () => {
    fc.assert(fc.property(anything, (source) => {
      let once: string;
      try {
        once = roundTrip(source);
      } catch (error) {
        // Only with mixed line endings: a line ending in \r, in a file written with \n.
        if (error instanceof XitStringifyError && /\r\r?\n/.test(source)) return;
        throw error;
      }
      assert.deepEqual(parse(once), parse(source));
      assert.equal(roundTrip(once), once);
    }), runs(2000));
  });

  test('a document built in code either reads back the same, or stringify refuses it', () => {
    const item = fc.record({
      type: fc.constant('item' as const),
      status: fc.constantFrom('open', 'checked', 'ongoing', 'obsolete', 'in-question'),
      priority: fc.nat({ max: 4 }),
      description: fc.array(line, { maxLength: 3 }).map((ls) => ls.join('\n')),
    });
    const block: fc.Arbitrary<Block> = fc.oneof(
      item.map((i) => updateItem({ ...i, tags: [], dueDate: null }, {})),
      fc.record({ type: fc.constant('title' as const), text: line }),
      fc.record({ type: fc.constant('blank' as const) }),
    );
    let written = 0;
    fc.assert(fc.property(fc.array(block, { maxLength: 8 }), (blocks) => {
      let text: string;
      try {
        text = stringify({ blocks });
      } catch (error) {
        if (error instanceof XitStringifyError) return;
        throw error;
      }
      written++;
      assert.deepEqual(plain(parse(text).blocks), plain(blocks));
    }), runs(3000));
    assert.ok(written > runs(3000).numRuns / 3, `only ${written} documents were writable`);
  });
});
