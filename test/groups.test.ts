// Editing a document by its groups: adding, removing and moving items and groups.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  XitEditError, addGroup, addItem, createItem, getGroups, getItems, moveGroup, moveItem, parse, parseItems, removeGroup,
  removeItem, replaceItem, setGroupTitle, stringify, type Item, type XitDocument,
} from '../src/index.ts';
import { runs, xitDocument } from './arbitraries.ts';

/** Applies an edit to a document's text, and writes the result. */
function edited(source: string, edit: (doc: XitDocument) => XitDocument): string {
  return stringify(edit(parse(source)));
}

/** The document's item with this description. */
function item(doc: XitDocument, description: string): Item {
  const found = getItems(doc).find((i) => i.description === description);
  assert.ok(found, description);
  return found;
}

describe('getGroups: ranges', () => {
  test('each group knows where its blocks start and end', () => {
    const doc = parse('A\n[ ] a\n\nB\n\n[ ] c\n    c2\nbad\n');
    assert.deepEqual(getGroups(doc).map(({ title, start, end }) => [title, start, end]), [
      ['A', 0, 2], ['B', 3, 4], [null, 5, 6],
    ]);
  });
});

describe('addItem', () => {
  test('adds at the end of a group, or at a position', () => {
    const source = 'A\n[ ] a\n\nB\n[ ] b\n';
    assert.equal(edited(source, (d) => addItem(d, 0, 'new')), 'A\n[ ] a\n[ ] new\n\nB\n[ ] b\n');
    assert.equal(edited(source, (d) => addItem(d, 0, 'new', 0)), 'A\n[ ] new\n[ ] a\n\nB\n[ ] b\n');
    assert.equal(edited(source, (d) => addItem(d, 1, 'new')), 'A\n[ ] a\n\nB\n[ ] b\n[ ] new\n');
  });

  test('to a group with only a title', () => {
    assert.equal(edited('A\n\nB\n', (d) => addItem(d, 0, 'new')), 'A\n[ ] new\n\nB\n');
  });

  test('takes text, an item spec or an item', () => {
    assert.equal(edited('A\n', (d) => addItem(d, 0, { status: 'checked', priority: 1, description: 'x' })), 'A\n[x] ! x\n');
    assert.equal(edited('A\n', (d) => addItem(d, 0, createItem('y #t'))), 'A\n[ ] y #t\n');
  });

  test('leaves every other line as it was', () => {
    const source = 'A  \n[ ] ..! a   \n  \n\t\nB\n[x]  b\nnot a title\n';
    assert.equal(edited(source, (d) => addItem(d, 1, 'new', 0)), 'A  \n[ ] ..! a   \n  \n\t\nB\n[ ] new\n[x]  b\nnot a title\n');
  });

  test('throws a XitEditError for a group that does not exist, or an item that cannot be written', () => {
    const doc = parse('A\n');
    assert.throws(() => addItem(doc, 1, 'x'), XitEditError);
    assert.throws(() => addItem(doc, -1, 'x'), XitEditError);
    assert.throws(() => addItem(doc, 0, 'a\n\nb'), {
      name: 'XitEditError',
      message: "Couldn't add the item. A description's continuation lines can't be blank: a blank line ends the item.",
    });
  });
});

describe('removeItem', () => {
  test('removes the item', () => {
    assert.equal(edited('A\n[ ] a\n[ ] b\n    b2\n', (d) => removeItem(d, item(d, 'b\nb2'))), 'A\n[ ] a\n');
  });

  test('a titled group stays when its last item goes', () => {
    assert.equal(edited('A\n[ ] a\n\nB\n', (d) => removeItem(d, item(d, 'a'))), 'A\n\nB\n');
  });

  test("leaves the invalid lines after a group that goes with its last item", () => {
    assert.equal(edited('A\n[ ] a\n\n[ ] x\n[*] bad\n', (d) => removeItem(d, item(d, 'x'))), 'A\n[ ] a\n[*] bad\n');
  });

  test('a group without a title goes with its last item, and one blank line with it', () => {
    assert.equal(edited('[ ] x\n\nA\n[ ] a\n', (d) => removeItem(d, item(d, 'x'))), 'A\n[ ] a\n');
    assert.equal(edited('A\n[ ] a\n\n[ ] x\n\nB\n', (d) => removeItem(d, item(d, 'x'))), 'A\n[ ] a\n\nB\n');
    assert.equal(edited('A\n[ ] a\n\n[ ] x\n', (d) => removeItem(d, item(d, 'x'))), 'A\n[ ] a\n');
  });

  test('keeps a blank line a title needs', () => {
    assert.equal(edited('[*] bad\n[ ] x\n\nB\n', (d) => removeItem(d, item(d, 'x'))), '[*] bad\n\nB\n');
  });

  test('throws a XitEditError for an item that is not in the document', () => {
    assert.throws(() => removeItem(parse('[ ] a\n'), createItem('a')), XitEditError);
  });

  test('says why when it would change the rest of the document', () => {
    // Without the group above it, the invalid line would be the first line, and so a title.
    const doc = parse('[ ] a\nnot a title\n');
    assert.throws(() => removeItem(doc, item(doc, 'a')), {
      name: 'XitEditError', message: "Couldn't remove the item without changing the rest of the document.",
    });
  });
});

describe('moveItem', () => {
  const source = 'A\n[ ] a\n[ ] b\n\nB\n[ ] c\n';

  test('to another group, at the end or at a position', () => {
    assert.equal(edited(source, (d) => moveItem(d, item(d, 'b'), 1)), 'A\n[ ] a\n\nB\n[ ] c\n[ ] b\n');
    assert.equal(edited(source, (d) => moveItem(d, item(d, 'b'), 1, 0)), 'A\n[ ] a\n\nB\n[ ] b\n[ ] c\n');
  });

  test('within its group: the position is where it ends up', () => {
    assert.equal(edited(source, (d) => moveItem(d, item(d, 'a'), 0, 1)), 'A\n[ ] b\n[ ] a\n\nB\n[ ] c\n');
    assert.equal(edited(source, (d) => moveItem(d, item(d, 'b'), 0, 0)), 'A\n[ ] b\n[ ] a\n\nB\n[ ] c\n');
    assert.equal(edited(source, (d) => moveItem(d, item(d, 'a'), 0, 0)), source);
  });

  test('keeps the item as it was written', () => {
    assert.equal(edited('A\n[ ] ..! a\n    more\n\nB\n', (d) => moveItem(d, item(d, 'a\nmore'), 1)), 'A\n\nB\n[ ] ..! a\n    more\n');
  });

  test('out of a group without a title, which then goes', () => {
    assert.equal(edited('[ ] x\n\nA\n[ ] a\n', (d) => moveItem(d, item(d, 'x'), 1)), 'A\n[ ] a\n[ ] x\n');
    assert.equal(edited('[ ] x\n\n[ ] y\n', (d) => moveItem(d, item(d, 'x'), 1, 0)), '[ ] x\n[ ] y\n');
  });

  test("a group's only item, within that group, stays put", () => {
    assert.equal(edited('[ ] x\n\nA\n', (d) => moveItem(d, item(d, 'x'), 0, 3)), '[ ] x\n\nA\n');
  });

  test('throws a XitEditError for an item or group that is not there', () => {
    const doc = parse(source);
    assert.throws(() => moveItem(doc, createItem('z'), 0), XitEditError);
    assert.throws(() => moveItem(doc, item(doc, 'a'), 2), XitEditError);
  });
});

describe('addGroup', () => {
  test('at the end, or before a group', () => {
    const source = 'A\n[ ] a\n';
    assert.equal(edited(source, (d) => addGroup(d, { title: 'B', items: ['b'] })), 'A\n[ ] a\n\nB\n[ ] b\n');
    assert.equal(edited(source, (d) => addGroup(d, { title: 'B', items: ['b'] }, 0)), 'B\n[ ] b\n\nA\n[ ] a\n');
  });

  test('to an empty document, or one with no groups', () => {
    assert.equal(edited('', (d) => addGroup(d, { title: 'B' })), 'B\n');
    assert.equal(edited('\n\n', (d) => addGroup(d, { title: 'B' })), '\n\nB\n');
    assert.equal(edited('[*] bad\n', (d) => addGroup(d, { title: 'B' })), '[*] bad\n\nB\n');
  });

  test('without a title', () => {
    assert.equal(edited('A\n[ ] a\n', (d) => addGroup(d, { items: ['x'] })), 'A\n[ ] a\n\n[ ] x\n');
  });

  test('keeps blank lines at the end of the document at the end', () => {
    assert.equal(edited('A\n[ ] a\n\n\n', (d) => addGroup(d, { title: 'B' })), 'A\n[ ] a\n\nB\n\n\n');
  });

  test('adds a blank line where a title needs one', () => {
    assert.equal(edited('[*] bad\n[ ] x\n', (d) => addGroup(d, { title: 'B' }, 0)), '[*] bad\n\nB\n\n[ ] x\n');
  });

  test('throws a XitEditError for a group with nothing in it, or a title that cannot be written', () => {
    const doc = parse('A\n');
    assert.throws(() => addGroup(doc, {}), XitEditError);
    assert.throws(() => addGroup(doc, { title: '[x] no' }), {
      name: 'XitEditError', message: "Couldn't add the group. A title can't start with '['.",
    });
    assert.throws(() => addGroup(doc, { title: 'B' }, 2), XitEditError);
  });
});

describe('removeGroup', () => {
  const source = 'A\n[ ] a\n\nB\n[ ] b\n\nC\n';

  test('removes its blocks and one blank line', () => {
    assert.equal(edited(source, (d) => removeGroup(d, 0)), 'B\n[ ] b\n\nC\n');
    assert.equal(edited(source, (d) => removeGroup(d, 1)), 'A\n[ ] a\n\nC\n');
    assert.equal(edited(source, (d) => removeGroup(d, 2)), 'A\n[ ] a\n\nB\n[ ] b\n');
  });

  test('keeps a blank line a title needs', () => {
    assert.equal(edited('[*] bad\n[ ] x\n\nB\n', (d) => removeGroup(d, 0)), '[*] bad\n\nB\n');
  });

  test('the first or last group takes all the blank lines between it and the rest', () => {
    assert.equal(edited('[ ] a\n\n\n\nB\n[ ] b\n', (d) => removeGroup(d, 0)), 'B\n[ ] b\n');
    assert.equal(edited('A\n\n\n\nB\n', (d) => removeGroup(d, 1)), 'A\n');
    assert.equal(edited('[ ] a\n\n\n\nB\n[ ] b\n', (d) => moveItem(d, item(d, 'a'), 1)), 'B\n[ ] b\n[ ] a\n');
    // A group in the middle takes one.
    assert.equal(edited('A\n\n\nB\n\n\nC\n', (d) => removeGroup(d, 1)), 'A\n\n\nC\n');
  });

  test('takes the invalid lines straight after its items with it', () => {
    assert.equal(edited('A\n[ ] a\n[*] bad\n    worse\n\nB\n', (d) => removeGroup(d, 0)), 'B\n');
    assert.equal(edited('A\n[ ] a\n[*] bad\n[ ] b\n', (d) => removeGroup(d, 0)), '[ ] b\n');
  });

  test('throws a XitEditError for a group that does not exist', () => {
    assert.throws(() => removeGroup(parse(source), 3), XitEditError);
  });
});

describe('moveGroup', () => {
  const source = 'A\n[ ] a\n\nB\n[ ] b\n\nC\n';

  test('moves a group so it ends up at the index', () => {
    assert.equal(edited(source, (d) => moveGroup(d, 2, 0)), 'C\n\nA\n[ ] a\n\nB\n[ ] b\n');
    assert.equal(edited(source, (d) => moveGroup(d, 0, 2)), 'B\n[ ] b\n\nC\n\nA\n[ ] a\n');
    assert.equal(edited(source, (d) => moveGroup(d, 0, 1)), 'B\n[ ] b\n\nA\n[ ] a\n\nC\n');
    assert.equal(edited(source, (d) => moveGroup(d, 1, 1)), source);
  });

  test('keeps its items as they were written', () => {
    assert.equal(edited('A\n[ ] ..! a\n\nB\n', (d) => moveGroup(d, 0, 1)), 'B\n\nA\n[ ] ..! a\n');
  });

  test('takes the invalid lines straight after its items with it', () => {
    assert.equal(edited('A\n[ ] a\n[*] bad\n\nB\n[ ] b\n', (d) => moveGroup(d, 0, 1)), 'B\n[ ] b\n\nA\n[ ] a\n[*] bad\n');
    assert.equal(edited('A\n[ ] a\n[*] bad\n[ ] b\n', (d) => moveGroup(d, 0, 1)), '[ ] b\n\nA\n[ ] a\n[*] bad\n');
  });

  test('throws a XitEditError for a group that does not exist', () => {
    assert.throws(() => moveGroup(parse(source), 0, 3), XitEditError);
    assert.throws(() => moveGroup(parse(source), 3, 0), XitEditError);
  });
});

describe('setGroupTitle', () => {
  test('renames a group', () => {
    assert.equal(edited('A\n[ ] a\n', (d) => setGroupTitle(d, 0, 'B')), 'B\n[ ] a\n');
  });

  test('gives a group a title, with a blank line before it if it needs one', () => {
    assert.equal(edited('[ ] a\n', (d) => setGroupTitle(d, 0, 'T')), 'T\n[ ] a\n');
    assert.equal(edited('[*] bad\n[ ] a\n', (d) => setGroupTitle(d, 0, 'T')), '[*] bad\n\nT\n[ ] a\n');
  });

  test("null removes a group's title; a group with no items then goes", () => {
    assert.equal(edited('A\n[ ] a\n', (d) => setGroupTitle(d, 0, null)), '[ ] a\n');
    assert.equal(edited('A\n[ ] a\n\nB\n', (d) => setGroupTitle(d, 1, null)), 'A\n[ ] a\n');
  });

  test('throws a XitEditError for a title that cannot be written', () => {
    const doc = parse('A\n');
    for (const title of ['[x] no', ' indented', '', 'two\nlines']) {
      assert.throws(() => setGroupTitle(doc, 0, title), XitEditError, JSON.stringify(title));
    }
  });
});

describe('parseItems', () => {
  test('reads one item, or several, keeping how each is written', () => {
    const [one] = parseItems('[x] ..! a\n    b');
    assert.deepEqual([one!.status, one!.priority, one!.description, one!.raw], ['checked', 1, 'a\nb', '[x] ..! a\n    b']);
    assert.deepEqual(parseItems('[ ] a\n[@] b\n    c\n').map((i) => i.description), ['a', 'b\nc']);
    assert.deepEqual(parseItems('[ ] ').map((i) => i.description), ['']);
  });

  test('throws a XitEditError, saying why, for anything else', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /no item/],
      ['  \n', /no item/],
      ['a', /line 1 isn't an item/],
      ['[ ] a\n\n[ ] b', /line 2 is blank/],
      ['[ ] a\nb', /line 2 isn't an item/],
      ['[*] a', /line 1 isn't an item/],
    ];
    for (const [text, message] of cases) {
      assert.throws(() => parseItems(text), { name: 'XitEditError', message }, JSON.stringify(text));
    }
  });
});

describe('replaceItem', () => {
  test('puts another item in its place, as it is written', () => {
    const source = 'A\n[ ] a\n[ ] b\n\nB\n[ ] c\n';
    const doc = parse(source);
    const next = replaceItem(doc, item(doc, 'a'), parseItems('[x] ..! a2\n    more'));
    assert.equal(stringify(next), 'A\n[x] ..! a2\n    more\n[ ] b\n\nB\n[ ] c\n');
  });

  test('splits it into several', () => {
    const doc = parse('A\n[ ] a\n[ ] b\n');
    const next = replaceItem(doc, item(doc, 'a'), parseItems('[ ] a1\n[x] a2'));
    assert.equal(stringify(next), 'A\n[ ] a1\n[x] a2\n[ ] b\n');
  });

  test('takes a single item, and keeps the other items as they were', () => {
    const doc = parse('A\n[ ] a\n[ ] b\n');
    const next = replaceItem(doc, item(doc, 'a'), createItem('z'));
    assert.equal(stringify(next), 'A\n[ ] z\n[ ] b\n');
    assert.equal(next.blocks[2], doc.blocks[2]);
  });

  test("writes the document's own line endings", () => {
    const doc = parse('A\r\n[ ] a\r\n');
    assert.equal(stringify(replaceItem(doc, item(doc, 'a'), parseItems('[ ] a\n    b'))), 'A\r\n[ ] a\r\n    b\r\n');
  });

  test('throws a XitEditError for an item not in the document, no items, or one that would change the rest', () => {
    const doc = parse('A\n[ ] a\nnot a title\n');
    assert.throws(() => replaceItem(doc, createItem('x'), createItem('y')), XitEditError);
    assert.throws(() => replaceItem(doc, item(doc, 'a'), []), XitEditError);
  });
});

// Property tests -------------------------------------------------------------

/** A group by value: its title and its items' status, priority and description. */
type Shape = Array<{ title: string | null; items: string[] }>;

const itemKey = (i: Pick<Item, 'status' | 'priority' | 'description'>) => `${i.status}|${i.priority}|${i.description}`;

function shape(doc: XitDocument): Shape {
  return getGroups(doc).map((g) => ({ title: g.title, items: g.items.map(itemKey) }));
}

/** An edit, and what it should do to the document's groups. */
interface Edit {
  name: string;
  /** How the edit may change the invalid lines: not at all, reorder them, or drop some. */
  invalid?: 'kept' | 'moved' | 'dropped';
  /** The item the edit removes or moves, if any. */
  touches?: Item;
  /** Whether every other item stays (false for removing a group). */
  keepsItems: boolean;
  apply: (doc: XitDocument) => XitDocument;
  expect: (groups: Shape) => Shape;
}

/** Drops a group that has neither a title nor items left: it no longer exists. */
const prune = (groups: Shape) => groups.filter((g) => g.title !== null || g.items.length > 0);

function edits(doc: XitDocument, pick: number[]): Edit[] {
  const groups = getGroups(doc);
  const items = getItems(doc);
  const n = (i: number, max: number) => (max === 0 ? 0 : pick[i]! % max);
  const g = n(0, groups.length);
  const g2 = n(1, groups.length + 1);
  const position = pick[2]! % 4;
  const target = items[n(3, items.length)];
  const fresh = createItem(`new ${pick[4]} #t`);
  const out: Edit[] = [
    {
      name: `addGroup ${g2}`,
      keepsItems: true,
      apply: (d) => addGroup(d, { title: `G${pick[4]}`, items: ['x'] }, g2),
      expect: (s) => s.toSpliced(g2, 0, { title: `G${pick[4]}`, items: [itemKey(createItem('x'))] }),
    },
  ];
  if (groups.length === 0) return out;
  const pos = Math.min(position, groups[g]!.items.length);
  out.push(
    {
      name: `addItem ${g} ${position}`,
      keepsItems: true,
      apply: (d) => addItem(d, g, fresh, position),
      expect: (s) => s.with(g, { ...s[g]!, items: s[g]!.items.toSpliced(pos, 0, itemKey(fresh)) }),
    },
    { name: `removeGroup ${g}`, keepsItems: false, invalid: 'dropped', apply: (d) => removeGroup(d, g), expect: (s) => s.toSpliced(g, 1) },
    {
      name: `moveGroup ${g} ${n(1, groups.length)}`,
      keepsItems: true,
      invalid: 'moved',
      apply: (d) => moveGroup(d, g, n(1, groups.length)),
      expect: (s) => s.toSpliced(g, 1).toSpliced(n(1, groups.length), 0, s[g]!),
    },
    {
      name: `setGroupTitle ${g}`,
      keepsItems: true,
      apply: (d) => setGroupTitle(d, g, pick[4]! % 3 === 0 ? null : `T${pick[4]}`),
      expect: (s) => prune(s.with(g, { ...s[g]!, title: pick[4]! % 3 === 0 ? null : `T${pick[4]}` })),
    },
  );
  if (target) {
    const from = groups.findIndex((gr) => gr.items.includes(target));
    const at = groups[from]!.items.indexOf(target);
    const removed = (s: Shape) => s.with(from, { ...s[from]!, items: s[from]!.items.toSpliced(at, 1) });
    const split = [createItem(`s${pick[4]}`), createItem({ status: 'checked', description: 't' })];
    out.push(
      { name: 'removeItem', touches: target, keepsItems: true, apply: (d) => removeItem(d, target), expect: (s) => prune(removed(s)) },
      {
        name: 'replaceItem',
        touches: target,
        keepsItems: true,
        apply: (d) => replaceItem(d, target, split),
        expect: (s) => s.with(from, { ...s[from]!, items: s[from]!.items.toSpliced(at, 1, ...split.map(itemKey)) }),
      },
      {
        name: `moveItem to ${g} at ${position}`,
        touches: target,
        keepsItems: true,
        apply: (d) => moveItem(d, target, g, position),
        expect: (s) => {
          const without = removed(s);
          const into = without[g]!;
          const moved = without.with(g, {
            ...into, items: into.items.toSpliced(Math.min(position, into.items.length), 0, itemKey(target)),
          });
          return prune(moved);
        },
      },
    );
  }
  return out;
}

describe('editing groups: properties', () => {
  test('an edit does exactly what it says to the groups, and leaves the rest of the document alone', () => {
    let applied = 0;
    let refused = 0;
    fc.assert(fc.property(xitDocument, fc.array(fc.nat(), { minLength: 5, maxLength: 5 }), (source, pick) => {
      const doc = parse(source);
      for (const edit of edits(doc, pick)) {
        let next: XitDocument;
        try {
          next = edit.apply(doc);
        } catch (error) {
          if (!(error instanceof XitEditError)) throw error;
          refused++;
          continue;
        }
        applied++;
        const text = stringify(next);
        assert.deepEqual(shape(parse(text)), edit.expect(shape(doc)), edit.name);
        // Invalid lines are all still there (in order, unless a group moved or went with them),
        // and other items keep their source text.
        const invalid = (d: XitDocument) => d.blocks.flatMap((b) => (b.type === 'invalid' ? [b.raw] : []));
        const [before, after] = [invalid(doc), invalid(parse(text))];
        if (edit.invalid === 'moved') assert.deepEqual(after.toSorted(), before.toSorted(), `${edit.name}: invalid lines`);
        else if (edit.invalid === 'dropped') assert.ok(after.every((l) => before.includes(l)), `${edit.name}: invalid lines`);
        else assert.deepEqual(after, before, `${edit.name}: invalid lines`);
        const raws = new Set(getItems(parse(text)).map((i) => i.raw));
        for (const other of getItems(doc)) {
          if (other !== edit.touches) assert.ok(raws.has(other.raw) || !edit.keepsItems, `${edit.name}: ${other.raw}`);
        }
        // A moved item keeps its source text too.
        if (edit.name.startsWith('moveItem')) assert.ok(raws.has(edit.touches!.raw), `${edit.name}: ${edit.touches!.raw}`);
      }
    }), runs(1000));
    assert.ok(applied > 10 * refused, `${applied} edits applied, ${refused} refused`);
  });
});
