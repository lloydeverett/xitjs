import type { Item, Tag, XitDocument } from './types.ts';

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
  return item.tags.find((tag) => tagNamesEqual(tag.name, name));
}

/** Whether the item has a tag with this name (case-insensitive). */
export function hasTag(item: Pick<Item, 'tags'>, name: string): boolean {
  return getTag(item, name) !== undefined;
}
