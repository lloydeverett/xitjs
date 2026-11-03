// Editing an item's tags and due date by rewriting its description.
//
// Each edit tries the tidiest change first, re-reads the result, and keeps it
// only if exactly the intended tags and due date come back. So an edit never
// quietly changes anything else, such as text next to a tag turning into a tag.

import { isBlankChar } from './chars.ts';
import { updateItem } from './build.ts';
import { parseDescription } from './description.ts';
import { parseDueDate } from './due-date.ts';
import { XitEditError } from './errors.ts';
import { tagNamesEqual } from './query.ts';
import type { DueDate, Item, Segment, Tag } from './types.ts';

const NAME = /^[\p{L}0-9_-]+$/u;

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
  if (!NAME.test(name)) {
    throw new XitEditError(`Not a valid tag name: ${JSON.stringify(name)}. A name can only contain letters, digits, _ and -.`);
  }
  const wanted = value || null;
  const forms = valueForms(wanted);

  const description = item.description;
  const { tags, dueDate } = parseDescription(description);
  const index = tags.findIndex((tag) => tagNamesEqual(tag.name, name));
  const existing = index === -1 ? undefined : spans(description).filter((s) => s.type === 'tag')[index];

  for (const form of forms) {
    let edited: string;
    let expected: Tag[];
    if (existing) {
      const spelling = tags[index]!.name;
      edited = splice(description, existing.from, existing.to, `#${spelling}${form}`);
      expected = tags.map((tag, i) => (i === index ? { name: spelling, value: wanted } : tag));
    } else {
      edited = append(description, `#${name}${form}`);
      expected = [...tags, { name, value: wanted }];
    }
    if (reads(edited, expected, dueDate)) return updateItem(item, { description: edited });
  }
  throw new XitEditError(`Couldn't set #${name} without changing the rest of the description.`);
}

/** Removes every occurrence of a tag (case-insensitive), with the space next to it. */
export function removeTag(item: Item, name: string): Item {
  let description = item.description;
  for (;;) {
    const { tags, dueDate } = parseDescription(description);
    const index = tags.findIndex((tag) => tagNamesEqual(tag.name, name));
    if (index === -1) break;
    const span = spans(description).filter((s) => s.type === 'tag')[index]!;
    const expected = tags.filter((_, i) => i !== index);
    const edited = removals(description, span.from, span.to).find((d) => reads(d, expected, dueDate));
    if (edited === undefined) {
      throw new XitEditError(`Couldn't remove #${tags[index]!.name} without changing the rest of the description.`);
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
  const { tags } = parseDescription(description);

  if (dueDate === null) {
    let current = description;
    for (;;) {
      const due = spans(current).find((s) => s.type === 'due-date');
      if (!due) break;
      const edited = removals(current, due.from, due.to).find((d) => sameTags(parseDescription(d).tags, tags));
      if (edited === undefined) throw new XitEditError("Couldn't remove the due date without changing the tags.");
      current = edited;
    }
    return current === description ? item : updateItem(item, { description: current });
  }

  const text = typeof dueDate === 'string' ? dueDate : dueDate.text;
  const parsed = parseDueDate(text);
  if (!parsed) {
    throw new XitEditError(
      `Not a valid due date: ${JSON.stringify(text)}. Use yyyy-mm-dd, yyyy-mm, yyyy, yyyy-Www or yyyy-Qq (or / instead of -).`,
    );
  }
  const existing = spans(description).find((s) => s.type === 'due-date');
  const edited = existing
    ? splice(description, existing.from, existing.to, `-> ${text}`)
    : append(description, `-> ${text}`);
  if (!reads(edited, tags, parsed)) throw new XitEditError("Couldn't set the due date without changing the rest of the description.");
  return updateItem(item, { description: edited });
}

/** The ways to write a tag's value, most natural first: bare, then in either kind of quote. */
function valueForms(value: string | null): string[] {
  if (value === null) return [''];
  if (value.includes('\n')) throw new XitEditError("A tag value can't contain a newline.");
  const forms: string[] = [];
  if (NAME.test(value)) forms.push(`=${value}`);
  if (!value.includes('"')) forms.push(`="${value}"`);
  if (!value.includes("'")) forms.push(`='${value}'`);
  if (forms.length === 0) throw new XitEditError(`A tag value can't contain both kinds of quote: ${JSON.stringify(value)}.`);
  return forms;
}

/** The description's tags and due date, with where each is. */
function spans(description: string): Array<Segment & { from: number; to: number }> {
  let offset = 0;
  return parseDescription(description).segments.map((segment) => {
    const from = offset;
    offset += segment.text.length;
    return { ...segment, from, to: offset };
  }).filter((s) => s.type !== 'text');
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
function removals(text: string, from: number, to: number): string[] {
  const before = text[from - 1];
  const after = text[to];
  const atLineStart = before === undefined || before === '\n';
  const atLineEnd = after === undefined || after === '\n';
  const options: string[] = [];
  if (before === ' ' && (atLineEnd || after === ' ')) options.push(splice(text, from - 1, to, ''));
  if (atLineStart && after === ' ') options.push(splice(text, from, to + 1, ''));
  if (before === ' ') options.push(splice(text, from - 1, to, ''));
  if (after === ' ') options.push(splice(text, from, to + 1, ''));
  options.push(splice(text, from, to, ''));
  return options;
}

/** Whether a description reads back with exactly these tags and this due date. */
function reads(description: string, tags: readonly Tag[], dueDate: DueDate | null): boolean {
  const read = parseDescription(description);
  return sameTags(read.tags, tags) && (read.dueDate?.text ?? null) === (dueDate?.text ?? null);
}

function sameTags(a: readonly Tag[], b: readonly Tag[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag.name === b[i]!.name && tag.value === b[i]!.value);
}
