/** The status an item's checkbox shows: `[ ]`, `[x]`, `[@]`, `[~]` or `[?]`. */
export type Status = 'open' | 'checked' | 'ongoing' | 'obsolete' | 'in-question';

/**
 * A parsed [x]it! document: a flat list of blocks, one per line, except that
 * an item spans its continuation lines.
 *
 * The formatting fields are set by `parse` so `stringify` can write the
 * document back exactly as it was read. When they're absent `stringify` uses
 * `'\n'`, a final newline, and no byte-order mark.
 */
export interface XitDocument {
  blocks: Block[];
  /** The line ending to write. */
  newline?: Newline;
  /** Whether the last line ends with a newline (the spec recommends one). */
  finalNewline?: boolean;
  /** Whether the source started with a UTF-8 byte-order mark. */
  bom?: boolean;
}

export type Newline = '\n' | '\r\n';

export type Block = Title | Item | BlankLine | InvalidLine;

/** A group's title: one line, not starting with whitespace or `[`. */
export interface Title {
  type: 'title';
  text: string;
}

/**
 * A todo item.
 *
 * `stringify` writes only `status`, `priority` and `description`. `tags` and
 * `dueDate` are derived from the description: `parse`, `createItem` and
 * `updateItem` fill them in.
 */
export interface Item {
  type: 'item';
  status: Status;
  /** The number of `!`s in the priority marker; 0 when there's no priority. */
  priority: number;
  /**
   * The description, with continuation lines joined by `'\n'` and their
   * four-space indentation removed. Spaces beyond the one separating it from
   * the checkbox or priority belong to it.
   */
  description: string;
  /** The description's tags, in order. */
  readonly tags: readonly Tag[];
  /** The description's first valid due date. */
  readonly dueDate: DueDate | null;
  /**
   * The item's source lines, joined by `'\n'`. `stringify` writes this
   * instead of formatting the item afresh, so long as it still reads back as
   * the same status, priority and description.
   */
  raw?: string;
}

/** A line that is empty or only whitespace. It separates groups. */
export interface BlankLine {
  type: 'blank';
  /** The whitespace on the line, if any, written back as it was read. */
  raw?: string;
}

/** A line that isn't valid [x]it!. It's kept so that it's written back unchanged. */
export interface InvalidLine {
  type: 'invalid';
  raw: string;
}

export interface Tag {
  /** The name as written; compare names case-insensitively (`tagNamesEqual`). */
  name: string;
  /** The value, or `null` when it's absent or empty (`#tag`, `#tag=`, `#tag=""`). */
  value: string | null;
}

interface DueDateBase {
  /** The date as written, without the `-> ` prefix, e.g. `2022/W01`. */
  text: string;
  /** The last day of the period, as `YYYY-MM-DD`. Strings in this form sort chronologically. */
  date: string;
}

export type DueDate = DueDateBase &
  (
    | { period: 'day'; year: number; month: number; day: number }
    | { period: 'week'; year: number; week: number }
    | { period: 'month'; year: number; month: number }
    | { period: 'quarter'; year: number; quarter: number }
    | { period: 'year'; year: number }
  );

export type DueDatePeriod = DueDate['period'];

/** A piece of a description: plain text, a tag, or the due date. */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'tag'; text: string; tag: Tag }
  | { type: 'due-date'; text: string; dueDate: DueDate };

export interface ParsedDescription {
  tags: Tag[];
  dueDate: DueDate | null;
  /** The description split into pieces; joining their `text` gives it back unchanged. */
  segments: Segment[];
}

/** A title and the items under it, as the spec defines a group. */
export interface Group {
  title: string | null;
  items: Item[];
}

export type DiagnosticCode =
  // Errors: the line is not valid, and becomes an `InvalidLine`.
  | 'invalid-checkbox'
  | 'missing-space-after-checkbox'
  | 'bad-indentation'
  | 'title-without-blank-line'
  | 'description-not-on-first-line'
  // Warnings: valid, but probably not what was meant.
  | 'malformed-priority'
  | 'misplaced-priority'
  | 'invalid-due-date'
  | 'extra-due-date'
  | 'unclosed-tag-value'
  | 'missing-final-newline'
  | 'mixed-newlines';

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  message: string;
  /** UTF-16 offset of the start of the problem in the source (as CodeMirror and `String#slice` count). */
  from: number;
  /** UTF-16 offset just past the end of the problem. */
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 1-based column of `from`, in UTF-16 code units. */
  column: number;
}
