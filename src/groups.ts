// Reading and editing a document by its groups.
//
// The document stays a flat list of blocks; these helpers find the blocks a
// change touches. Each tries the tidiest change first, and keeps it only if
// the document can still be written and reading it back gives exactly the
// intended groups. So an edit never quietly changes anything else, such as
// two groups running together, or a title no longer counting as one.

import { itemFrom, type GroupInit, type ItemInit } from './build.ts';
import { XitEditError, XitStringifyError } from './errors.ts';
import { parse } from './parse.ts';
import { stringify } from './stringify.ts';
import type { BlankLine, Block, Group, Item, Title, XitDocument } from './types.ts';

/**
 * Splits a document into groups: runs of items, each with an optional title
 * before it. Blank and invalid lines end a group. The items are the
 * document's own blocks, and each group says which blocks are its own.
 */
export function getGroups(document: XitDocument): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const [index, block] of document.blocks.entries()) {
    if (block.type === 'title') {
      current = { title: block.text, items: [], start: index, end: index + 1 };
      groups.push(current);
    } else if (block.type === 'item') {
      if (!current) {
        current = { title: null, items: [], start: index, end: index };
        groups.push(current);
      }
      current.items.push(block);
      current.end = index + 1;
    } else {
      current = null;
    }
  }
  return groups;
}

/**
 * Adds an item to a group (an index into `getGroups`), at the end or at
 * `position` among its items. The item can be its text, an `ItemInit`, or an
 * item (which keeps its formatting).
 */
export function addItem(document: XitDocument, group: number, item: string | ItemInit | Item, position?: number): XitDocument {
  const groups = getGroups(document);
  const target = groupAt(groups, group);
  const added = itemFrom(item);
  const at = positionIn(target, position);
  const index = at < target.items.length ? document.blocks.indexOf(target.items[at]!) : target.end;
  const expected = shapes(groups);
  expected[group]!.items.splice(at, 0, added);
  return attempt(document, [spliced(document.blocks, index, 0, added)], expected, 'add the item');
}

/**
 * Removes an item (one of the document's own blocks). A group without a
 * title goes with its last item, along with a blank line next to it.
 */
export function removeItem(document: XitDocument, item: Item): XitDocument {
  const index = indexOfItem(document, item);
  const groups = getGroups(document);
  const from = groups.findIndex((g) => g.items.includes(item));
  const source = groups[from]!;
  if (source.title === null && source.items.length === 1) return removeGroupAt(document, groups, from, 'remove the item');
  const expected = shapes(groups);
  expected[from]!.items = source.items.filter((i) => i !== item);
  return attempt(document, [spliced(document.blocks, index, 1)], expected, 'remove the item');
}

/**
 * Moves an item (one of the document's own blocks) to a group, at the end or
 * so that it ends up at `position` among the group's items. It keeps its
 * formatting. A group without a title goes when its last item leaves it.
 */
export function moveItem(document: XitDocument, item: Item, group: number, position?: number): XitDocument {
  indexOfItem(document, item);
  const target = groupAt(getGroups(document), group);
  positionIn(target, position);
  // Something that identifies the target group once the item is gone.
  const anchor: Block | undefined = target.title !== null
    ? document.blocks[target.start]
    : target.items.find((i) => i !== item);
  // The item is its group's only item, and stays in it.
  if (!anchor) return document;
  const removed = removeItem(document, item);
  const after = getGroups(removed);
  const index = after.findIndex((g) => removed.blocks[g.start] === anchor || g.items.includes(anchor as Item));
  return addItem(removed, index, item, position);
}

/**
 * Adds a group at the end, or before the group at `index`, with a blank line
 * to separate it. It needs a title or at least one item.
 */
export function addGroup(document: XitDocument, init: GroupInit, index?: number): XitDocument {
  const groups = getGroups(document);
  const at = index ?? groups.length;
  if (!Number.isInteger(at) || at < 0 || at > groups.length) {
    throw new XitEditError(`There's no place for a group at ${at}: the document has ${groups.length} groups.`);
  }
  const blocks: Block[] = (init.items ?? []).map(itemFrom);
  if (init.title != null) blocks.unshift({ type: 'title', text: init.title } satisfies Title);
  if (blocks.length === 0) throw new XitEditError('A group needs a title or an item.');
  return insertGroup(document, groups, at, blocks, 'add the group');
}

/**
 * Removes a group (an index into `getGroups`): its title and items, any
 * invalid lines straight after them, and a blank line next to it.
 */
export function removeGroup(document: XitDocument, group: number): XitDocument {
  const groups = getGroups(document);
  groupAt(groups, group);
  return removeGroupAt(document, groups, group, 'remove the group', withTrailingInvalid);
}

/**
 * Moves a group so that it ends up at index `to`, keeping its formatting. Any
 * invalid lines straight after its items go with it.
 */
export function moveGroup(document: XitDocument, from: number, to: number): XitDocument {
  const groups = getGroups(document);
  const moving = groupAt(groups, from);
  groupAt(groups, to);
  if (from === to) return document;
  const blocks = document.blocks.slice(moving.start, withTrailingInvalid(document.blocks, moving));
  const removed = removeGroupAt(document, groups, from, 'move the group', withTrailingInvalid);
  return insertGroup(removed, getGroups(removed), to, blocks, 'move the group');
}

/**
 * Sets a group's title, adding a blank line before it if it needs one. `null`
 * removes the title; a group with no items then goes too.
 */
export function setGroupTitle(document: XitDocument, group: number, title: string | null): XitDocument {
  const groups = getGroups(document);
  const target = groupAt(groups, group);
  if (title === target.title) return document;
  const blocks = document.blocks;
  if (title === null && target.items.length === 0) return removeGroupAt(document, groups, group, 'remove the title');

  const expected = shapes(groups);
  expected[group]!.title = title;
  const titleBlock: Title = { type: 'title', text: title ?? '' };
  const candidates = target.title !== null
    ? [title === null ? spliced(blocks, target.start, 1) : spliced(blocks, target.start, 1, titleBlock)]
    : [spliced(blocks, target.start, 0, titleBlock), spliced(blocks, target.start, 0, blank(), titleBlock)];
  return attempt(document, candidates, expected, title === null ? 'remove the title' : 'set the title');
}

// Helpers ---------------------------------------------------------------------

/** A group by value: its title and its items. */
interface Shape {
  title: string | null;
  items: Item[];
}

function shapes(groups: readonly Group[]): Shape[] {
  return groups.map((g) => ({ title: g.title, items: [...g.items] }));
}

/**
 * The first candidate document that can be written and reads back with
 * exactly the expected groups (items compared by status, priority and
 * description). Otherwise throws a `XitEditError`: if no candidate could be
 * written at all, it says why.
 */
function attempt(document: XitDocument, candidates: readonly Block[][], expected: readonly Shape[], what: string): XitDocument {
  let unwritable: string | null = null;
  let anyWritten = false;
  for (const blocks of candidates) {
    const next = { ...document, blocks };
    let text: string;
    try {
      text = stringify(next);
    } catch (error) {
      if (!(error instanceof XitStringifyError)) throw error;
      unwritable ??= error.reason;
      continue;
    }
    anyWritten = true;
    if (sameShapes(getGroups(parse(text)), expected)) return next;
  }
  const why = !anyWritten && unwritable ? `. ${unwritable}` : ' without changing the rest of the document.';
  throw new XitEditError(`Couldn't ${what}${why}`);
}

function sameShapes(groups: readonly Group[], expected: readonly Shape[]): boolean {
  return groups.length === expected.length && groups.every((g, i) => {
    const e = expected[i]!;
    return g.title === e.title && g.items.length === e.items.length && g.items.every((item, j) => {
      const other = e.items[j]!;
      return item.status === other.status && item.priority === other.priority && item.description === other.description;
    });
  });
}

/** Where a group's blocks end, past any invalid lines straight after them. */
function withTrailingInvalid(blocks: readonly Block[], group: Group): number {
  let end = group.end;
  while (blocks[end]?.type === 'invalid') end++;
  return end;
}

/**
 * Removes a group's blocks (up to `endOf`, by default its own end), and a
 * blank line before or after them if there is one.
 */
function removeGroupAt(
  document: XitDocument,
  groups: readonly Group[],
  group: number,
  what: string,
  endOf: (blocks: readonly Block[], group: Group) => number = (_, g) => g.end,
): XitDocument {
  const blocks = document.blocks;
  const { start } = groups[group]!;
  const end = endOf(blocks, groups[group]!);
  const candidates: Block[][] = [];
  if (blocks[start - 1]?.type === 'blank') candidates.push(spliced(blocks, start - 1, end - start + 1));
  if (blocks[end]?.type === 'blank') candidates.push(spliced(blocks, start, end - start + 1));
  candidates.push(spliced(blocks, start, end - start));
  const expected = shapes(groups);
  expected.splice(group, 1);
  return attempt(document, candidates, expected, what);
}

/** Inserts a group's blocks before the group at `index` (or at the end), separated by blank lines. */
function insertGroup(document: XitDocument, groups: readonly Group[], index: number, group: Block[], what: string): XitDocument {
  const blocks = document.blocks;
  let candidates: Block[][];
  if (index < groups.length) {
    const at = groups[index]!.start;
    candidates = [spliced(blocks, at, 0, ...group, blank()), spliced(blocks, at, 0, blank(), ...group, blank())];
  } else {
    // After the last group, so blank lines at the end of the document stay there.
    const at = groups.length > 0 ? groups[groups.length - 1]!.end : blocks.length;
    const plain = spliced(blocks, at, 0, ...group);
    const separated = spliced(blocks, at, 0, blank(), ...group);
    const before = blocks[at - 1];
    candidates = before === undefined || before.type === 'blank' ? [plain, separated] : [separated, plain];
  }
  const expected = shapes(groups);
  const title = group[0]?.type === 'title' ? group[0].text : null;
  expected.splice(index, 0, { title, items: group.filter((b): b is Item => b.type === 'item') });
  return attempt(document, candidates, expected, what);
}

function groupAt(groups: readonly Group[], index: number): Group {
  const group = Number.isInteger(index) ? groups[index] : undefined;
  if (!group) throw new XitEditError(`There's no group ${index}: the document has ${groups.length} groups.`);
  return group;
}

/** Where among a group's items `position` falls: past the end means the end. */
function positionIn(group: Group, position: number | undefined): number {
  if (position === undefined) return group.items.length;
  if (!Number.isInteger(position) || position < 0) throw new XitEditError(`Not a position in a group: ${position}.`);
  return Math.min(position, group.items.length);
}

function indexOfItem(document: XitDocument, item: Item): number {
  const index = document.blocks.indexOf(item);
  if (index === -1) throw new XitEditError("That item isn't in this document (pass one of its own blocks).");
  return index;
}

function spliced<T>(array: readonly T[], start: number, deleteCount: number, ...items: T[]): T[] {
  const copy = array.slice();
  copy.splice(start, deleteCount, ...items);
  return copy;
}

function blank(): BlankLine {
  return { type: 'blank' };
}
