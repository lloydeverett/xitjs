// Every example in the official syntax guide (https://xit.jotaen.net/syntax-guide),
// as its own highlighting reads it. See scripts/guide_fixture.py.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, parseDescription, tokenize, validate, type Item, type Token, type XitDocument } from '../src/index.ts';

/** A highlighted piece of a line: its kind, its text, and where it starts in the line. */
type Span = [kind: 'checkbox' | 'priority' | 'tag' | 'due', text: string, from: number];

type Line =
  | { kind: 'blank' }
  | { kind: 'invalid' }
  | { kind: 'title'; text: string }
  | { kind: 'item'; status: string; priority: number; text: string; tags: string[]; due: string[]; spans: Span[] }
  | { kind: 'continuation'; status: string; text: string; tags: string[]; due: string[]; spans: Span[] };

interface Listing {
  section: string;
  annotation: string;
  source: string;
  lines: Line[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/syntax-guide.json', import.meta.url), 'utf8'),
) as { listings: Listing[] };

/**
 * Where we deliberately read a line differently from the guide's highlighting.
 * The guide shades these whole lines "invalid". The guide also says a priority
 * can't have extra spaces to its left, and that dots can't surround or sit
 * between its !s, so none of these is a priority. But each line is still a
 * checkbox, one space and a description, which the spec allows, so we keep
 * them as items with no priority and warn.
 */
const DEVIATIONS: Record<string, { line: Line; warning: string }> = {
  '[ ]    ! Do something': {
    line: { kind: 'item', status: 'open', priority: 0, text: '   ! Do something', tags: [], due: [], spans: [['checkbox', '[ ]', 0]] },
    warning: 'misplaced-priority',
  },
  '[ ]    . Do something': {
    line: { kind: 'item', status: 'open', priority: 0, text: '   . Do something', tags: [], due: [], spans: [['checkbox', '[ ]', 0]] },
    warning: 'misplaced-priority',
  },
  '[ ] .!. Invalid': {
    line: { kind: 'item', status: 'open', priority: 0, text: '.!. Invalid', tags: [], due: [], spans: [['checkbox', '[ ]', 0]] },
    warning: 'malformed-priority',
  },
  '[ ] !.! Invalid': {
    line: { kind: 'item', status: 'open', priority: 0, text: '!.! Invalid', tags: [], due: [], spans: [['checkbox', '[ ]', 0]] },
    warning: 'malformed-priority',
  },
};

/** A fixture line without its spans, which `parse` doesn't give (see `spans`). */
type ParsedLine = DistributiveOmit<Line, 'spans'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Our document, line by line, in the fixture's terms. */
function toLines(document: XitDocument): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const block of document.blocks) {
    if (block.type === 'blank' || block.type === 'invalid') lines.push({ kind: block.type });
    else if (block.type === 'title') lines.push({ kind: 'title', text: block.text });
    else lines.push(...itemLines(block));
  }
  return lines;
}

function itemLines(item: Item): ParsedLine[] {
  const texts = item.description.split('\n');
  const tags: string[][] = texts.map(() => []);
  const due: string[][] = texts.map(() => []);
  let line = 0;
  for (const segment of parseDescription(item.description).segments) {
    if (segment.type === 'tag') tags[line]!.push(segment.text);
    else if (segment.type === 'due-date') due[line]!.push(segment.text);
    else line += segment.text.split('\n').length - 1;
  }
  return texts.map((text, i): ParsedLine =>
    i === 0
      ? { kind: 'item', status: item.status, priority: item.priority, text, tags: tags[i]!, due: due[i]! }
      : { kind: 'continuation', status: item.status, text, tags: tags[i]!, due: due[i]! },
  );
}

const SPAN_KINDS: Partial<Record<Token['type'], Span[0]>> = {
  checkbox: 'checkbox', priority: 'priority', tag: 'tag', 'due-date': 'due',
};

/** Our tokens, line by line, in the fixture's terms: the highlighted spans. */
function spans(source: string): Span[][] {
  const tokens = tokenize(source);
  let start = 0;
  return source.split('\n').map((text) => {
    const line: Span[] = [];
    for (const token of tokens) {
      if (token.from < start || token.to > start + text.length) continue;
      const kind = SPAN_KINDS[token.type];
      if (kind) line.push([kind, source.slice(token.from, token.to), token.from - start]);
    }
    start += text.length + 1;
    return line;
  });
}

function withoutSpans(line: Line): ParsedLine {
  if (!('spans' in line)) return line;
  const { spans: _, ...rest } = line;
  return rest;
}

describe('syntax guide', () => {
  for (const listing of fixture.listings) {
    test(`${listing.section}: ${listing.annotation}`, () => {
      const sourceLines = listing.source.split('\n');
      const expected = listing.lines.map((line, i) => DEVIATIONS[sourceLines[i]!]?.line ?? line);
      assert.deepEqual(toLines(parse(listing.source)), expected.map(withoutSpans));
      assert.deepEqual(
        spans(listing.source).slice(0, expected.length),
        expected.map((line) => ('spans' in line ? line.spans : [])),
      );

      const warnings = validate(listing.source).filter((d) => d.severity === 'warning').map((d) => d.code);
      for (const sourceLine of sourceLines) {
        const deviation = DEVIATIONS[sourceLine];
        if (deviation) assert.ok(warnings.includes(deviation.warning as never), `${sourceLine}: ${deviation.warning}`);
      }
    });
  }
});
