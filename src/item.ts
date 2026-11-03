import { isBlankLine } from './chars.ts';
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

/** `[ ]`, `[x]` and so on are three characters wide. */
export const CHECKBOX_WIDTH = 3;

/** A status's checkbox, as it's written: `[`, its character, `]` (`CHECKBOX_WIDTH` long). */
export function checkbox(status: Status): string {
  return `[${STATUS_CHARS[status]}]`;
}

/** The indentation of a description's continuation lines. */
export const INDENT = '    ';

// Built from STATUS_CHARS, so a status is defined in one place. None of the
// characters is special inside a character class.
const STATUS_CLASS = `[${Object.values(STATUS_CHARS).join('')}]`;

/** A checkbox, then a space or the end of the line; the status character is captured. */
export const CHECKBOX = new RegExp(`^\\[(${STATUS_CLASS})\\](?: |$)`);

/** A checkbox, whatever follows it. */
export const CHECKBOX_ANYHOW = new RegExp(`^\\[${STATUS_CLASS}\\]`);

/** A priority marker: !s padded with dots on one side, or only dots. */
const PRIORITY_MARKER = String.raw`(?:\.*!+|!+\.+|\.+)`;

/** A priority marker that counts as one: a space or the end of the line follows it. */
export const PRIORITY = new RegExp(`^${PRIORITY_MARKER}(?= |$)`);

/** Spaces, then what would be a priority marker if the spaces weren't there. */
export const SPACES_THEN_PRIORITY = new RegExp(`^( +)(${PRIORITY_MARKER})(?= |$)`);

/**
 * Why a description can't be written as an item, or null if it can. Its
 * continuation lines can't be blank (a blank line ends the item), and it must
 * start on the item's first line, so a blank first line can't continue.
 */
export function descriptionProblem(description: string): string | null {
  const [first = '', ...rest] = description.split('\n');
  if (rest.length > 0 && isBlankLine(first)) {
    return "A description must start on the item's first line: this one's first line is blank, but it continues on the next.";
  }
  if (rest.some(isBlankLine)) return "A description's continuation lines can't be blank: a blank line ends the item.";
  return null;
}

type ItemContent = Pick<Item, 'status' | 'priority' | 'description'>;

/**
 * Whether two items say the same: the same status, priority and description,
 * which is all that's written (their tags and due date follow from it).
 */
export function sameContent(a: ItemContent, b: ItemContent): boolean {
  return a.status === b.status && a.priority === b.priority && a.description === b.description;
}

/** An item with its derived fields worked out from its description. */
export function makeItem(status: Status, priority: number, description: string, raw?: string): Item {
  const { tags, dueDate } = parseDescription(description);
  const item: Item = { type: 'item', status, priority, description, tags, dueDate };
  if (raw !== undefined) item.raw = raw;
  return item;
}
