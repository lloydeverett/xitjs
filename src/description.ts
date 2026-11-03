import { TAG_NAME, charAt, charBefore, isBlankChar, isPunctuation } from './chars.ts';
import { parseDueDate } from './due-date.ts';
import type { DiagnosticCode, DueDate, ParsedDescription, Segment, Tag } from './types.ts';

/** Something `validate` warns about, at offsets into the description. */
export interface DescriptionProblem {
  code: DiagnosticCode;
  from: number;
  to: number;
}

/** Finds the tags and due date in an item's description. */
export function parseDescription(description: string): ParsedDescription {
  const { problems: _, ...parsed } = scanDescription(description);
  return parsed;
}

// The longest thing that could be a date pattern; parseDueDate decides if it is one.
const DATE_LIKE = /\d{4}(?:[-/](?:\d{2}(?:[-/]\d{2})?|W\d{2}|Q\d))?/y;
const FOUR_DIGITS = /\d{4}/y;

export function scanDescription(description: string): ParsedDescription & { problems: DescriptionProblem[] } {
  const tags: Tag[] = [];
  const segments: Segment[] = [];
  const problems: DescriptionProblem[] = [];
  let dueDate: DueDate | null = null;
  let textStart = 0;
  let i = 0;

  const flushText = (end: number) => {
    if (end > textStart) segments.push({ type: 'text', text: description.slice(textStart, end) });
  };

  while (i < description.length) {
    const char = description[i];
    if (char === '#') {
      const tag = scanTag(description, i, problems);
      if (tag) {
        flushText(i);
        tags.push(tag.tag);
        segments.push({ type: 'tag', text: description.slice(i, tag.end), tag: tag.tag });
        i = textStart = tag.end;
        continue;
      }
    } else if (char === '-' && description.startsWith('-> ', i) && isDueDateBoundary(charBefore(description, i))) {
      const due = scanDueDate(description, i + 3);
      if (due && !dueDate) {
        flushText(i);
        dueDate = due.dueDate;
        segments.push({ type: 'due-date', text: description.slice(i, due.end), dueDate });
        i = textStart = due.end;
        continue;
      }
      if (due) {
        problems.push({ code: 'extra-due-date', from: i, to: due.end });
      } else {
        FOUR_DIGITS.lastIndex = i + 3;
        if (FOUR_DIGITS.test(description)) {
          DATE_LIKE.lastIndex = i + 3;
          DATE_LIKE.test(description);
          problems.push({ code: 'invalid-due-date', from: i, to: DATE_LIKE.lastIndex });
        }
      }
    }
    i += charAt(description, i).length;
  }
  flushText(description.length);
  return { tags, dueDate, segments, problems };
}

function isNameChar(char: string): boolean {
  TAG_NAME.lastIndex = 0;
  return char !== '' && TAG_NAME.test(char);
}

/** A tag at `start` (a `#`), or null if there isn't one there. */
function scanTag(text: string, start: number, problems: DescriptionProblem[]): { tag: Tag; end: number } | null {
  if (isNameChar(charBefore(text, start))) return null;
  TAG_NAME.lastIndex = start + 1;
  if (!TAG_NAME.test(text)) return null;
  const name = text.slice(start + 1, TAG_NAME.lastIndex);
  let end = TAG_NAME.lastIndex;
  if (text[end] !== '=') return { tag: { name, value: null }, end };

  end += 1;
  const quote = text[end];
  if (quote === '"' || quote === "'") {
    const lineEnd = text.indexOf('\n', end);
    const close = text.indexOf(quote, end + 1);
    if (close === -1 || (lineEnd !== -1 && close > lineEnd)) {
      problems.push({ code: 'unclosed-tag-value', from: end, to: lineEnd === -1 ? text.length : lineEnd });
      return { tag: { name, value: null }, end };
    }
    return { tag: { name, value: text.slice(end + 1, close) || null }, end: close + 1 };
  }
  TAG_NAME.lastIndex = end;
  if (TAG_NAME.test(text)) {
    return { tag: { name, value: text.slice(end, TAG_NAME.lastIndex) }, end: TAG_NAME.lastIndex };
  }
  return { tag: { name, value: null }, end };
}

/** What may come just before or after a due date: a line edge, a blank, or punctuation other than - and /. */
function isDueDateBoundary(char: string): boolean {
  if (char === '' || char === '\n') return true;
  if (char === '-' || char === '/') return false;
  return isBlankChar(char) || isPunctuation(char);
}

/** A valid due date pattern at `start` (just past `-> `), properly bounded after. */
function scanDueDate(text: string, start: number): { dueDate: DueDate; end: number } | null {
  DATE_LIKE.lastIndex = start;
  if (!DATE_LIKE.test(text)) return null;
  const end = DATE_LIKE.lastIndex;
  if (!isDueDateBoundary(charAt(text, end))) return null;
  const dueDate = parseDueDate(text.slice(start, end));
  return dueDate ? { dueDate, end } : null;
}
