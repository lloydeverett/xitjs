import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  XitStringifyError, createItem, parse, stringify, type Block, type Item, type XitDocument,
} from '../src/index.ts';

const item = (fields: Partial<Item>): Item => ({ ...createItem(), ...fields });
const write = (...blocks: Block[]) => stringify({ blocks });

function throwsAt(document: XitDocument, blockIndex: number, message: RegExp) {
  assert.throws(() => stringify(document), (error: unknown) => {
    assert.ok(error instanceof XitStringifyError, String(error));
    assert.equal(error.blockIndex, blockIndex);
    assert.match(error.message, message);
    return true;
  });
}

describe('stringify: standard form', () => {
  test('an empty document is an empty string', () => {
    assert.equal(stringify({ blocks: [] }), '');
  });

  test('items: checkbox, then priority and description, each after one space', () => {
    assert.equal(write(item({ description: 'Milk' })), '[ ] Milk\n');
    assert.equal(write(item({ status: 'checked', description: 'Milk' })), '[x] Milk\n');
    assert.equal(write(item({ status: 'ongoing', priority: 2, description: 'Milk' })), '[@] !! Milk\n');
    assert.equal(write(item({ status: 'obsolete' })), '[~]\n');
    assert.equal(write(item({ status: 'in-question', priority: 1 })), '[?] !\n');
    assert.equal(write(item({ description: '  spaced' })), '[ ]   spaced\n');
    assert.equal(write(item({ priority: 1, description: '!! loud' })), '[ ] ! !! loud\n');
  });

  test('with no priority, a description that starts like one gets a dot (a priority of 0) first', () => {
    for (const description of ['!', '! a', '... a', '..!', '!!.\nmore']) {
      const text = write(item({ description }));
      assert.equal(text, `[ ] . ${description.replace('\n', '\n    ')}\n`);
      const [read] = parse(text).blocks as [Item];
      assert.deepEqual([read.priority, read.description], [0, description]);
    }
    assert.equal(write(item({ description: '!a' })), '[ ] !a\n');
    assert.equal(write(item({ description: ' ! a' })), '[ ]  ! a\n');
    assert.equal(write(item({ priority: 1, description: '! a' })), '[ ] ! ! a\n');
  });

  test('continuation lines are indented by four spaces', () => {
    assert.equal(write(item({ description: 'One\ntwo\n  three' })), '[ ] One\n    two\n      three\n');
    assert.equal(write(item({ description: '\nonly continued' })), '[ ]\n    only continued\n');
  });

  test('titles, blank lines and invalid lines', () => {
    assert.equal(
      write({ type: 'title', text: 'Todos' }, item({ description: 'a' }), { type: 'blank' }, { type: 'invalid', raw: '[*] eh' }),
      'Todos\n[ ] a\n\n[*] eh\n',
    );
  });

  test('the derived fields are ignored: the description is what gets written', () => {
    const stale = { ...item({ description: 'no tags' }), tags: [{ name: 'ghost', value: null }] };
    assert.equal(write(stale), '[ ] no tags\n');
  });

  test("the document's formatting, and options that override it", () => {
    const blocks: Block[] = [item({ description: 'a' }), item({ description: 'b\nc' })];
    assert.equal(stringify({ blocks, newline: '\r\n' }), '[ ] a\r\n[ ] b\r\n    c\r\n');
    assert.equal(stringify({ blocks, finalNewline: false }), '[ ] a\n[ ] b\n    c');
    assert.equal(stringify({ blocks, bom: true }), '\uFEFF[ ] a\n[ ] b\n    c\n');
    assert.equal(stringify({ blocks, newline: '\r\n' }, { newline: '\n', finalNewline: false }), '[ ] a\n[ ] b\n    c');
  });
});

describe('stringify: raw', () => {
  test('an unchanged item is written as it was read', () => {
    for (const source of ['[ ] ..! a\n', '[ ] !!. a\n', '[ ] ... a\n', '[ ] \n', '[ ] ! \n', '[x]   a   \n']) {
      assert.equal(stringify(parse(source)), source);
    }
  });

  test('a changed item is written afresh', () => {
    const [parsed] = parse('[ ] ..! a\n').blocks as [Item];
    assert.equal(write({ ...parsed, status: 'checked' }), '[x] ! a\n');
    assert.equal(write({ ...parsed, priority: 3 }), '[ ] !!! a\n');
    assert.equal(write({ ...parsed, description: 'b' }), '[ ] ! b\n');
  });

  test("raw that isn't an item is ignored", () => {
    assert.equal(write(item({ description: 'a', raw: 'nonsense' })), '[ ] a\n');
    assert.equal(write(item({ description: 'a', raw: '[ ] a\n[ ] b' })), '[ ] a\n');
  });

  test("raw lines take the document's line ending", () => {
    const doc = parse('[ ] a\n    b\n');
    assert.equal(stringify(doc, { newline: '\r\n' }), '[ ] a\r\n    b\r\n');
  });

  test('blank lines keep their whitespace', () => {
    assert.equal(write(item({ description: 'a' }), { type: 'blank', raw: ' \t ' }), '[ ] a\n \t \n');
  });
});

describe('stringify: refuses what would read back differently', () => {
  test('a blank continuation line', () => {
    throwsAt({ blocks: [item({ description: 'a\n\nb' })] }, 0, /blank/);
    throwsAt({ blocks: [item({ description: 'a\n   ' })] }, 0, /blank/);
    throwsAt({ blocks: [item({ description: 'a\n\t' })] }, 0, /blank/);
  });

  test('a line ending in a carriage return, which \\n would turn into \\r\\n', () => {
    throwsAt({ blocks: [item({ description: 'a\r' })] }, 0, /carriage return/);
    throwsAt({ blocks: [item({ description: 'a\r\nb' })] }, 0, /carriage return/);
    throwsAt({ blocks: [{ type: 'title', text: 'T\r' }] }, 0, /carriage return/);
    throwsAt({ blocks: [{ type: 'invalid', raw: ' x\r' }] }, 0, /carriage return/);
    assert.equal(write(item({ description: 'a\rb' })), '[ ] a\rb\n');
    // With \r\n line endings it's fine: 'a\r\r\n' reads back as the line 'a\r'.
    const doc = { blocks: [item({ description: 'a\r' })], newline: '\r\n' as const };
    assert.equal(stringify(doc), '[ ] a\r\r\n');
    assert.equal((parse(stringify(doc)).blocks[0] as Item).description, 'a\r');
  });

  test('a bad status or priority', () => {
    throwsAt({ blocks: [item({ status: 'done' as never })] }, 0, /status/);
    for (const priority of [-1, 1.5, Number.NaN, Infinity]) {
      throwsAt({ blocks: [item({ priority })] }, 0, /priority/);
    }
  });

  test('titles: one non-blank line, not starting with whitespace or [', () => {
    for (const text of ['', '   ', ' Todos', '\tTodos', '[Todos]', 'To\ndos']) {
      throwsAt({ blocks: [{ type: 'title', text }] }, 0, /title/i);
    }
  });

  test('a title must be first, or follow a blank line', () => {
    throwsAt({ blocks: [item({}), { type: 'title', text: 'T' }] }, 1, /blank line/);
    throwsAt({ blocks: [{ type: 'title', text: 'A' }, { type: 'title', text: 'B' }] }, 1, /blank line/);
    throwsAt({ blocks: [{ type: 'invalid', raw: 'x' }, { type: 'title', text: 'B' }] }, 1, /blank line/);
  });

  test('blank and invalid lines are single lines; blank ones only whitespace', () => {
    throwsAt({ blocks: [{ type: 'blank', raw: 'x' }] }, 0, /whitespace/);
    throwsAt({ blocks: [{ type: 'blank', raw: ' \n ' }] }, 0, /line/);
    throwsAt({ blocks: [{ type: 'invalid', raw: 'a\nb' }] }, 0, /line/);
  });

  test('U+FEFF at the very start, without a byte-order mark, which would read as one', () => {
    throwsAt({ blocks: [{ type: 'title', text: '\uFEFFT' }] }, 0, /U\+FEFF/);
    assert.equal(stringify({ blocks: [{ type: 'title', text: '\uFEFFT' }], bom: true }), '\uFEFF\uFEFFT\n');
    assert.equal(stringify({ blocks: [{ type: 'blank' }, { type: 'title', text: '\uFEFFT' }] }), '\n\uFEFFT\n');
  });

  test('an unknown block type', () => {
    throwsAt({ blocks: [{ type: 'note' } as never] }, 0, /type/);
  });

  test('a document ending in an empty blank line, without a final newline', () => {
    // It would read back as one line fewer, with a final newline.
    throwsAt({ blocks: [item({}), { type: 'blank' }], finalNewline: false }, 1, /final newline/);
    assert.equal(stringify({ blocks: [item({}), { type: 'blank', raw: ' ' }], finalNewline: false }), '[ ]\n ');
  });
});
