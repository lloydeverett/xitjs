import { parseDescription } from './description.ts';
import type { Item, Status } from './types.ts';

export const STATUS_CHARS: Readonly<Record<Status, string>> = {
  open: ' ',
  checked: 'x',
  ongoing: '@',
  obsolete: '~',
  'in-question': '?',
};

export const STATUS_BY_CHAR: Readonly<Record<string, Status>> = Object.fromEntries(
  Object.entries(STATUS_CHARS).map(([status, char]) => [char, status as Status]),
);

/**
 * A priority marker: !s padded with dots on one side, or only dots. It counts
 * only when a space or the end of the line follows it.
 */
export const PRIORITY = /^(?:\.*!+|!+\.+|\.+)(?= |$)/;

/** An item with its derived fields worked out from its description. */
export function makeItem(status: Status, priority: number, description: string, raw?: string): Item {
  const { tags, dueDate } = parseDescription(description);
  const item: Item = { type: 'item', status, priority, description, tags, dueDate };
  if (raw !== undefined) item.raw = raw;
  return item;
}
