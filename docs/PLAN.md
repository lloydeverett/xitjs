# xitjs: plan

> **Status (2026-11-03):** v1 is built as planned (`README.md` documents the
> API). Changes made along the way:
> - **`stringify` handles priority-looking descriptions.** An item with no
>   priority whose description starts like one (`! a`) is written
>   `[ ] . ! a` rather than throwing. A lone dot is a priority of 0, so it
>   reads back the same. A property test found this case.
> - **One more `stringify` refusal.** A line ending in `\r` is refused when
>   writing with `\n`, because it would read back as `\r\n`. It's fine with
>   `\r\n`.
> - **One more `stringify` refusal.** A first line starting with U+FEFF is
>   refused unless `bom` is set.
> - **Added `pnpm test:fuzz` and `pnpm test:dist`.**
> - **Description editing helpers added since:** `setTag`, `removeTag` and
>   `setDueDate` (`src/edit.ts`).
> - **Tokenizer added since:** `tokenize`, `tokenizeLine` and
>   `startLineState` (`src/tokenize.ts`), for editor highlighting. What
>   each line is is now decided in one place, `readLine` (`src/lines.ts`),
>   which both `parse` and the tokenizer use.
> - **`xitjs/codemirror` added since:** the tokenizer as a CodeMirror
>   `StreamLanguage`, with highlighting tags and a default style. Its
>   CodeMirror packages are optional peer dependencies.

A dependency-free TypeScript library that parses [x]it! documents
(spec v1.1, `docs/xit-specification-1.1.md`) into plain data, and writes
that data back out as a document.

## Goals

1. **Follow the spec.** Every rule in the spec and every example in the
   official syntax guide (<https://xit.jotaen.net/syntax-guide>) is a test.
2. **Never throw on input.** `parse` accepts any string. Content that breaks
   the rules is kept as an `invalid` block and reported in diagnostics. An
   opt-in strict mode throws instead.
3. **Write back exactly what was read.** `stringify(parse(s)) === s` for every
   `s` that uses one newline style throughout. An editor can toggle one
   checkbox and save without touching anything else, invalid lines included.
4. **Never write a document that reads back differently.** For every
   document whose blocks are all valid (built in code, or parsed and then
   edited), `parse(stringify(doc))` gives back the same document.
   `stringify` throws `XitStringifyError` rather than write a document
   that would read back differently.
5. **Run in any JavaScript environment.** It's ESM only, has no runtime
   dependencies and no Node or DOM APIs, and is marked `sideEffects: false`
   for bundlers. The source is type-checked with `lib: ["ES2022"]` and
   `types: []`, so any use of a platform API fails the type check.
6. **Plain data.** A document is plain JSON-serialisable objects (no
   classes), so it works with `structuredClone`, `postMessage` and
   React-style immutable updates.

## API

```ts
import { parse, stringify, validate, getGroups, createDocument,
         createItem, updateItem, parseDescription, parseDueDate } from 'xitjs';

const doc = parse(source);                 // never throws
parse(source, { strict: true });           // throws XitParseError (with .diagnostics)
validate(source);                          // Diagnostic[] (errors + warnings, with offsets)

stringify(doc);                            // string; throws XitStringifyError if unrepresentable
stringify(doc, { newline: '\r\n', finalNewline: true });

getGroups(doc);    // [{ title: string | null, items: Item[] }]  (spec "groups")
getItems(doc);     // Item[]

createItem('Buy milk');
createItem({ status: 'checked', priority: 2, description: 'Ship it -> 2026-Q4 #work' });
updateItem(item, { status: 'checked' });   // returns a new item; derived fields recomputed
createDocument([
  { title: 'Groceries', items: ['Milk', { description: 'Eggs', status: 'checked' }] },
  { items: ['Ungrouped thing'] },
]);                                        // blank lines between groups added for you

parseDescription('Call #mum=today -> 2026-11-04');
// { tags: [...], dueDate: {...}, segments: [text | tag | due-date, ...] }  (for rendering chips etc.)
parseDueDate('2022/W52');
// { period: 'week', year: 2022, week: 52, text: '2022/W52', date: '2023-01-01' }
```

### Document model

```ts
interface XitDocument {
  blocks: Block[];
  newline?: '\n' | '\r\n';   // set by parse; default '\n'
  finalNewline?: boolean;     // set by parse; default true
  bom?: boolean;              // set by parse; default false
}
type Block = Title | Item | BlankLine | InvalidLine;

interface Title       { type: 'title'; text: string }
interface BlankLine   { type: 'blank'; raw?: string }    // raw keeps whitespace-only content
interface InvalidLine { type: 'invalid'; raw: string }   // written back exactly as read
interface Item {
  type: 'item';
  status: 'open' | 'checked' | 'ongoing' | 'obsolete' | 'in-question';
  priority: number;            // number of '!' (0 = none)
  description: string;         // continuation lines joined by '\n', 4-space indent removed
  readonly tags: Tag[];        // derived from description
  readonly dueDate: DueDate | null;  // derived from description (the first valid one)
  raw?: string;                // the item's source text, so formatting survives
}
interface Tag { name: string; value: string | null }   // value '' is null, per the spec
type DueDate = { text: string; date: string /* YYYY-MM-DD, last day of the period */ } & (
  | { period: 'day'; year: number; month: number; day: number }
  | { period: 'week'; year: number; week: number }
  | { period: 'month'; year: number; month: number }
  | { period: 'quarter'; year: number; quarter: number }
  | { period: 'year'; year: number });
```

**Blocks are a flat list; groups are worked out from it.** A list of
blocks can hold everything the spec allows and everything it rejects
(invalid lines, how many blank lines there are and what spaces they
contain), so nothing is lost. Groups are calculated by `getGroups`.

**Each item keeps its source as `raw`.** `stringify` writes an item's
`raw` text only when re-reading it gives the same `status`, `priority` and
`description`. Otherwise it writes the item fresh in the standard form.
So `..!` padding, `[ ] ` with a trailing space and the like survive while
an item is unchanged, and editing an item with
`{ ...item, status: 'checked' }` can't write stale text.

**Derived fields are read-only extras.** `stringify` reads only `status`,
`priority` and `description`. `tags` and `dueDate` are filled in by
`parse`, `createItem` and `updateItem`.

### Diagnostics

`{ severity, code, message, from, to, line, column }`. `from`/`to` are
UTF-16 offsets (what CodeMirror uses); `line`/`column` count from 1.

Errors (the line becomes an `invalid` block):
`invalid-checkbox`, `missing-space-after-checkbox`, `bad-indentation`,
`title-without-blank-line`.

Warnings (the content is still valid, but probably not what was meant;
all taken from the syntax guide): `malformed-priority` (`.!.`),
`misplaced-priority` (`[ ]    ! foo`), `invalid-due-date` (`-> 2022-13-01`,
`-> 2022-01/31`), `extra-due-date`, `unclosed-tag-value`,
`missing-final-newline`, `mixed-newlines`.

## Where the spec is unclear: decisions

| Question | Decision | Reason |
|---|---|---|
| What can come before `#` in a tag? | It can't follow a letter, digit, `_` or `-`. | The guide's `(#tag)` and `#tag1/#tag2` still work, and `page#anchor` / `C#7` aren't read as tags. The spec doesn't say. |
| Is a tab a blank character? | Yes: Unicode Zs plus U+0009. A deliberate deviation from the spec's glossary. | Read literally, a tab-only line isn't blank and `\tfoo` after a blank line is a title. The guide says "whitespace". |
| Do invalid lines split groups? | Yes. | Spec: a group is *consecutive* items. |
| Title straight after a title or an invalid line | Invalid. | Only a blank line or the start of the file may come before a title. |
| `[ ] .!. foo`, `[ ]    ! foo` (the guide calls these "invalid") | Valid item with no priority; a warning. | The guide still draws the checkbox. The text matches the description rule. |
| Due date that doesn't exist (`2022-02-30`, `2021-W53`) | Not a due date; a warning. | The spec says it must be representable in the Gregorian calendar. |
| Year `0000` | Accepted (ISO 8601 proleptic Gregorian). | The spec points to ISO 8601. |
| Comparing tag names | Case-insensitive via `toUpperCase().toLowerCase()`; `name` keeps its original case. | The spec says names are case-insensitive. |
| Lone `\r` | Ordinary content; only `\n` and `\r\n` end a line. | Spec glossary. |
| UTF-8 BOM | Removed and recorded in `bom`, then written back. | Writing back exactly what was read. |

## Testing (test-first)

- **Runner:** Node's built-in `node:test` runs the `.ts` tests directly
  (Node 26 strips types natively). So there's no test framework to trust,
  and `node --test --watch` gives a quick loop.
- **Order:** each module starts as a stub (`throw new Error('not implemented')`)
  so the type check passes, then the tests are written and seen to fail,
  then the code is written to make them pass. The modules come in this
  order:
  1. `due-date`: patterns, calendar checks, ISO weeks (including years
     with a week 53), last day of the period.
  2. `description`: tags, tag values, quoting, boundaries, due-date
     boundaries, segments.
  3. `parse`: sorting lines into blocks, groups, BOM, newlines, diagnostics.
  4. `stringify`: standard output, reusing `raw`, every rule that makes it
     throw.
  5. `build`: `createItem`, `updateItem`, `createDocument`.
- **Syntax-guide conformance suite:** a table of all ~150 guide examples,
  each with what the guide's own highlighting says (item, title or invalid;
  which bits are the priority, tags and due date). A one-off script drafts
  the table from the guide's HTML classes, and I review every row by hand.
- **Property tests** for goals 3 and 4: random documents, and random noisy
  strings built from the format's own pieces (`[`, `]`, `!`, `#`, `->`,
  digits, spaces, NBSP, tabs, newlines).
- **Browser safety:** the `lib`/`types` type check above, plus a test that
  imports the built `dist/` entry point.

## Tooling

- `mise.toml` pins `node = "26.13.0"` and `pnpm = "12.16.0"`, as in
  ~/graphite.
- `pnpm-workspace.yaml` copies graphite's supply-chain hardening
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`, `strictDepBuilds`).
- Dev dependencies: `typescript` (7.x) and `@types/node` (test files
  only). Possibly `fast-check`; see question 2.
- `tsc` builds to `dist/` (ESM `.js` + `.d.ts` + source maps).
  `package.json` `exports` uses the `types`/`default` conditions.
- Scripts: `test`, `test:watch`, `typecheck`, `build`.
- README with an API reference and the decisions table; AGENTS.md like
  graphite's.
