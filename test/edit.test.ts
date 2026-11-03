import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  XitEditError, createItem, getTag, parse, parseDueDate, removeTag, setDueDate, setTag, stringify,
  type Item,
} from '../src/index.ts';

const item = (description: string) => createItem(description);
const throwsEdit = (fn: () => unknown, message: RegExp) =>
  assert.throws(fn, (error: unknown) => error instanceof XitEditError && message.test(error.message));

describe('setTag', () => {
  test('adds a tag at the end, after a space', () => {
    assert.equal(setTag(item('Milk'), 'shop').description, 'Milk #shop');
    assert.equal(setTag(item('Milk '), 'shop').description, 'Milk #shop');
    assert.equal(setTag(item(''), 'shop').description, '#shop');
    assert.equal(setTag(item('a\nb'), 'shop').description, 'a\nb #shop');
  });

  test('works out the derived fields, and leaves the original alone', () => {
    const before = item('Milk');
    const after = setTag(before, 'shop', 'corner');
    assert.deepEqual(after.tags, [{ name: 'shop', value: 'corner' }]);
    assert.equal(before.description, 'Milk');
    assert.deepEqual(before.tags, []);
  });

  test('quotes a value only when it has to', () => {
    assert.equal(setTag(item('a'), 'due', 'today').description, 'a #due=today');
    assert.equal(setTag(item('a'), '国', '日本').description, 'a #国=日本');
    assert.equal(setTag(item('a'), 'client', 'Acme Ltd').description, 'a #client="Acme Ltd"');
    assert.equal(setTag(item('a'), 'q', 'say "hi"').description, `a #q='say "hi"'`);
    assert.equal(setTag(item('a'), 'q', "it's").description, `a #q="it's"`);
  });

  test('no value, an empty value and null are all no value', () => {
    for (const value of [undefined, null, '']) {
      assert.equal(setTag(item('a'), 't', value).description, 'a #t');
    }
  });

  test('rewrites an existing tag in place, matching case-insensitively and keeping its spelling', () => {
    assert.equal(setTag(item('Buy #Shop=a milk'), 'shop', 'b').description, 'Buy #Shop=b milk');
    assert.equal(setTag(item('Buy #Shop="a b" milk'), 'SHOP').description, 'Buy #Shop milk');
    assert.equal(setTag(item('(#t)'), 't', 'x y').description, '(#t="x y")');
    assert.equal(setTag(item('a\n#t b'), 't', '1').description, 'a\n#t=1 b');
  });

  test('only the first of several', () => {
    const edited = setTag(item('#t=1 #t=2'), 't', '3');
    assert.equal(edited.description, '#t=3 #t=2');
    assert.equal(getTag(edited, 't')?.value, '3');
  });

  test('quotes a value that would otherwise run into the text after it', () => {
    assert.equal(setTag(item("#tag='foo'bar"), 'tag', 'x').description, '#tag="x"bar');
  });

  test('refuses names and values that cannot be written', () => {
    for (const name of ['', 'my tag', '#t', 't=v', 't!', 'täg']) {
      throwsEdit(() => setTag(item('a'), name), /name/);
    }
    throwsEdit(() => setTag(item('a'), 't', `both ' and "`), /quote/);
    throwsEdit(() => setTag(item('a'), 't', 'two\nlines'), /newline/);
  });

  test('an edited item is written afresh', () => {
    const [parsed] = parse('[ ] ! Milk\n').blocks as [Item];
    assert.equal(stringify({ blocks: [setTag(parsed, 'shop')] }), '[ ] ! Milk #shop\n');
  });
});

describe('removeTag', () => {
  test('removes the tag and the space next to it', () => {
    assert.equal(removeTag(item('Buy #shop milk'), 'shop').description, 'Buy milk');
    assert.equal(removeTag(item('Buy milk #shop'), 'shop').description, 'Buy milk');
    assert.equal(removeTag(item('#shop Buy'), 'shop').description, 'Buy');
    assert.equal(removeTag(item('#shop'), 'shop').description, '');
    assert.equal(removeTag(item('(#shop)'), 'shop').description, '()');
    assert.equal(removeTag(item('a\n#t b'), 't').description, 'a\nb');
    assert.equal(removeTag(item('a #t\nb'), 't').description, 'a\nb');
  });

  test('removes every occurrence, values and all, case-insensitively', () => {
    const edited = removeTag(item('#A x #a="b c" y #b'), 'a');
    assert.equal(edited.description, 'x y #b');
    assert.deepEqual(edited.tags, [{ name: 'b', value: null }]);
  });

  test('an item without the tag is returned unchanged', () => {
    const before = item('no tags here');
    assert.equal(removeTag(before, 'x'), before);
  });

  test('a line left empty is removed, so the description can still be written', () => {
    assert.equal(removeTag(item('a\n#t'), 't').description, 'a');
    assert.equal(removeTag(item('a\n#t\nb'), 't').description, 'a\nb');
    assert.equal(removeTag(item('#t\nb'), 't').description, 'b');
    assert.equal(removeTag(item('a\n #t'), 't').description, 'a');
    assert.equal(setDueDate(item('a\n-> 2022'), null).description, 'a');
    assert.equal(setDueDate(item('-> 2022\nb'), null).description, 'b');
  });

  test('never turns other text into a tag', () => {
    // Removing '#x' and its space only would leave 'a #b', making '#b' a tag.
    const edited = removeTag(item('a #x#b'), 'x');
    assert.equal(edited.description, 'a#b');
    assert.deepEqual(edited.tags, []);
  });
});

describe('setDueDate', () => {
  test('adds a due date at the end', () => {
    const edited = setDueDate(item('Call mum'), '2026-11-04');
    assert.equal(edited.description, 'Call mum -> 2026-11-04');
    assert.equal(edited.dueDate?.date, '2026-11-04');
    assert.equal(setDueDate(item(''), '2026').description, '-> 2026');
    assert.equal(setDueDate(item('a\nb'), '2026-Q4').description, 'a\nb -> 2026-Q4');
  });

  test('takes every pattern, or a DueDate', () => {
    for (const date of ['2026-11-04', '2026/11/04', '2026-11', '2026', '2026-W45', '2026/Q4']) {
      assert.equal(setDueDate(item('a'), date).dueDate?.text, date);
    }
    assert.equal(setDueDate(item('a'), parseDueDate('2026-W45')!).description, 'a -> 2026-W45');
  });

  test('rewrites the due date in place', () => {
    assert.equal(setDueDate(item('Do -> 2022-01-31 now'), '2026-W45').description, 'Do -> 2026-W45 now');
    assert.equal(setDueDate(item('Do (-> 2022)!'), '2026-11').description, 'Do (-> 2026-11)!');
    assert.equal(setDueDate(item('a\n-> 2022 b'), '2023').description, 'a\n-> 2023 b');
    // Only the one that counts.
    assert.equal(setDueDate(item('-> 2022 -> 2023'), '2024').description, '-> 2024 -> 2023');
  });

  test('null removes it, and any later one that would take its place', () => {
    assert.equal(setDueDate(item('Do -> 2022 now'), null).description, 'Do now');
    assert.equal(setDueDate(item('Do (-> 2022)'), null).description, 'Do ()');
    const edited = setDueDate(item('-> 2022 x -> 2023'), null);
    assert.equal(edited.description, 'x');
    assert.equal(edited.dueDate, null);
    const none = item('nothing due');
    assert.equal(setDueDate(none, null), none);
  });

  test('refuses dates that are not valid due dates', () => {
    for (const date of ['2026-02-30', 'tomorrow', '-> 2026', '2026-W54', '']) {
      throwsEdit(() => setDueDate(item('a'), date), /due date/);
    }
  });
});

describe('editing: properties', () => {
  const text = fc.array(
    fc.constantFrom('a', ' ', '#', '#t', '#T', '=', '"', "'", 'x y', '-> ', '2022', '-01', '(', ')', '!', '\n', 'é'),
    { maxLength: 12 },
  ).map((parts) => parts.join(''));
  const name = fc.constantFrom('t', 'T', 'shop', 'a-b', '国');
  const value = fc.option(fc.constantFrom('v', 'x y', "it's", 'say "hi"', 'é-1'), { nil: undefined });
  const RUNS = 2000;
  /** Counts the runs that made an edit, so a property can't pass by refusing everything. */
  let edited = 0;
  /** Whether stringify accepts the item; an edit must never make a writable item unwritable. */
  const writable = (i: Item) => {
    try {
      stringify({ blocks: [i] });
      return true;
    } catch {
      return false;
    }
  };
  const done = () => {
    assert.ok(edited > RUNS * 0.9, `only ${edited} of ${RUNS} runs made an edit`);
    edited = 0;
  };

  test('setTag sets the tag and changes no other tag or the due date', () => {
    fc.assert(fc.property(text, name, value, (description, n, v) => {
      const before = item(description);
      let after: Item;
      try {
        after = setTag(before, n, v);
      } catch (error) {
        if (error instanceof XitEditError) return;
        throw error;
      }
      edited++;
      if (writable(before)) assert.ok(writable(after), JSON.stringify(after.description));
      assert.equal(getTag(after, n)?.value ?? null, v || null);
      assert.deepEqual(after.dueDate, before.dueDate);
      const others = (i: Item) => i.tags.filter((t) => t !== getTag(i, n));
      assert.deepEqual(others(after), others(before));
    }), { numRuns: RUNS });
    done();
  });

  test('removeTag removes the tag and changes nothing else that counts', () => {
    fc.assert(fc.property(text, name, (description, n) => {
      const before = item(description);
      let after: Item;
      try {
        after = removeTag(before, n);
      } catch (error) {
        if (error instanceof XitEditError) return;
        throw error;
      }
      edited++;
      if (writable(before)) assert.ok(writable(after), JSON.stringify(after.description));
      assert.equal(getTag(after, n), undefined);
      assert.deepEqual(after.dueDate, before.dueDate);
      assert.deepEqual(after.tags, before.tags.filter((t) => t.name.toLowerCase() !== n.toLowerCase()));
    }), { numRuns: RUNS });
    done();
  });

  test('setDueDate sets the due date and changes no tag', () => {
    const date = fc.constantFrom('2026-11-04', '2026', '2026/W45', null);
    fc.assert(fc.property(text, date, (description, d) => {
      const before = item(description);
      let after: Item;
      try {
        after = setDueDate(before, d);
      } catch (error) {
        if (error instanceof XitEditError) return;
        throw error;
      }
      edited++;
      if (writable(before)) assert.ok(writable(after), JSON.stringify(after.description));
      assert.equal(after.dueDate?.text ?? null, d);
      assert.deepEqual(after.tags, before.tags);
    }), { numRuns: RUNS });
    done();
  });
});
