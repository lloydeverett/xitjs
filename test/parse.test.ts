import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { XitParseError, parse, validate, type Block, type Diagnostic, type DiagnosticCode } from '../src/index.ts';

const kinds = (source: string) => parse(source).blocks.map((b) => b.type);
const codes = (source: string) => validate(source).map((d) => d.code);
const errorCodes = (source: string) =>
  validate(source).filter((d) => d.severity === 'error').map((d) => d.code);

describe('parse: blocks', () => {
  test('an empty source is an empty document', () => {
    // With no lines, there's no final newline to be missing, so content added later gets one.
    assert.deepEqual(parse(''), { blocks: [], newline: '\n', finalNewline: true, bom: false });
  });

  test('titles, items and blank lines', () => {
    const doc = parse('Groceries\n[ ] Milk\n[x] ! Eggs #shop -> 2022-01-31\n\n[@] Other\n');
    assert.deepEqual(doc, {
      newline: '\n',
      finalNewline: true,
      bom: false,
      blocks: [
        { type: 'title', text: 'Groceries' },
        { type: 'item', status: 'open', priority: 0, description: 'Milk', tags: [], dueDate: null, raw: '[ ] Milk' },
        {
          type: 'item', status: 'checked', priority: 1, description: 'Eggs #shop -> 2022-01-31',
          tags: [{ name: 'shop', value: null }],
          dueDate: { text: '2022-01-31', period: 'day', year: 2022, month: 1, day: 31, date: '2022-01-31' },
          raw: '[x] ! Eggs #shop -> 2022-01-31',
        },
        { type: 'blank', raw: '' },
        { type: 'item', status: 'ongoing', priority: 0, description: 'Other', tags: [], dueDate: null, raw: '[@] Other' },
      ] satisfies Block[],
    });
  });

  test('every status', () => {
    const statuses = parse('[ ]\n[x]\n[@]\n[~]\n[?]\n').blocks.map((b) => b.type === 'item' && b.status);
    assert.deepEqual(statuses, ['open', 'checked', 'ongoing', 'obsolete', 'in-question']);
  });

  test('continuation lines join the description with \\n; spaces past the indent are kept', () => {
    const [item] = parse('[ ] One\n    two\n       three\n').blocks;
    assert.equal(item?.type === 'item' && item.description, 'One\ntwo\n   three');
    assert.equal(item?.type === 'item' && item.raw, '[ ] One\n    two\n       three');
  });

  test('priority: the number of !s, with dots as padding; it needs a space or the line end after it', () => {
    const read = (line: string) => {
      const [b] = parse(line).blocks;
      assert.equal(b?.type, 'item', line);
      return b?.type === 'item' ? [b.priority, b.description] : [];
    };
    assert.deepEqual(read('[ ] ! a'), [1, 'a']);
    assert.deepEqual(read('[ ] !!! a'), [3, 'a']);
    assert.deepEqual(read('[ ] ..! a'), [1, 'a']);
    assert.deepEqual(read('[ ] !!.. a'), [2, 'a']);
    assert.deepEqual(read('[ ] ... a'), [0, 'a']);
    assert.deepEqual(read('[ ] !'), [1, '']);
    assert.deepEqual(read('[ ] !! '), [2, '']);
    assert.deepEqual(read('[ ] !   a'), [1, '  a']);
    assert.deepEqual(read('[ ] !a'), [0, '!a']);
    assert.deepEqual(read('[ ] .!. a'), [0, '.!. a']);
    assert.deepEqual(read('[ ] ! !! a'), [1, '!! a']);
  });

  test('a blank line is empty or whitespace only (including NBSP and tab), and ends an item', () => {
    assert.deepEqual(kinds('[ ] a\n    \n    b\n'), ['item', 'blank', 'invalid']);
    assert.deepEqual(kinds('\u00a0\u2003\n\t\n \t \n'), ['blank', 'blank', 'blank']);
    assert.deepEqual(parse('[ ] a\n  \t\n').blocks[1], { type: 'blank', raw: '  \t' });
  });

  test('a title comes first, or after a blank line; anything else is invalid', () => {
    assert.deepEqual(kinds('Todos\n[ ] a\n'), ['title', 'item']);
    assert.deepEqual(kinds('[ ] a\n\nTodos\n'), ['item', 'blank', 'title']);
    assert.deepEqual(kinds('[ ] a\nTodos\n'), ['item', 'invalid']);
    assert.deepEqual(kinds('One\nTwo\n'), ['title', 'invalid']);
    assert.deepEqual(kinds(' bad\nTodos\n'), ['invalid', 'invalid']);
    assert.deepEqual(kinds('\tTodos\n'), ['invalid']);
    assert.deepEqual(kinds('A\n'), ['title']);
  });

  test('indented lines continue items only', () => {
    assert.deepEqual(kinds('Title\n    more\n'), ['title', 'invalid']);
    assert.deepEqual(kinds('    [x] a\n'), ['invalid']);
    assert.deepEqual(kinds('[ ] a\nbad\n    more\n'), ['item', 'invalid', 'invalid']);
  });

  test('a description must start on the first line: an item without one has no continuation lines', () => {
    const doc = parse('[ ]\n    b\n    c\n[ ] !\n    d\n');
    assert.deepEqual(doc.blocks.map((b) => (b.type === 'item' ? [b.priority, b.description] : b.type)), [
      [0, ''], 'invalid', 'invalid', [1, ''], 'invalid',
    ]);
    assert.deepEqual(errorCodes('[ ]\n    b\n    c\n'), ['description-not-on-first-line', 'description-not-on-first-line']);
    assert.deepEqual(kinds('[ ] a\n    b\n'), ['item']);
  });

  test('invalid lines are kept as they were', () => {
    assert.deepEqual(parse('[*] Huh').blocks, [{ type: 'invalid', raw: '[*] Huh' }]);
  });
});

describe('parse: file format', () => {
  test('a final newline is recorded; without one the last line still counts', () => {
    assert.equal(parse('[ ] a\n').finalNewline, true);
    assert.equal(parse('[ ] a').finalNewline, false);
    assert.deepEqual(kinds('[ ] a'), ['item']);
    assert.deepEqual(parse('\n'), { blocks: [{ type: 'blank', raw: '' }], newline: '\n', finalNewline: true, bom: false });
  });

  test('CRLF line endings', () => {
    const doc = parse('[ ] a\r\n    b\r\n');
    assert.equal(doc.newline, '\r\n');
    assert.deepEqual(doc.blocks.map((b) => b.type === 'item' && b.description), ['a\nb']);
  });

  test('a lone CR is content, not a line ending', () => {
    const doc = parse('[ ] a\rb\n');
    assert.equal(doc.newline, '\n');
    assert.deepEqual(doc.blocks.map((b) => b.type === 'item' && b.description), ['a\rb']);
  });

  test('mixed line endings: the first one wins', () => {
    assert.equal(parse('[ ] a\n[ ] b\r\n').newline, '\n');
    assert.equal(parse('[ ] a\r\n[ ] b\n').newline, '\r\n');
  });

  test('a UTF-8 byte-order mark is removed and recorded', () => {
    const doc = parse('\uFEFFTodos\n');
    assert.equal(doc.bom, true);
    assert.deepEqual(doc.blocks, [{ type: 'title', text: 'Todos' }]);
  });
});

describe('parse: strict', () => {
  test('throws XitParseError with every error', () => {
    assert.throws(() => parse('[ ] ok\n[*] a\n[]b\n', { strict: true }), (error: unknown) => {
      assert.ok(error instanceof XitParseError);
      assert.deepEqual(error.diagnostics.map((d) => d.code), ['invalid-checkbox', 'invalid-checkbox']);
      assert.match(error.message, /^2:1: .+ \(and 1 more\)$/);
      return true;
    });
  });

  test('warnings do not make it throw', () => {
    assert.doesNotThrow(() => parse('[ ] .!. -> 2022-13', { strict: true }));
  });
});

describe('validate', () => {
  test('a clean document has no diagnostics', () => {
    assert.deepEqual(validate('Todos\n[ ] ! a #b -> 2022\n    more\n\n[x] c\n'), []);
    assert.deepEqual(validate(''), []);
  });

  test('errors cover the whole line, with 1-based line and column', () => {
    const [d] = validate('[ ] ok\n[*] bad\n');
    assert.deepEqual(d, {
      severity: 'error', code: 'invalid-checkbox', from: 7, to: 14, line: 2, column: 1,
      message: d!.message,
    } satisfies Diagnostic);
    assert.ok(d!.message.length > 0);
  });

  test('error codes', () => {
    const cases: Array<[string, DiagnosticCode]> = [
      ['[*] a', 'invalid-checkbox'],
      ['[X] a', 'invalid-checkbox'],
      ['[] a', 'invalid-checkbox'],
      ['[ x ] a', 'invalid-checkbox'],
      ['[Todos]', 'invalid-checkbox'],
      ['[\u00a0] a', 'invalid-checkbox'],
      ['[ ]a', 'missing-space-after-checkbox'],
      ['[x]\ta', 'missing-space-after-checkbox'],
      [' Todos', 'bad-indentation'],
      ['[ ] a\n   b', 'bad-indentation'],
      ['[ ] a\n\tb', 'bad-indentation'],
      ['[ ] a\n\u00a0\u00a0\u00a0\u00a0b', 'bad-indentation'],
      ['[ ] a\n\n    b', 'bad-indentation'],
      ['[ ] a\nTodos', 'title-without-blank-line'],
      ['One\nTwo', 'title-without-blank-line'],
      ['[ ]\n    b', 'description-not-on-first-line'],
      ['[ ] !\n    b', 'description-not-on-first-line'],
      ['[ ]   \n    b', 'description-not-on-first-line'],
    ];
    for (const [source, code] of cases) assert.deepEqual(errorCodes(source), [code], JSON.stringify(source));
  });

  test('warnings point at the problem', () => {
    const at = (source: string) =>
      validate(source).map((d) => [d.severity, d.code, source.slice(d.from, d.to), d.line, d.column]);
    assert.deepEqual(at('[ ]    ! Do something\n'), [['warning', 'misplaced-priority', '!', 1, 8]]);
    assert.deepEqual(at('[ ] .!. Invalid\n'), [['warning', 'malformed-priority', '.!.', 1, 5]]);
    assert.deepEqual(at('[ ] !.!\n'), [['warning', 'malformed-priority', '!.!', 1, 5]]);
    assert.deepEqual(at('[ ] a\n    -> 2022-13-01\n'), [['warning', 'invalid-due-date', '-> 2022-13-01', 2, 5]]);
    assert.deepEqual(at('[ ] -> 2022-01/31\n'), [['warning', 'invalid-due-date', '-> 2022-01/31', 1, 5]]);
    assert.deepEqual(at('[ ] -> 2022-01-31very\n'), [['warning', 'invalid-due-date', '-> 2022-01-31', 1, 5]]);
    assert.deepEqual(at('[ ] -> 2022 -> 2023\n'), [['warning', 'extra-due-date', '-> 2023', 1, 13]]);
    assert.deepEqual(at('[ ] ! #a="b\n'), [['warning', 'unclosed-tag-value', '"b', 1, 10]]);
    assert.deepEqual(at('[ ] a\r\n[ ] b\n'), [['warning', 'mixed-newlines', '\n', 2, 6]]);
    assert.deepEqual(at('[ ] a'), [['warning', 'missing-final-newline', '', 1, 6]]);
  });

  test('these are not warned about', () => {
    for (const source of ['[ ] !a\n', '[ ] .The dot\n', '[ ] Due-> 2022-01-31\n', '[ ] ---> 2022\n',
      '[ ] ->2022\n', '[ ] -> soon\n', '[ ] -> 22\n', '[ ] #tag=\n', '[ ] f(x) != 1.0!\n', '[ ] ...\n']) {
      assert.deepEqual(codes(source), [], source);
    }
  });

  test('columns count UTF-16 code units, as JavaScript strings do', () => {
    const [d] = validate('[ ] 🥳 -> 2022-13\n');
    assert.equal(d?.column, 8);
  });
});
