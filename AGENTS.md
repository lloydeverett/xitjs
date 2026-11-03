# Agent notes

xitjs parses and writes [x]it! documents. `README.md` covers the API and
the decisions where the spec is unclear. `docs/xit-specification-1.1.md` is
the spec, and `docs/PLAN.md` the original design.

## Tools

Node and pnpm are pinned in `mise.toml` and aren't on the PATH otherwise;
run pnpm as `mise exec -- pnpm <script>`. The main entry has no runtime
dependencies, and that should stay so: only `src/codemirror.ts` (the
`xitjs/codemirror` entry) imports anything, and only its optional peer
dependencies, `@codemirror/language` and `@lezer/highlight`.
`pnpm test:dist` checks this. Dev dependencies must be widely used and well
trusted; ask before adding one. `pnpm-workspace.yaml` refuses releases under
a week old.

## Before calling a change done

All must pass:

```sh
pnpm typecheck
pnpm test
pnpm test:dist
```

Work test-first: write the test, see it fail, then make it pass. Run
`pnpm test:fuzz` after changing the parser, the tokenizer or `stringify`.

## Things to know

- `src/` must run in browsers too. `tsconfig.json` has `lib: ["ES2022"]` and
  `types: []`, so a Node or DOM API fails the type check. Don't loosen it.
  Tests (`tsconfig.test.json`) may use Node and newer APIs.
- Imports in `src/` use `.ts` extensions. Node runs the tests with its
  built-in type stripping, and `tsc` rewrites the extensions to `.js` when
  building. Only erasable TypeScript is allowed (`erasableSyntaxOnly`: no
  enums, namespaces or parameter properties).
- There are two promises, each with property tests in
  `test/round-trip.test.ts`:
  1. `stringify(parse(s)) === s` for any `s` with one kind of line ending.
  2. `parse(stringify(doc))` gives back `doc` for any document `stringify`
     accepts. It throws `XitStringifyError` rather than break this.
  A change to either side must keep both.
- `stringify` writes an item's `raw` source only if re-parsing it gives the
  same status, priority and description. `tags` and `dueDate` are derived
  and never written.
- The grammar's pieces (checkbox, priority marker, tag name, indent) are
  each defined once, in `src/item.ts` and `src/chars.ts`. The checkbox
  pattern is built from `STATUS_CHARS`. `descriptionProblem` (`src/item.ts`)
  is the one place that says which descriptions can be written, and both
  `stringify` and the editing helpers use it.
- `readLine` (`src/lines.ts`) is the one place that decides what a line
  is, from the state the lines before it left. `parse` builds blocks from
  it and `tokenizeLine` builds tokens; property tests in
  `test/tokenize.test.ts` hold the two in agreement.
- The one description scanner is `scanDescription` (`src/description.ts`):
  tags, due dates and their warnings. `parse` scans a whole description and
  maps its offsets back to the source; `tokenizeLine` scans one line at a
  time, passing whether the item already has its due date.
- `setTag`, `removeTag` and `setDueDate` (`src/edit.ts`) edit the
  description text. Each tries the tidiest change first and keeps it only
  if re-reading gives exactly the intended tags and due date; otherwise it
  throws `XitEditError`. Keep that check: it's what stops an edit from
  quietly changing text next to it.
- `test/fixtures/syntax-guide.json` is generated (`scripts/guide_fixture.py`);
  don't edit it by hand. Where we read a guide example differently, it's
  listed in `DEVIATIONS` in `test/syntax-guide.test.ts`.
- Write invisible or special characters as escapes (`'\uFEFF'`,
  `'\u00a0'`), never as literal characters.
