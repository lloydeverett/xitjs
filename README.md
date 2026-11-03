# xitjs

Parse and write [[x]it!](https://xit.jotaen.net/) todo documents
([spec v1.1](docs/xit-specification-1.1.md)).

- **Follows the spec.** Every example in the official
  [syntax guide](https://xit.jotaen.net/syntax-guide) is a test.
- **Writes back exactly what it read.** `stringify(parse(text)) === text`,
  invalid lines and odd spacing included, so an app can tick one box and save
  without touching anything else.
- **Never writes something that reads back differently.** `stringify` throws
  rather than produce a document that parses into something else.
- **Runs anywhere.** ESM only, with no dependencies and no Node or DOM APIs,
  so it works in Node, browsers and bundlers. `sideEffects: false`. (The
  optional `xitjs/codemirror` entry needs CodeMirror, as peer dependencies.)
- **Highlights in editors.** `tokenize` says where each piece of syntax is,
  and `xitjs/codemirror` makes that a CodeMirror language.
- **Plain data.** Documents are plain objects, so they work with
  `structuredClone`, `postMessage` and immutable updates.

```ts
import { parse, stringify, getGroups, updateItem } from 'xitjs';

const doc = parse(`Groceries
[ ] Milk #shop
[x] ! Eggs -> 2026-11-04
[@] Bread #shop=bakery
    (the sourdough one)
`);

for (const { title, items } of getGroups(doc)) {
  console.log(title, items.map((i) => [i.status, i.priority, i.description, i.dueDate?.date]));
}
// Groceries [
//   ['open', 0, 'Milk #shop', undefined],
//   ['checked', 1, 'Eggs -> 2026-11-04', '2026-11-04'],
//   ['ongoing', 0, 'Bread #shop=bakery\n(the sourdough one)', undefined],
// ]

// Tick off the milk; every other line is written back unchanged.
const blocks = doc.blocks.map((b) =>
  b.type === 'item' && b.description.startsWith('Milk') ? updateItem(b, { status: 'checked' }) : b);
stringify({ ...doc, blocks });
```

## The document

```ts
interface XitDocument {
  blocks: Block[];          // one per line, but an item includes its continuation lines
  newline?: '\n' | '\r\n';  // set by parse; default '\n'
  finalNewline?: boolean;   // set by parse; default true
  bom?: boolean;            // set by parse; default false
}
type Block = Title | Item | BlankLine | InvalidLine;

interface Title       { type: 'title'; text: string }
interface BlankLine   { type: 'blank'; raw?: string }   // raw: its whitespace, if any
interface InvalidLine { type: 'invalid'; raw: string }  // kept, and written back unchanged

interface Item {
  type: 'item';
  status: 'open' | 'checked' | 'ongoing' | 'obsolete' | 'in-question';
  priority: number;              // the number of '!'s; 0 for none
  description: string;           // continuation lines joined by '\n', without their indent
  readonly tags: readonly Tag[]; // worked out from the description
  readonly dueDate: DueDate | null;
  raw?: string;                  // the source, so formatting like '..!' is kept
}

interface Tag { name: string; value: string | null }

type DueDate = {
  text: string;   // as written, e.g. '2022/W01'
  date: string;   // the last day of the period, 'YYYY-MM-DD' (sorts as a string)
} & (
  | { period: 'day'; year: number; month: number; day: number }
  | { period: 'week'; year: number; week: number }       // ISO 8601 weeks
  | { period: 'month'; year: number; month: number }
  | { period: 'quarter'; year: number; quarter: number }
  | { period: 'year'; year: number });
```

`stringify` writes an item from its `status`, `priority` and `description`.
`tags` and `dueDate` are worked out from the description: `parse`,
`createItem` and `updateItem` fill them in. If you change a description by
spreading (`{ ...item, description }`), use `updateItem` (or the editing
helpers below) instead, or the
`tags` and `dueDate` in memory will be stale. What's written is right either
way.

An item's `raw` is used only while it still reads back as the item's status,
priority and description. So an unchanged item keeps its exact formatting,
and a changed one is written in the standard form.

## API

### Reading

| | |
|---|---|
| `parse(source, { strict? })` | Parse a document. Never throws: invalid lines become `InvalidLine` blocks. With `strict: true` it throws a `XitParseError` (with `.diagnostics`) if there are any errors. |
| `validate(source)` | `Diagnostic[]`: errors (invalid lines) and warnings (valid, but probably not meant). |
| `getGroups(doc)` | `{ title: string \| null, items: Item[] }[]`. Blank and invalid lines end a group. The items are the document's own block objects. |
| `getItems(doc)` | All items, in order. |
| `getTag(item, name)`, `hasTag(item, name)`, `tagNamesEqual(a, b)` | Tag lookups. Names are case-insensitive. |
| `parseDescription(text)` | `{ tags, dueDate, segments }`. `segments` splits the text into text, tag and due-date pieces, e.g. to render tags as chips. |
| `parseDueDate(text)` | Parse `2022-03-31`, `2022/03`, `2022`, `2022-W09` or `2022-Q1`, or return `null`. |

### Writing

| | |
|---|---|
| `stringify(doc, { newline?, finalNewline? })` | Write a document. Throws a `XitStringifyError` (with `.blockIndex`) if it can't be written so it reads back the same. Examples: a title after a non-blank line, a blank continuation line, a title starting with `[`. |
| `createItem('text' \| { status?, priority?, description? })` | A new item. |
| `updateItem(item, changes)` | A copy with changes applied and derived fields worked out again. |
| `createDocument([{ title?, items? }, ...])` | A document of groups, with blank lines between them. |

### Editing tags and due dates

These rewrite an item's description and return a new item.

| | |
|---|---|
| `setTag(item, name, value?)` | Rewrites the tag's first occurrence in place (keeping its spelling), or adds it at the end. A value is quoted only when it needs to be. |
| `removeTag(item, name)` | Removes every occurrence, with the space next to it. |
| `setDueDate(item, '2026-11-04' \| dueDate \| null)` | Rewrites the due date in place, or adds one at the end. `null` removes it, along with any later one that would then count. |

Each edit re-reads the description, and keeps the change only if exactly
the intended tags and due date come back. If the edit can't be made
without changing anything else, it throws a `XitEditError`. That covers an
invalid tag name (`my tag`), a value with both kinds of quote or a
newline, a date that doesn't exist (`2026-02-30`), and text that would turn
into a tag. For example, removing `#x` from `#x#y` would leave `#y`, which
is a tag.

```ts
let item = createItem('Call mum');
item = setTag(item, 'who', 'Mum & Dad'); // 'Call mum #who="Mum & Dad"'
item = setDueDate(item, '2026-W45');     // 'Call mum #who="Mum & Dad" -> 2026-W45'
item = removeTag(item, 'who');           // 'Call mum -> 2026-W45'
```

### Highlighting

`tokenize` says where each piece of syntax is, for syntax highlighting.
It reads a document exactly as `parse` does.

```ts
tokenize('[x] !! Call mum #family -> 2026-W45\n');
// [{ type: 'checkbox', status: 'checked', from: 0, to: 3 },
//  { type: 'priority', status: 'checked', from: 4, to: 6 },
//  { type: 'text',     status: 'checked', from: 7, to: 16 },
//  { type: 'tag',      status: 'checked', from: 16, to: 23, tag: { name: 'family', value: null } },
//  { type: 'text',     status: 'checked', from: 23, to: 24 },
//  { type: 'due-date', status: 'checked', from: 24, to: 35, dueDate: { ... } }]
```

| | |
|---|---|
| `tokenize(source)` | `Token[]`, in order, with UTF-16 offsets into `source`. Every character is in one token, except line endings, a byte-order mark, and the single space after a checkbox or priority. |
| `tokenizeLine(text, state)` | `{ tokens, state }` for one line (without its line ending), with offsets into the line. Pass the state the line before returned, or `startLineState()` for the first line. |
| `startLineState()` | The state for a document's first line. Every blank line leaves this same state, so tokenizing can restart at any blank line. |

The token types are `title`, `blank` (a blank line's whitespace),
`invalid` (a whole invalid line, with its diagnostic `code`), and, for
items, `checkbox`, `priority`, `indent` (a continuation line's four
spaces), `text`, `tag` (with its `tag`) and `due-date` (with its
`dueDate`). An item's tokens all carry its `status`, so a theme can style
a whole item by it.

`tokenizeLine` is what an editor that highlights a line at a time needs,
like CodeMirror's `StreamLanguage`. Lines depend on the ones before them
(whether an indented line continues an item, say), and the state is all
that's carried from one line to the next. It's small, plain and frozen.

### CodeMirror

`xitjs/codemirror` makes the tokenizer a CodeMirror 6 language. It needs
`@codemirror/language` and `@lezer/highlight`, as peer dependencies; the
main `xitjs` entry still needs nothing.

```ts
import { syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { linter } from '@codemirror/lint';
import { validate } from 'xitjs';
import { xit, xitHighlightStyle, xitLanguageDescription } from 'xitjs/codemirror';

// A .xit file:
const extensions = [
  xit(),
  syntaxHighlighting(xitHighlightStyle),
  linter((view) => validate(view.state.doc.toString())), // diagnostics are already in its shape
];

// ```xit blocks in markdown:
markdown({ codeLanguages: [xitLanguageDescription] });
```

| | |
|---|---|
| `xit()` | A `LanguageSupport` for an editor's extensions. |
| `xitLanguage` | The `StreamLanguage` itself. It re-reads from the nearest saved line state after an edit, like any stream language. |
| `xitLanguageDescription` | For markdown's `codeLanguages`: matches `xit` code blocks. |
| `xitTags` | The highlighting tags: `title`, `checkbox`, `priority`, `tag`, `dueDate` and `invalid`, and one per status (`open`, `checked`, `ongoing`, `obsolete`, `inQuestion`), which every token of an item also gets. |
| `xitHighlightStyle` | A default style with no colours: bold titles and priorities, faded checked and obsolete items (obsolete ones struck through), and invalid lines underlined. |

Each of `xitTags` derives from a standard tag (`heading`, `atom`,
`keyword`, `labelName`, `literal` and `invalid`), so an existing theme
colours xit without knowing about it. To style xit specifically, add a
`HighlightStyle` for `xitTags`.

### Diagnostics

```ts
interface Diagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  message: string;
  from: number; to: number;   // UTF-16 offsets into the source, as CodeMirror uses
  line: number; column: number; // 1-based
}
```

| Code | Severity | Example |
|---|---|---|
| `invalid-checkbox` | error | `[*] a`, `[X] a`, `[] a`, `[Todos]` |
| `missing-space-after-checkbox` | error | `[ ]a` |
| `bad-indentation` | error | a continuation line not indented by exactly 4 spaces; any other indented line |
| `title-without-blank-line` | error | a title straight after an item, or after another title |
| `description-not-on-first-line` | error | an indented line after an item with no description, like `[ ]` (a description must start on the item's own line) |
| `misplaced-priority` | warning | `[ ]    ! a` (read as description) |
| `malformed-priority` | warning | `[ ] .!. a` (read as description) |
| `invalid-due-date` | warning | `-> 2022-13-01`, `-> 2022-01/31`, `-> 2022-01-31T10:00` |
| `extra-due-date` | warning | the second of `-> 2022 -> 2023` |
| `unclosed-tag-value` | warning | `#tag="no closing quote` |
| `missing-final-newline` | warning | |
| `mixed-newlines` | warning | `\n` and `\r\n` in one file (it's written with the first one) |

## Where the spec leaves room: decisions

| Question | Decision |
|---|---|
| What can come before `#` in a tag? | Anything but a letter, digit, `_` or `-`. `(#tag)` and `#a/#b` are tags; `page#anchor` and `C#7` aren't. |
| Is a tab a blank character? | Yes. The spec's glossary says only Unicode Zs, but the syntax guide says "whitespace", and without tab a tab-only line wouldn't be blank. |
| `[ ]    ! a`, `[ ] .!. a`, shaded "invalid" in the guide | Valid items whose description starts with that text, with a warning. That's what the spec's grammar says. |
| A due date that doesn't exist (`2022-02-30`, `2021-W53`) | Not a due date, with a warning. |
| An invalid line between items | Ends the group (the spec says a group's items are *consecutive*). |
| Writing an item with no priority whose description starts like one (`! a`) | Written as `[ ] . ! a`: a lone dot is a priority of 0, so it reads back the same. |
| Combining marks in tag names (`#ta` + U+0308 + `g`, which shows as `#täg`) | Not part of the name: the spec says letters (Unicode L), and a mark is category M. |
| Is a tag one token, or a name and a value? | One `tag` token, as the syntax guide highlights it. The token carries the parsed `tag` (`{ name, value }`). |
| Year `0000` | Allowed (ISO 8601's proleptic Gregorian calendar). A week whose Sunday falls in the year 10000 is not. |

## Development

Node and pnpm are pinned in `mise.toml`.

```sh
mise exec -- pnpm install
mise exec -- pnpm test        # node:test, running the TypeScript directly
mise exec -- pnpm test:fuzz   # the property tests, 50 times over
mise exec -- pnpm test:dist   # build, then check the built package
mise exec -- pnpm typecheck
mise exec -- pnpm demo        # a demo page: http://localhost:5173
```

`pnpm demo` serves `demo/` with Vite, using the library straight from
`src/`. It has a CodeMirror editor using `xitjs/codemirror` (with lint
from `validate`), samples including every syntax-guide example, controls
that edit the selected item with `updateItem`, `setTag`, `removeTag`,
`setDueDate` and `createItem`, and what `parse` (optionally strict),
`getGroups`, `validate`, `tokenize` and `stringify` (with its options) make
of the text. A last panel tries `parseDescription` and `parseDueDate` on
whatever you type.

`test/fixtures/syntax-guide.json` is generated from the syntax guide's HTML
by `scripts/guide_fixture.py`. It records how the guide's own highlighting
reads each example line: its kind, status, priority, description, tags and
due date, and where its checkbox, priority, tags and due date are. The
parser and the tokenizer are both tested against it.
