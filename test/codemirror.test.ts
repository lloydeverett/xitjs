// xitjs/codemirror: the tokenizer as a CodeMirror language.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { TreeFragment, type Tree } from '@lezer/common';
import { highlightTree, tagHighlighter, tags, type Highlighter } from '@lezer/highlight';
import { xit, xitLanguage, xitLanguageDescription, xitTags } from '../src/codemirror.ts';
import { tokenize, type Token } from '../src/index.ts';
import { runs, xitDocument } from './arbitraries.ts';

/** Every xit tag, as a class named after it. */
const byName = tagHighlighter(Object.entries(xitTags).map(([name, tag]) => ({ tag, class: name })));

/** The classes the language gives each character of `source` ('' for none). */
function classes(source: string, highlighter: Highlighter = byName, tree: Tree = xitLanguage.parser.parse(source)): string[] {
  const out = new Array<string>(source.length).fill('');
  highlightTree(tree, highlighter, (from, to, style) => {
    for (let i = from; i < to; i++) out[i] = style.split(' ').sort().join(' ');
  });
  return out;
}

/** The highlighted runs of `source`, as `text:classes`. */
function runsOf(source: string, highlighter?: Highlighter): string[] {
  const cls = classes(source, highlighter);
  const out: string[] = [];
  let start = 0;
  for (let i = 1; i <= source.length; i++) {
    if (i === source.length || cls[i] !== cls[start] || source[i] === '\n') {
      if (cls[start]) out.push(`${source.slice(start, i)}:${cls[start]}`);
      start = source[i] === '\n' ? i + 1 : i;
    }
  }
  return out;
}

describe('xitjs/codemirror', () => {
  test("highlights each piece, and every piece of an item with the item's status", () => {
    assert.deepEqual(runsOf('Todos\n[x] !! Call #mum -> 2026-W45\n    more\n[*] bad\n'), [
      'Todos:title',
      '[x]:checkbox checked',
      '!!:checked priority',
      'Call :checked',
      '#mum:checked tag',
      ' :checked',
      '-> 2026-W45:checked dueDate',
      'more:checked',
      '[*] bad:invalid',
    ]);
  });

  test('each status has its own tag', () => {
    assert.deepEqual(runsOf('[ ] a\n[@] b\n[~] c\n[?] d\n').filter((r) => !r.startsWith('[')), [
      'a:open', 'b:ongoing', 'c:obsolete', 'd:inQuestion',
    ]);
  });

  test('state carries across lines, and empty lines reset it', () => {
    assert.deepEqual(runsOf('A\n[ ] a\n\nB\n[ ] b -> 2022\n    c -> 2023\n'), [
      'A:title', '[ ]:checkbox open', 'a:open', 'B:title', '[ ]:checkbox open', 'b :open', '-> 2022:dueDate open',
      'c -> 2023:open',
    ]);
  });

  test('the tags derive from standard ones, so a theme that knows only those still highlights', () => {
    const standard = tagHighlighter([
      { tag: tags.heading, class: 'heading' },
      { tag: tags.atom, class: 'atom' },
      { tag: tags.keyword, class: 'keyword' },
      { tag: tags.labelName, class: 'label' },
      { tag: tags.literal, class: 'literal' },
      { tag: tags.invalid, class: 'invalid' },
    ]);
    assert.deepEqual(runsOf('T\n[ ] ! a #t -> 2022\n[*]\n', standard), [
      'T:heading', '[ ]:atom', '!:keyword', '#t:label', '-> 2022:literal', '[*]:invalid',
    ]);
  });

  test('a LanguageSupport, and a LanguageDescription for code blocks in markdown', () => {
    assert.equal(xit().language, xitLanguage);
    assert.equal(xitLanguage.name, 'xit');
    assert.ok(xitLanguageDescription.alias.includes('xit'));
    assert.ok(xitLanguageDescription.extensions.includes('xit'));
  });

  test('after an edit, re-parsing from the old tree gives the same as parsing afresh', () => {
    const edit = fc.record({ at: fc.nat(), remove: fc.nat({ max: 20 }), insert: xitDocument });
    fc.assert(fc.property(xitDocument, xitDocument, edit, (prefix, before, { at, remove, insert }) => {
      // A long prefix, so the parser has old chunks (and their states) to reuse.
      const old = prefix.repeat(20) + before;
      const from = Math.min(at, old.length);
      const to = Math.min(from + remove, old.length);
      const next = old.slice(0, from) + insert + old.slice(to);
      const fragments = TreeFragment.applyChanges(
        TreeFragment.addTree(xitLanguage.parser.parse(old)),
        [{ fromA: from, toA: to, fromB: from, toB: from + insert.length }],
      );
      const reparsed = xitLanguage.parser.parse(next, fragments);
      assert.deepEqual(classes(next, byName, reparsed), classes(next));
    }), runs(300));
  });

  test('highlighting agrees with tokenize, character by character', () => {
    const NAMES: Partial<Record<Token['type'], string>> = {
      title: 'title', checkbox: 'checkbox', priority: 'priority', tag: 'tag', 'due-date': 'dueDate', invalid: 'invalid',
    };
    const STATUS = { open: 'open', checked: 'checked', ongoing: 'ongoing', obsolete: 'obsolete', 'in-question': 'inQuestion' };
    fc.assert(fc.property(xitDocument, (source) => {
      const expected = new Array<string>(source.length).fill('');
      for (const token of tokenize(source)) {
        if (token.type === 'indent') continue;
        const names = [NAMES[token.type], 'status' in token ? STATUS[token.status] : undefined].filter(Boolean);
        for (let i = token.from; i < token.to; i++) expected[i] = names.sort().join(' ');
      }
      assert.deepEqual(classes(source), expected);
    }), runs(500));
  });
});
