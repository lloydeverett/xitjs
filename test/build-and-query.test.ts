import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocument, createItem, getGroups, getItems, getTag, hasTag, parse, stringify, tagNamesEqual, updateItem,
} from '../src/index.ts';

describe('createItem', () => {
  test('defaults to an open item with no priority or description', () => {
    assert.deepEqual(createItem(), {
      type: 'item', status: 'open', priority: 0, description: '', tags: [], dueDate: null,
    });
  });

  test('a string is the description; tags and due date are worked out', () => {
    const item = createItem('Call #mum -> 2026-11-04');
    assert.deepEqual(item.tags, [{ name: 'mum', value: null }]);
    assert.equal(item.dueDate?.date, '2026-11-04');
  });

  test('takes a status, priority and description', () => {
    assert.deepEqual(createItem({ status: 'checked', priority: 2, description: 'Ship it' }), {
      type: 'item', status: 'checked', priority: 2, description: 'Ship it', tags: [], dueDate: null,
    });
  });
});

describe('updateItem', () => {
  test('returns a new item with the derived fields worked out again', () => {
    const item = createItem('Plain');
    const updated = updateItem(item, { description: 'Now #tagged -> 2026' });
    assert.notEqual(updated, item);
    assert.equal(item.description, 'Plain');
    assert.deepEqual(updated.tags, [{ name: 'tagged', value: null }]);
    assert.equal(updated.dueDate?.date, '2026-12-31');
  });

  test('keeps raw, so an unchanged item keeps its formatting', () => {
    const [item] = getItems(parse('[ ] ..! a\n'));
    assert.equal(stringify({ blocks: [updateItem(item!, {})] }), '[ ] ..! a\n');
    assert.equal(stringify({ blocks: [updateItem(item!, { status: 'checked' })] }), '[x] ! a\n');
  });
});

describe('createDocument', () => {
  test('groups, separated by blank lines', () => {
    const doc = createDocument([
      { title: 'Groceries', items: ['Milk', { description: 'Eggs', status: 'checked' }] },
      { items: ['Ungrouped'] },
      { title: 'Empty' },
    ]);
    assert.equal(stringify(doc), 'Groceries\n[ ] Milk\n[x] Eggs\n\n[ ] Ungrouped\n\nEmpty\n');
    assert.deepEqual(getGroups(doc).map((g) => [g.title, g.items.map((i) => i.description)]), [
      ['Groceries', ['Milk', 'Eggs']],
      [null, ['Ungrouped']],
      ['Empty', []],
    ]);
  });

  test('no groups is an empty document, which reads back the same', () => {
    assert.equal(stringify(createDocument()), '');
    assert.deepEqual(parse(stringify(createDocument())), createDocument());
  });
});

describe('getGroups', () => {
  test('items run together until a blank or invalid line; a title starts a group', () => {
    const doc = parse('[ ] a\n[ ] b\n\nT\n[ ] c\n    c2\nbad\n[ ] d\n\nEmpty\n\n\n[ ] e\n');
    assert.deepEqual(getGroups(doc).map((g) => [g.title, g.items.map((i) => i.description)]), [
      [null, ['a', 'b']],
      ['T', ['c\nc2']],
      [null, ['d']],
      ['Empty', []],
      [null, ['e']],
    ]);
  });

  test('the items are the blocks themselves, so they can be found in blocks', () => {
    const doc = parse('[ ] a\n');
    assert.equal(getGroups(doc)[0]?.items[0], doc.blocks[0]);
  });

  test('an empty document has no groups', () => {
    assert.deepEqual(getGroups(parse('\n\n')), []);
  });
});

describe('tags', () => {
  test('names are compared case-insensitively', () => {
    assert.ok(tagNamesEqual('Work', 'wORK'));
    assert.ok(tagNamesEqual('Straße', 'STRASSE'));
    assert.ok(!tagNamesEqual('work', 'works'));
    const item = createItem('#Due=today #due=tomorrow');
    assert.ok(hasTag(item, 'DUE'));
    assert.ok(!hasTag(item, 'other'));
    assert.deepEqual(getTag(item, 'due'), { name: 'Due', value: 'today' });
    assert.equal(getTag(item, 'other'), undefined);
  });
});
