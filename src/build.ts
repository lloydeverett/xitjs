import { makeItem } from './item.ts';
import type { Block, Item, Status, XitDocument } from './types.ts';

export interface ItemInit {
  status?: Status;
  priority?: number;
  description?: string;
}

export interface GroupInit {
  title?: string | null;
  items?: ReadonlyArray<string | ItemInit>;
}

/** Makes an item, open with no priority by default. A string is its description. */
export function createItem(init: string | ItemInit = {}): Item {
  const { status = 'open', priority = 0, description = '' } = typeof init === 'string' ? { description: init } : init;
  return makeItem(status, priority, description);
}

/**
 * Returns a copy of `item` with `changes` applied and its tags and due date
 * worked out again. It keeps the item's `raw` source, which `stringify` uses
 * only if the item still matches it.
 */
export function updateItem(item: Item, changes: ItemInit): Item {
  return makeItem(
    changes.status ?? item.status,
    changes.priority ?? item.priority,
    changes.description ?? item.description,
    item.raw,
  );
}

/** Makes a document of groups, with a blank line between each. */
export function createDocument(groups: readonly GroupInit[] = []): XitDocument {
  const blocks: Block[] = [];
  groups.forEach((group, index) => {
    if (index > 0) blocks.push({ type: 'blank' });
    if (group.title != null) blocks.push({ type: 'title', text: group.title });
    for (const item of group.items ?? []) blocks.push(createItem(item));
  });
  return { blocks, newline: '\n', finalNewline: true, bom: false };
}
