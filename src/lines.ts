// What each line of a document is. This is the one place that decides it:
// `parse` builds blocks from it, and `tokenizeLine` tokens.

import { charAt, isBlankChar, isBlankLine } from './chars.ts';
import { CHECKBOX, CHECKBOX_ANYHOW, CHECKBOX_WIDTH, INDENT, PRIORITY, STATUS_BY_CHAR } from './item.ts';
import type { DiagnosticCode, LineState, Newline, Status } from './types.ts';

export type LineKind =
  | { kind: 'blank' }
  | { kind: 'title' }
  | { kind: 'invalid'; code: DiagnosticCode; message?: string }
  /**
   * An item's first line. Its priority marker, if any, starts just past the
   * checkbox and a space; its description starts at `description`.
   */
  | { kind: 'item'; status: Status; marker: string | null; description: number }
  /** A continuation line of an item with this status: its description starts after `INDENT`. */
  | { kind: 'continuation'; status: Status };

/** The state at the start of a document, and after every blank line. */
export const START: LineState = Object.freeze({ item: 'none', previous: 'blank' });

const AFTER_TITLE: LineState = Object.freeze({ item: 'none', previous: 'title' });
const AFTER_INVALID: LineState = Object.freeze({ item: 'none', previous: 'invalid' });
const AFTER_BARE_ITEM: LineState = Object.freeze({ item: 'bare', previous: 'item' });
const AFTER_BARE_INVALID: LineState = Object.freeze({ item: 'bare', previous: 'invalid' });

/** What a line is, given the state the lines before it left, and the state after it. */
export function readLine(text: string, before: LineState): { line: LineKind; state: LineState } {
  if (isBlankLine(text)) return { line: { kind: 'blank' }, state: START };

  if (text.startsWith('[')) {
    const match = CHECKBOX.exec(text);
    if (!match) {
      const code = CHECKBOX_ANYHOW.test(text) ? 'missing-space-after-checkbox' : 'invalid-checkbox';
      return { line: { kind: 'invalid', code }, state: AFTER_INVALID };
    }
    // After the checkbox there's nothing, or one space and then the rest.
    const rest = text.slice(CHECKBOX_WIDTH + 1);
    const marker = PRIORITY.exec(rest)?.[0] ?? null;
    const skip = marker === null ? 0 : Math.min(marker.length + 1, rest.length);
    const description = Math.min(CHECKBOX_WIDTH + 1 + skip, text.length);
    // CHECKBOX is built from STATUS_CHARS, so its character always has a status.
    const status = STATUS_BY_CHAR[match[1]!]!;
    // A description must start on the first line, so an item without one can't continue.
    const after: LineState = isBlankLine(text.slice(description))
      ? AFTER_BARE_ITEM
      : Object.freeze({ item: 'open', previous: 'item', status, hasDueDate: false });
    return { line: { kind: 'item', status, marker, description }, state: after };
  }

  if (text.startsWith(INDENT)) {
    if (before.item === 'bare') {
      return { line: { kind: 'invalid', code: 'description-not-on-first-line' }, state: AFTER_BARE_INVALID };
    }
    if (before.item === 'open') return { line: { kind: 'continuation', status: before.status }, state: before };
  }

  if (isBlankChar(charAt(text, 0))) {
    const message = before.previous === 'item' ? 'A continuation line must be indented by exactly four spaces.' : undefined;
    return { line: invalid('bad-indentation', message), state: AFTER_INVALID };
  }
  if (before.previous === 'blank') return { line: { kind: 'title' }, state: AFTER_TITLE };

  const message = before.previous === 'title'
    ? 'A group has at most one title: a title must be the first line, or come after a blank line.'
    : undefined;
  return { line: invalid('title-without-blank-line', message), state: AFTER_INVALID };
}

function invalid(code: DiagnosticCode, message: string | undefined): LineKind {
  return message === undefined ? { kind: 'invalid', code } : { kind: 'invalid', code, message };
}

export interface Line {
  text: string;
  /** Offset of the line's first character in the source. */
  start: number;
}

/** Splits a source into lines at `\n` and `\r\n`, starting at `offset` (past a byte-order mark). */
export function splitLines(source: string, offset: number) {
  const lines: Line[] = [];
  let newline: Newline | null = null;
  let mixedAt: number | null = null;
  const pattern = /\r?\n/g;
  pattern.lastIndex = offset;
  let start = offset;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    lines.push({ text: source.slice(start, match.index), start });
    const found = match[0] as Newline;
    if (newline === null) newline = found;
    else if (found !== newline && mixedAt === null) mixedAt = match.index + found.length - 1;
    start = match.index + found.length;
  }
  const finalNewline = start === source.length && lines.length > 0;
  if (start < source.length) lines.push({ text: source.slice(start), start });
  return { lines, newline: newline ?? '\n', finalNewline, mixedAt };
}
