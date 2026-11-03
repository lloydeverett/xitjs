// Every example in the official syntax guide (https://xit.jotaen.net/syntax-guide),
// as its own highlighting reads it. See scripts/guide_fixture.py.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, parseDescription, validate, type Item, type XitDocument } from '../src/index.ts';

type Line =
  | { kind: 'blank' }
  | { kind: 'invalid' }
  | { kind: 'title'; text: string }
  | { kind: 'item'; status: string; priority: number; text: string; tags: string[]; due: string[] }
  | { kind: 'continuation'; status: string; text: string; tags: string[]; due: string[] };

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
    line: { kind: 'item', status: 'open', priority: 0, text: '   ! Do something', tags: [], due: [] },
    warning: 'misplaced-priority',
  },
  '[ ]    . Do something': {
    line: { kind: 'item', status: 'open', priority: 0, text: '   . Do something', tags: [], due: [] },
    warning: 'misplaced-priority',
  },
  '[ ] .!. Invalid': {
    line: { kind: 'item', status: 'open', priority: 0, text: '.!. Invalid', tags: [], due: [] },
    warning: 'malformed-priority',
  },
  '[ ] !.! Invalid': {
    line: { kind: 'item', status: 'open', priority: 0, text: '!.! Invalid', tags: [], due: [] },
    warning: 'malformed-priority',
  },
};

/** Our document, line by line, in the fixture's terms. */
function toLines(document: XitDocument): Line[] {
  const lines: Line[] = [];
  for (const block of document.blocks) {
    if (block.type === 'blank' || block.type === 'invalid') lines.push({ kind: block.type });
    else if (block.type === 'title') lines.push({ kind: 'title', text: block.text });
    else lines.push(...itemLines(block));
  }
  return lines;
}

function itemLines(item: Item): Line[] {
  const texts = item.description.split('\n');
  const tags: string[][] = texts.map(() => []);
  const due: string[][] = texts.map(() => []);
  let line = 0;
  for (const segment of parseDescription(item.description).segments) {
    if (segment.type === 'tag') tags[line]!.push(segment.text);
    else if (segment.type === 'due-date') due[line]!.push(segment.text);
    else line += segment.text.split('\n').length - 1;
  }
  return texts.map((text, i) =>
    i === 0
      ? { kind: 'item', status: item.status, priority: item.priority, text, tags: tags[i]!, due: due[i]! }
      : { kind: 'continuation', status: item.status, text, tags: tags[i]!, due: due[i]! },
  );
}

describe('syntax guide', () => {
  for (const listing of fixture.listings) {
    test(`${listing.section}: ${listing.annotation}`, () => {
      const sourceLines = listing.source.split('\n');
      const expected = listing.lines.map((line, i) => DEVIATIONS[sourceLines[i]!]?.line ?? line);
      assert.deepEqual(toLines(parse(listing.source)), expected);

      const warnings = validate(listing.source).filter((d) => d.severity === 'warning').map((d) => d.code);
      for (const sourceLine of sourceLines) {
        const deviation = DEVIATIONS[sourceLine];
        if (deviation) assert.ok(warnings.includes(deviation.warning as never), `${sourceLine}: ${deviation.warning}`);
      }
    });
  }
});
