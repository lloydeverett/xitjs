import { charAt, isBlankChar, isBlankLine } from './chars.ts';
import { scanDescription } from './description.ts';
import { XitParseError } from './errors.ts';
import { PRIORITY, STATUS_BY_CHAR, makeItem } from './item.ts';
import type { Block, Diagnostic, DiagnosticCode, Newline, Status, XitDocument } from './types.ts';

export interface ParseOptions {
  /** Throw a `XitParseError` if the source has any errors, rather than keeping them as invalid lines. */
  strict?: boolean;
}

/**
 * Parses a [x]it! document. Never throws unless `strict` is set: lines that
 * aren't valid become `InvalidLine` blocks, and `validate` reports them.
 */
export function parse(source: string, options: ParseOptions = {}): XitDocument {
  const { document, diagnostics } = parseWithDiagnostics(source);
  if (options.strict) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) throw new XitParseError(errors);
  }
  return document;
}

/** Reports everything wrong with a document (errors), or probably not meant (warnings). */
export function validate(source: string): Diagnostic[] {
  return parseWithDiagnostics(source).diagnostics;
}

const CHECKBOX = /^\[([ x@~?])\](?: |$)/;
const CHECKBOX_WITHOUT_SPACE = /^\[[ x@~?]\]/;
const INDENT = '    ';

const MESSAGES: Record<DiagnosticCode, string> = {
  'invalid-checkbox': "Not a valid checkbox: use [ ], [x], [@], [~] or [?]. (A title can't start with '['.)",
  'missing-space-after-checkbox': 'A checkbox must be followed by a space or the end of the line.',
  'bad-indentation': "Only an item's continuation lines can be indented, by exactly four spaces.",
  'title-without-blank-line': 'A title must be the first line, or come after a blank line.',
  'misplaced-priority':
    "This isn't a priority: a priority must follow the checkbox and exactly one space, so this is part of the description.",
  'malformed-priority':
    "This isn't a priority: dots may only pad the !s on one side (like ..! or !!.), so this is part of the description.",
  'invalid-due-date':
    "This isn't a due date: '-> ' must be followed by a valid yyyy-mm-dd, yyyy-mm, yyyy, yyyy-Www or yyyy-Qq (with one kind of separator), then a space, punctuation or the end of the line.",
  'extra-due-date': 'An item has only one due date; this one is ignored.',
  'unclosed-tag-value': "The tag value's closing quote is missing, so the tag has no value.",
  'missing-final-newline': 'The file should end with a newline.',
  'mixed-newlines': "The file mixes \\n and \\r\\n line endings; it will be written with the first one it uses.",
};

interface Line {
  text: string;
  /** Offset of the line's first character in the source. */
  start: number;
}

interface PendingItem {
  status: Status;
  priority: number;
  /** Whether the first line has a priority marker (which may be only dots, so priority 0). */
  hasMarker: boolean;
  /** The description's lines, and where each starts in the source. */
  parts: Array<{ text: string; start: number }>;
  rawLines: string[];
}

function parseWithDiagnostics(source: string): { document: XitDocument; diagnostics: Diagnostic[] } {
  const bom = source.startsWith('\uFEFF');
  const { lines, newline, finalNewline, mixedAt } = splitLines(source, bom ? 1 : 0);
  const lineStarts = lines.map((l) => l.start);
  const diagnostics: Diagnostic[] = [];
  const report = (severity: Diagnostic['severity'], code: DiagnosticCode, from: number, to: number, message?: string) => {
    const line = lineIndexAt(lineStarts, from);
    diagnostics.push({
      severity, code, message: message ?? MESSAGES[code], from, to,
      line: line + 1, column: from - (lineStarts[line] ?? 0) + 1,
    });
  };

  const blocks: Block[] = [];
  let pending: PendingItem | null = null;
  let previous: 'start' | 'blank' | 'title' | 'item' | 'invalid' = 'start';

  const flush = () => {
    if (!pending) return;
    blocks.push(finishItem(pending, report));
    pending = null;
  };
  const invalid = (line: Line, code: DiagnosticCode, message?: string) => {
    flush();
    blocks.push({ type: 'invalid', raw: line.text });
    report('error', code, line.start, line.start + line.text.length, message);
    previous = 'invalid';
  };

  for (const line of lines) {
    const { text } = line;
    if (isBlankLine(text)) {
      flush();
      blocks.push({ type: 'blank', raw: text });
      previous = 'blank';
    } else if (text.startsWith('[')) {
      const match = CHECKBOX.exec(text);
      if (!match) {
        invalid(line, CHECKBOX_WITHOUT_SPACE.test(text) ? 'missing-space-after-checkbox' : 'invalid-checkbox');
        continue;
      }
      flush();
      pending = startItem(line, STATUS_BY_CHAR[match[1]!]!);
      previous = 'item';
    } else if (pending && text.startsWith(INDENT)) {
      pending.parts.push({ text: text.slice(INDENT.length), start: line.start + INDENT.length });
      pending.rawLines.push(text);
    } else if (isBlankChar(charAt(text, 0))) {
      invalid(line, 'bad-indentation', previous === 'item'
        ? 'A continuation line must be indented by exactly four spaces.'
        : undefined);
    } else if (previous === 'start' || previous === 'blank') {
      flush();
      blocks.push({ type: 'title', text });
      previous = 'title';
    } else {
      invalid(line, 'title-without-blank-line', previous === 'title'
        ? 'A group has at most one title: a title must be the first line, or come after a blank line.'
        : undefined);
    }
  }
  flush();

  if (mixedAt !== null) report('warning', 'mixed-newlines', mixedAt, mixedAt + 1);
  if (!finalNewline && lines.length > 0) report('warning', 'missing-final-newline', source.length, source.length);

  diagnostics.sort((a, b) => a.from - b.from);
  return { document: { blocks, newline, finalNewline, bom }, diagnostics };
}

function startItem(line: Line, status: Status): PendingItem {
  // After '[x]' there's nothing, or one space and then the rest.
  const rest = line.text.slice(4);
  const restStart = line.start + 4;
  const marker = PRIORITY.exec(rest)?.[0];
  if (marker === undefined) {
    return { status, priority: 0, hasMarker: false, parts: [{ text: rest, start: restStart }], rawLines: [line.text] };
  }
  const skip = Math.min(marker.length + 1, rest.length);
  return {
    status,
    priority: [...marker].filter((c) => c === '!').length,
    hasMarker: true,
    parts: [{ text: rest.slice(skip), start: restStart + skip }],
    rawLines: [line.text],
  };
}

const SPACES_THEN_PRIORITY = /^( +)((?:\.*!+|!+\.+|\.+))(?= |$)/;
const DOTS_AND_BANGS = /^[.!]*(?:\.!|!\.)[.!]*(?= |$)/;

function finishItem(
  pending: PendingItem,
  report: (severity: 'warning', code: DiagnosticCode, from: number, to: number) => void,
) {
  const description = pending.parts.map((p) => p.text).join('\n');
  const first = pending.parts[0]!;

  if (!pending.hasMarker) {
    const misplaced = SPACES_THEN_PRIORITY.exec(first.text);
    const malformed = DOTS_AND_BANGS.exec(first.text);
    if (misplaced) {
      const from = first.start + misplaced[1]!.length;
      report('warning', 'misplaced-priority', from, from + misplaced[2]!.length);
    } else if (malformed) {
      report('warning', 'malformed-priority', first.start, first.start + malformed[0].length);
    }
  }

  // Map offsets in the description back to the source.
  const toSource = (offset: number) => {
    let consumed = 0;
    for (const part of pending.parts) {
      if (offset <= consumed + part.text.length) return part.start + offset - consumed;
      consumed += part.text.length + 1;
    }
    return first.start + offset;
  };
  for (const problem of scanDescription(description).problems) {
    report('warning', problem.code, toSource(problem.from), toSource(problem.to));
  }
  return makeItem(pending.status, pending.priority, description, pending.rawLines.join('\n'));
}

function splitLines(source: string, offset: number) {
  const lines: Line[] = [];
  let newline: Newline | null = null;
  let mixedAt: number | null = null;
  const pattern = /\r?\n/g;
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

function lineIndexAt(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return Math.max(low, 0);
}
