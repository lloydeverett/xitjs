// Generators for the property tests, shared between test files.
import fc from 'fast-check';

/** `pnpm test:fuzz` runs the property tests many more times (XIT_FUZZ multiplies the runs). */
export const runs = (n: number) => ({ numRuns: n * Number(process.env.XIT_FUZZ ?? 1) });

/** Pieces of [x]it! syntax, plus whitespace and other characters that matter to it. */
const fragment = fc.constantFrom(
  '[ ]', '[x]', '[@]', '[~]', '[?]', '[', ']', '[X]', '[]', ' ', '    ', '\t', '\u00a0', '\r',
  '!', '!!', '.', '..', '#', '#tag', '=', '"', "'", '->', '-> ', '2022', '-01', '/01', '-31', '-W01', '-Q2', 'W', 'Q',
  '-', '/', '(', ')', 'a', 'Title', 'é', '今', '🥳', '̈', '\uFEFF',
);
/** A line: any mix of fragments, but no line ending (and none hiding at its end). */
export const line = fc.array(fragment, { maxLength: 12 }).map((parts) => parts.join('')).filter((l) => !l.endsWith('\r'));
export const document = fc.record({
  lines: fc.array(line, { maxLength: 15 }),
  newline: fc.constantFrom('\n', '\r\n'),
  finalNewline: fc.boolean(),
  bom: fc.boolean(),
}).map(({ lines, newline, finalNewline, bom }) =>
  (bom ? '\uFEFF' : '') + lines.join(newline) + (finalNewline && lines.length > 0 ? newline : ''));

/** Any text at all, including lone surrogates, as lines joined by \n. */
const anyLine = fc.string({ unit: 'binary', maxLength: 40 }).map((s) => s.replace(/[\r\n]/g, ''));
export const anyDocument = fc.array(anyLine, { maxLength: 10 }).map((lines) => lines.join('\n'));

/** Anything, including mixed and stray line endings. */
export const anything = fc.string({ unit: fc.constantFrom('\n', '\r', '\r\n', ' ', '[ ]', '[x]', 'a', '!', '    ', '#t', '-> 2022'), maxLength: 30 });

/** How a line starts: mostly the way items, continuation lines and titles do. */
const opening = fc.constantFrom(
  '[ ] ', '[x] ', '[@] ', '[~] ', '[?] ', '[ ] ! ', '[x] ..! ', '[ ] . ', '[ ]', '    ', '    ', '        ', '', '', ' ', '\t',
);
/** Whole pieces of a description, so that tags and due dates are common. */
const piece = fc.oneof(
  fragment,
  fc.constantFrom('-> 2022', '-> 2022-01-31', '-> 2022-W01', '(-> 2023-Q2)', '-> 2022-02-30', '#t', '#t=v', '#t="a b"', "#t='x", 'text'),
);
/** Documents line by line, most of them valid: groups of items with continuation lines, tags and due dates. */
export const xitDocument = fc.array(
  fc.tuple(opening, fc.array(fc.oneof(piece, fc.constant(' ')), { maxLength: 6 })).map(([open, parts]) => open + parts.join('')),
  { maxLength: 12 },
).map((lines) => lines.filter((l) => !l.endsWith('\r')).join('\n') + '\n');
