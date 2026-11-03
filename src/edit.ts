// Editing an item's tags and due date by rewriting its description.
//
// Each edit tries the tidiest change first, re-reads the result, and keeps it
// only if exactly the intended tags and due date come back, and the item can
// still be written (if it could before). So an edit never quietly changes
// anything else, such as text next to a tag turning into a tag.

import { isBlankChar, isBlankLine, isTagName } from './chars.ts';
import { updateItem } from './build.ts';
import { parseDescription } from './description.ts';
import { parseDueDate } from './due-date.ts';
import { XitEditError } from './errors.ts';
import { descriptionProblem } from './item.ts';
import { tagNamesEqual } from './query.ts';
import type { DueDate, Item, Segment, Tag } from './types.ts';

/** A tag or due date in a description, and where it is. */
type Span = Exclude<Segment, { type: 'text' }> & { from: number; to: number };
type TagSpan = Extract<Span, { type: 'tag' }>;

/**
 * Sets a tag on an item. If the item already has the tag (names are
 * case-insensitive), its first occurrence is rewritten in place, keeping its
 * spelling; otherwise the tag is added at the end of the description. A
 * value of `null`, `undefined` or `''` means no value. Values are quoted only
 * when they need to be.
 *
 * Throws a `XitEditError` if the name isn't a valid tag name, or the value
 * can't be written (it contains a newline, or both kinds of quote).
 */
export function setTag(item: Item, name: string, value?: string | null): Item {
  if (!isTagName(name)) {
    throw new XitEditError(`Not a valid tag name: ${JSON.stringify(name)}. A name can only contain letters, digits, _ and -.`);
  }
  const wanted = value || null;
  const spellings = valueSpellings(wanted);
  const description = item.description;
  const check = checker(description);
  const tagSpans = spansOf(description).filter((s): s is TagSpan => s.type === 'tag');
  const tags = tagSpans.map((s) => s.tag);
  const index = tagSpans.findIndex((s) => tagNamesEqual(s.tag.name, name));
  const existing = tagSpans[index];

  for (const spelling of spellings) {
    const edited = existing
      ? splice(description, existing.from, existing.to, `#${existing.tag.name}${spelling}`)
      : append(description, `#${name}${spelling}`);
    const expected = existing
      ? tags.map((tag, i) => (i === index ? { name: existing.tag.name, value: wanted } : tag))
      : [...tags, { name, value: wanted }];
    if (check(edited, expected)) return updateItem(item, { description: edited });
  }
  throw new XitEditError(`Couldn't set #${name} without changing the rest of the description.`);
}

/** Removes every occurrence of a tag (case-insensitive), with the space next to it. */
export function removeTag(item: Item, name: string): Item {
  const check = checker(item.description);
  let description = item.description;
  for (;;) {
    const tagSpans = spansOf(description).filter((s): s is TagSpan => s.type === 'tag');
    const index = tagSpans.findIndex((s) => tagNamesEqual(s.tag.name, name));
    const span = tagSpans[index];
    if (!span) break;
    const expected = tagSpans.filter((_, i) => i !== index).map((s) => s.tag);
    const edited = removalCandidates(description, span.from, span.to).find((d) => check(d, expected));
    if (edited === undefined) {
      throw new XitEditError(`Couldn't remove #${span.tag.name} without changing the rest of the description.`);
    }
    description = edited;
  }
  return description === item.description ? item : updateItem(item, { description });
}

/**
 * Sets an item's due date, as a pattern like `2026-11-04`, `2026-11`,
 * `2026`, `2026-W45` or `2026-Q4` (or a `DueDate`). An existing due date is
 * rewritten in place; otherwise one is added at the end of the description.
 * `null` removes the due date (and any later one that would then count).
 *
 * Throws a `XitEditError` if the date isn't a valid due date.
 */
export function setDueDate(item: Item, dueDate: string | DueDate | null): Item {
  const description = item.description;
  const check = checker(description);
  const { tags } = parseDescription(description);

  if (dueDate === null) {
    let current = description;
    for (;;) {
      const due = spansOf(current).find((s) => s.type === 'due-date');
      if (!due) break;
      // Removing it may let a later due date count; the loop removes that one too.
      const edited = removalCandidates(current, due.from, due.to).find((d) => check(d, tags, 'any'));
      if (edited === undefined) throw new XitEditError("Couldn't remove the due date without changing the rest of the description.");
      current = edited;
    }
    if (!check(current, tags, null)) throw new XitEditError("Couldn't remove the due date without changing the rest of the description.");
    return current === description ? item : updateItem(item, { description: current });
  }

  const text = typeof dueDate === 'string' ? dueDate : dueDate.text;
  const parsed = parseDueDate(text);
  if (!parsed) {
    throw new XitEditError(
      `Not a valid due date: ${JSON.stringify(text)}. Use yyyy-mm-dd, yyyy-mm, yyyy, yyyy-Www or yyyy-Qq (or / instead of -).`,
    );
  }
  const existing = spansOf(description).find((s) => s.type === 'due-date');
  const edited = existing
    ? splice(description, existing.from, existing.to, `-> ${text}`)
    : append(description, `-> ${text}`);
  if (!check(edited, tags, parsed)) {
    throw new XitEditError("Couldn't set the due date without changing the rest of the description.");
  }
  return updateItem(item, { description: edited });
}

/**
 * Checks an edited description: it reads back with exactly these tags and
 * this due date ('any' when only the tags matter), and, if the original could
 * be written as an item, so can it.
 */
function checker(original: string) {
  const mustBeWritable = descriptionProblem(original) === null;
  const originalDue = parseDescription(original).dueDate;
  return (description: string, tags: readonly Tag[], dueDate: DueDate | null | 'any' = originalDue): boolean => {
    if (mustBeWritable && descriptionProblem(description) !== null) return false;
    const read = parseDescription(description);
    if (!sameTags(read.tags, tags)) return false;
    return dueDate === 'any' || (read.dueDate?.text ?? null) === (dueDate?.text ?? null);
  };
}

/** The ways to write a tag's value, most natural first: bare, then in either kind of quote. */
function valueSpellings(value: string | null): string[] {
  if (value === null) return [''];
  if (value.includes('\n')) throw new XitEditError("A tag value can't contain a newline.");
  const spellings: string[] = [];
  if (isTagName(value)) spellings.push(`=${value}`);
  if (!value.includes('"')) spellings.push(`="${value}"`);
  if (!value.includes("'")) spellings.push(`='${value}'`);
  if (spellings.length === 0) throw new XitEditError(`A tag value can't contain both kinds of quote: ${JSON.stringify(value)}.`);
  return spellings;
}

/** The description's tags and due date, with where each is (its plain text is left out). */
function spansOf(description: string): Span[] {
  const spans: Span[] = [];
  let offset = 0;
  for (const segment of parseDescription(description).segments) {
    const from = offset;
    offset += segment.text.length;
    if (segment.type !== 'text') spans.push({ ...segment, from, to: offset });
  }
  return spans;
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/** Adds `piece` at the end of the last line, after a space unless there's one already. */
function append(description: string, piece: string): string {
  const last = description.at(-1);
  const needsSpace = last !== undefined && last !== '\n' && !isBlankChar(last);
  return description + (needsSpace ? ' ' : '') + piece;
}

/** Ways to cut [from, to) out of a description, tidiest first. */
function removalCandidates(text: string, from: number, to: number): string[] {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const newlineAfter = text.indexOf('\n', to);
  const lineEnd = newlineAfter === -1 ? text.length : newlineAfter;
  const candidates: string[] = [];

  // If nothing but whitespace would be left on the line, drop the whole line
  // (with one of its line breaks), since a blank line would end the item.
  const leftOnLine = text.slice(lineStart, from) + text.slice(to, lineEnd);
  if (isBlankLine(leftOnLine) && text.includes('\n')) {
    candidates.push(newlineAfter === -1 ? text.slice(0, lineStart - 1) : splice(text, lineStart, lineEnd + 1, ''));
  }

  const before = text[from - 1];
  const after = text[to];
  const atLineStart = from === lineStart;
  const atLineEnd = to === lineEnd;
  if (before === ' ' && (atLineEnd || after === ' ')) candidates.push(splice(text, from - 1, to, ''));
  if (atLineStart && after === ' ') candidates.push(splice(text, from, to + 1, ''));
  if (before === ' ') candidates.push(splice(text, from - 1, to, ''));
  if (after === ' ') candidates.push(splice(text, from, to + 1, ''));
  candidates.push(splice(text, from, to, ''));
  return candidates;
}

function sameTags(a: readonly Tag[], b: readonly Tag[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag.name === b[i]!.name && tag.value === b[i]!.value);
}
