import type { Group, Item, Tag, XitDocument } from './types.ts';

/**
 * Splits a document into groups: runs of items, each with an optional title
 * before it. Blank and invalid lines end a group. The items are the
 * document's own blocks, so they can be found again in `document.blocks`.
 */
export function getGroups(document: XitDocument): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const block of document.blocks) {
    if (block.type === 'title') {
      current = { title: block.text, items: [] };
      groups.push(current);
    } else if (block.type === 'item') {
      if (!current) {
        current = { title: null, items: [] };
        groups.push(current);
      }
      current.items.push(block);
    } else {
      current = null;
    }
  }
  return groups;
}

/** All the document's items, in order. */
export function getItems(document: XitDocument): Item[] {
  return document.blocks.filter((block): block is Item => block.type === 'item');
}

/** A tag name with its case folded (upper then lower case, so `ß` matches `SS`). */
function foldCase(name: string): string {
  return name.toUpperCase().toLowerCase();
}

/** Whether two tag names are the same tag (names are case-insensitive). */
export function tagNamesEqual(a: string, b: string): boolean {
  return foldCase(a) === foldCase(b);
}

/** The item's first tag with this name (case-insensitive), or `undefined`. */
export function getTag(item: Pick<Item, 'tags'>, name: string): Tag | undefined {
  const folded = foldCase(name);
  return item.tags.find((tag) => foldCase(tag.name) === folded);
}

/** Whether the item has a tag with this name (case-insensitive). */
export function hasTag(item: Pick<Item, 'tags'>, name: string): boolean {
  return getTag(item, name) !== undefined;
}
