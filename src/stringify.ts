import { charAt, isBlankChar, isBlankLine } from './chars.ts';
import { XitStringifyError } from './errors.ts';
import { INDENT, PRIORITY, STATUS_CHARS, descriptionProblem, sameContent } from './item.ts';
import { parse } from './parse.ts';
import type { Block, Item, Newline, Title, XitDocument } from './types.ts';

export interface StringifyOptions {
  /** Overrides the document's `newline`. */
  newline?: Newline;
  /** Overrides the document's `finalNewline`. */
  finalNewline?: boolean;
}

/**
 * Writes a document as [x]it! text. Throws a `XitStringifyError` rather than
 * write something that wouldn't read back as the same document.
 *
 * Items are written from their `status`, `priority` and `description`. An
 * item's `raw` source is used instead when it still reads back as the same,
 * so unchanged items keep their formatting.
 */
export function stringify(document: XitDocument, options: StringifyOptions = {}): string {
  const newline = options.newline ?? document.newline ?? '\n';
  const finalNewline = options.finalNewline ?? document.finalNewline ?? true;
  const { blocks } = document;
  const lines: Array<{ text: string; block: number }> = [];

  blocks.forEach((block, index) => {
    const fail = (message: string): never => {
      throw new XitStringifyError(message, index);
    };
    for (const text of blockLines(block, blocks[index - 1], fail)) lines.push({ text, block: index });
  });

  const last = blocks.at(-1);
  if (!finalNewline && last?.type === 'blank' && (last.raw ?? '') === '') {
    throw new XitStringifyError(
      "A document without a final newline can't end with an empty blank line: it would read back without it, with a final newline.",
      blocks.length - 1,
    );
  }
  if (newline === '\n') {
    lines.forEach(({ text, block }, i) => {
      if (text.endsWith('\r') && (finalNewline || i < lines.length - 1)) {
        throw new XitStringifyError(
          'This line ends in a carriage return, which would be read back as part of a \\r\\n line ending.',
          block,
        );
      }
    });
  }

  if (!document.bom && lines[0]?.text.startsWith('\uFEFF')) {
    throw new XitStringifyError(
      "The first line can't start with U+FEFF unless the document has a byte-order mark (`bom: true`): it would read back as one.",
      lines[0].block,
    );
  }
  if (lines.length === 0) return document.bom ? '\uFEFF' : '';
  const body = lines.map((l) => l.text).join(newline);
  return (document.bom ? '\uFEFF' : '') + body + (finalNewline ? newline : '');
}

function blockLines(block: Block, previous: Block | undefined, fail: (message: string) => never): string[] {
  switch (block.type) {
    case 'item':
      return itemLines(block, fail);
    case 'title':
      checkTitle(block, previous, fail);
      return [block.text];
    case 'blank': {
      const raw = block.raw ?? '';
      if (raw.includes('\n')) fail('A blank line must be a single line.');
      if (!isBlankLine(raw)) fail(`A blank line can only contain whitespace, not ${JSON.stringify(raw)}.`);
      return [raw];
    }
    case 'invalid':
      if (block.raw.includes('\n')) fail('An invalid line must be a single line.');
      return [block.raw];
    default:
      return fail(`Unknown block type: ${JSON.stringify((block as { type: unknown }).type)}.`);
  }
}

function checkTitle(title: Title, previous: Block | undefined, fail: (message: string) => never) {
  const { text } = title;
  if (isBlankLine(text)) fail("A title can't be blank.");
  if (text.includes('\n')) fail('A title must be a single line.');
  if (isBlankChar(charAt(text, 0))) fail("A title can't start with whitespace.");
  if (text.startsWith('[')) fail("A title can't start with '['.");
  if (previous && previous.type !== 'blank') fail('A title must be the first block, or come after a blank line.');
}

function itemLines(item: Item, fail: (message: string) => never): string[] {
  const { status, priority, description } = item;
  const box = Object.hasOwn(STATUS_CHARS, status) ? STATUS_CHARS[status] : undefined;
  if (box === undefined) fail(`Unknown status: ${JSON.stringify(status)}.`);
  if (!Number.isInteger(priority) || priority < 0) fail(`The priority must be a whole number, 0 or more, not ${priority}.`);

  const problem = descriptionProblem(description);
  if (problem) fail(problem);
  const [first = '', ...rest] = description.split('\n');

  if (item.raw !== undefined && sameItem(item.raw, item)) return item.raw.split('\n');

  // With no priority, a description that starts like one ('!! a', '...') would
  // read back as a priority. A dot is a priority marker with no !s, so writing
  // one first keeps the description intact: '[ ] . !! a'.
  let marker = priority > 0 ? '!'.repeat(priority) : '';
  if (priority === 0 && PRIORITY.test(first)) marker = '.';
  const head = `[${box}]` + (marker ? ` ${marker}` : '') + (first === '' ? '' : ` ${first}`);
  return [head, ...rest.map((line) => INDENT + line)];
}

/** Whether `raw` reads back as exactly this item. */
function sameItem(raw: string, item: Item): boolean {
  const { blocks } = parse(raw);
  const [only] = blocks;
  return blocks.length === 1 && only?.type === 'item' && sameContent(only, item);
}
