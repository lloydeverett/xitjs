// tokenize and tokenizeLine: where each piece of syntax is, for highlighting.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  parse, parseDescription, startLineState, tokenize, tokenizeLine, validate, type LineState, type Token,
} from '../src/index.ts';
import { anyDocument, anything, document, runs, xitDocument } from './arbitraries.ts';

/** A compact view of the tokens: `type:text`. */
function view(source: string): string[] {
  return tokenize(source).map((t) => `${t.type}:${source.slice(t.from, t.to)}`);
}

describe('tokenize', () => {
  test('an empty document has no tokens', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('\n\n'), []);
  });

  test('a title, and an item with a priority, a tag and a due date', () => {
    assert.deepEqual(view('Todos\n[x] !! Do #this -> 2022-01-31 now\n'), [
      'title:Todos',
      'checkbox:[x]', 'priority:!!', 'text:Do ', 'tag:#this', 'text: ', 'due-date:-> 2022-01-31', 'text: now',
    ]);
  });

  test("an item's tokens carry its status, and tags and due dates carry what they mean", () => {
    const tokens = tokenize('[@] ! a #t=v -> 2026-W45\n    b\n');
    for (const token of tokens) assert.equal('status' in token && token.status, 'ongoing', token.type);
    const tag = tokens.find((t) => t.type === 'tag');
    assert.deepEqual(tag?.type === 'tag' && tag.tag, { name: 't', value: 'v' });
    const due = tokens.find((t) => t.type === 'due-date');
    assert.equal(due?.type === 'due-date' && due.dueDate.date, '2026-11-08');
  });

  test("a continuation line's indentation is its own token, and any extra spaces are text", () => {
    assert.deepEqual(view('[ ] a\n    b #t\n       c\n'), [
      'checkbox:[ ]', 'text:a', 'indent:    ', 'text:b ', 'tag:#t', 'indent:    ', 'text:   c',
    ]);
  });

  test('the spaces after the checkbox and the priority belong to no token; any more are text', () => {
    assert.deepEqual(view('[ ] a\n[ ]   b\n[ ] !   c\n'), [
      'checkbox:[ ]', 'text:a', 'checkbox:[ ]', 'text:  b', 'checkbox:[ ]', 'priority:!', 'text:  c',
    ]);
  });

  test('items without a description, or with only a priority', () => {
    assert.deepEqual(view('[ ]\n[ ] \n[ ]   \n[ ] !\n[ ] .. \n'), [
      'checkbox:[ ]', 'checkbox:[ ]', 'checkbox:[ ]', 'text:  ', 'checkbox:[ ]', 'priority:!', 'checkbox:[ ]', 'priority:..',
    ]);
  });

  test('padded priorities count; misplaced and malformed ones are text', () => {
    assert.deepEqual(view('[ ] ..! a\n[ ] . !! b\n[ ]    ! c\n[ ] .!. d\n'), [
      'checkbox:[ ]', 'priority:..!', 'text:a',
      'checkbox:[ ]', 'priority:.', 'text:!! b',
      'checkbox:[ ]', 'text:   ! c',
      'checkbox:[ ]', 'text:.!. d',
    ]);
  });

  test('a blank line of whitespace is one token; an empty one has none', () => {
    assert.deepEqual(view('[ ] a\n\n \t\u00a0\nB\n'), ['checkbox:[ ]', 'text:a', 'blank: \t\u00a0', 'title:B']);
  });

  test('an invalid line is one token, with the reason', () => {
    const source = 'T\n  x\nU\n\n[*] a\n[ ]\n    d\n';
    assert.deepEqual(
      tokenize(source).filter((t) => t.type === 'invalid').map((t) => [source.slice(t.from, t.to), t.type === 'invalid' && t.code]),
      [
        ['  x', 'bad-indentation'],
        ['U', 'title-without-blank-line'],
        ['[*] a', 'invalid-checkbox'],
        ['    d', 'description-not-on-first-line'],
      ],
    );
  });

  test('only the first due date of an item counts, even on a later line', () => {
    assert.deepEqual(view('[ ] a -> 2022\n    b -> 2023\n[ ] c -> 2024\n'), [
      'checkbox:[ ]', 'text:a ', 'due-date:-> 2022', 'indent:    ', 'text:b -> 2023',
      'checkbox:[ ]', 'text:c ', 'due-date:-> 2024',
    ]);
  });

  test('a tag value never spans lines', () => {
    assert.deepEqual(view('[ ] #t="a\n    b"\n'), ['checkbox:[ ]', 'tag:#t=', 'text:"a', 'indent:    ', 'text:b"']);
  });

  test('offsets are into the source, past a byte-order mark and \\r\\n line endings', () => {
    const source = '\uFEFFT\r\n[ ] a\r\n';
    assert.deepEqual(tokenize(source).map((t) => [t.type, t.from, t.to]), [
      ['title', 1, 2], ['checkbox', 4, 7], ['text', 8, 9],
    ]);
  });
});

describe('tokenizeLine', () => {
  test('tokenizes one line, with offsets into it, and returns the state for the next', () => {
    let state = startLineState();
    const lines = ['Todos', '[ ] a', '    #b'];
    const out: string[][] = [];
    for (const text of lines) {
      const result = tokenizeLine(text, state);
      out.push(result.tokens.map((t) => `${t.type}:${t.from}-${t.to}`));
      state = result.state;
    }
    assert.deepEqual(out, [['title:0-5'], ['checkbox:0-3', 'text:4-5'], ['indent:0-4', 'tag:4-6']]);
  });

  test('a state is plain, frozen data, and tokenizing never changes it', () => {
    const state = startLineState();
    assert.ok(Object.isFrozen(state));
    const before = structuredClone(state);
    const { state: next } = tokenizeLine('[ ] a -> 2022', state);
    assert.deepEqual(state, before);
    assert.ok(Object.isFrozen(next));
    assert.deepEqual(structuredClone(next), next);
  });

  test('a blank line resets the state, so tokenizing can restart from any blank line', () => {
    for (const before of ['', 'Title', '[ ] a -> 2022', '[ ]', '    x', '[*]']) {
      let state: LineState = startLineState();
      for (const text of [before, '']) state = tokenizeLine(text, state).state;
      assert.deepEqual(state, startLineState(), JSON.stringify(before));
    }
  });
});

// Property tests -------------------------------------------------------------

/** The source split into lines as `parse` splits it, with where each starts. */
function lines(source: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  let start = bom;
  for (const match of source.slice(bom).matchAll(/\r?\n/g)) {
    out.push({ text: source.slice(start, bom + match.index), start });
    start = bom + match.index + match[0].length;
  }
  if (start < source.length) out.push({ text: source.slice(start), start });
  return out;
}

type Piece = { type: string; text: string };

/** What the tokens say each non-blank block is, in the same terms as `blockView`. */
function tokensView(source: string): unknown[] {
  const tokens = tokenize(source);
  const blocks: unknown[] = [];
  let item: { status: string; priority: number; pieces: Piece[] } | null = null;
  const flush = () => {
    if (item) blocks.push({ type: 'item', status: item.status, priority: item.priority, segments: merge(item.pieces) });
    item = null;
  };
  for (const { text, start } of lines(source)) {
    const own = tokens.filter((t) => t.from >= start && t.to <= start + text.length);
    const first = own[0];
    if (!first || first.type === 'blank') {
      flush();
    } else if (first.type === 'title' || first.type === 'invalid') {
      flush();
      blocks.push(first.type === 'title' ? { type: 'title', text } : { type: 'invalid', raw: text });
    } else if (first.type === 'checkbox') {
      flush();
      const priority = own.find((t) => t.type === 'priority');
      item = {
        status: first.status,
        priority: priority ? [...source.slice(priority.from, priority.to)].filter((c) => c === '!').length : 0,
        pieces: [],
      };
      for (const t of own) {
        assert.equal('status' in t && t.status, first.status, `${t.type} on an item line`);
        if (t.type !== 'checkbox' && t.type !== 'priority') item.pieces.push(piece(source, t));
      }
    } else {
      assert.equal(first.type, 'indent');
      assert.ok(item, 'a continuation line follows an item');
      for (const t of own) assert.equal('status' in t && t.status, item.status, `${t.type} on a continuation line`);
      item.pieces.push({ type: 'text', text: '\n' });
      for (const t of own.slice(1)) item.pieces.push(piece(source, t));
    }
  }
  flush();
  return blocks;
}

function piece(source: string, token: Token): Piece {
  return { type: token.type, text: source.slice(token.from, token.to) };
}

/** Joins neighbouring text pieces, as a description's segments are. */
function merge(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out.at(-1);
    if (p.type === 'text' && last?.type === 'text') last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** What `parse` says each non-blank block is. */
function blockView(source: string): unknown[] {
  return parse(source).blocks.filter((b) => b.type !== 'blank').map((b) =>
    b.type === 'item'
      ? {
        type: 'item', status: b.status, priority: b.priority,
        segments: parseDescription(b.description).segments.map((s) => ({ type: s.type, text: s.text })),
      }
      : b);
}

const sources = fc.oneof(xitDocument, xitDocument, document, anyDocument, anything);

describe('tokenize: properties', () => {
  test('tokens are in order, not empty, and cover every character but line endings, a BOM and separators', () => {
    fc.assert(fc.property(sources, (source) => {
      const tokens = tokenize(source);
      const covered = new Array<boolean>(source.length).fill(false);
      let end = 0;
      for (const token of tokens) {
        assert.ok(token.from >= end && token.to > token.from, `${token.type} ${token.from}-${token.to}`);
        for (let i = token.from; i < token.to; i++) covered[i] = true;
        end = token.to;
      }
      const ends = new Set(tokens.filter((t) => t.type === 'checkbox' || t.type === 'priority').map((t) => t.to));
      covered.forEach((isCovered, i) => {
        if (isCovered) return;
        const char = source[i];
        const ok = char === '\n' || (char === '\r' && source[i + 1] === '\n') || (i === 0 && char === '\uFEFF') ||
          (char === ' ' && ends.has(i));
        assert.ok(ok, `${JSON.stringify(char)} at ${i} in ${JSON.stringify(source)}`);
      });
    }), runs(2000));
  });

  test('tokens agree with parse: the same titles, invalid lines, items, tags and due dates', () => {
    fc.assert(fc.property(sources, (source) => {
      assert.deepEqual(tokensView(source), blockView(source));
    }), runs(2000));
  });

  test('invalid tokens are exactly where validate reports errors', () => {
    fc.assert(fc.property(sources, (source) => {
      const invalid = tokenize(source).flatMap((t) => (t.type === 'invalid' ? [[t.code, t.from, t.to]] : []));
      const errors = validate(source).filter((d) => d.severity === 'error').map((d) => [d.code, d.from, d.to]);
      assert.deepEqual(invalid, errors);
    }), runs(2000));
  });

  test('tokenizing line by line gives the same tokens, at the same places', () => {
    fc.assert(fc.property(sources, (source) => {
      let state = startLineState();
      const tokens: Token[] = [];
      for (const { text, start } of lines(source)) {
        const result = tokenizeLine(text, state);
        tokens.push(...result.tokens.map((t) => ({ ...t, from: t.from + start, to: t.to + start })));
        state = result.state;
      }
      assert.deepEqual(tokens, tokenize(source));
    }), runs(1000));
  });
});
