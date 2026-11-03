// The demo page: a CodeMirror editor using xitjs/codemirror, with what the
// library makes of the text alongside, and controls to edit items with it.

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import {
  XitEditError, XitParseError, XitStringifyError, createItem, getGroups, parse, parseDescription, parseDueDate,
  removeTag, setDueDate, setTag, stringify, tokenize, updateItem, validate,
  type Item, type Newline, type Status, type Tag, type XitDocument,
} from '../src/index.ts';
import { xit, xitHighlightStyle, xitTags } from '../src/codemirror.ts';
import guide from '../test/fixtures/syntax-guide.json';

// Samples ---------------------------------------------------------------------

const REALISTIC = `Groceries
[ ] Milk #shop
[x] ! Eggs -> 2026-11-04
[@] Bread #shop=bakery
    (the sourdough one)

Work
[ ] !! Finish report -> 2026-W45 #work
[~] Old task
[?] Maybe? #idea="needs thought"
[ ]   ! misplaced priority (a warning)
[*] not a valid checkbox (an error)

[ ] Ungrouped
`;

const samples: Array<{ name: string; source: string }> = [
  { name: 'A realistic file', source: REALISTIC },
  { name: 'Every syntax guide example', source: guide.listings.map((l) => l.source).join('\n') },
  ...guide.listings.map((l) => ({ name: `Guide · ${l.section}: ${l.annotation}`, source: l.source })),
];

// Editor ----------------------------------------------------------------------

/**
 * This page's colours for xit's tags (from CSS variables, so they follow
 * light and dark mode). xitHighlightStyle adds the colour-free styling.
 */
const xitColours = HighlightStyle.define([
  { tag: xitTags.title, color: 'var(--xit-title)' },
  { tag: xitTags.checkbox, color: 'var(--xit-checkbox)' },
  { tag: xitTags.priority, color: 'var(--xit-priority)' },
  { tag: xitTags.tag, color: 'var(--xit-tag)' },
  { tag: xitTags.dueDate, color: 'var(--xit-due)' },
  { tag: xitTags.invalid, color: 'var(--xit-invalid)' },
]);

const view = new EditorView({
  parent: element('editor'),
  state: EditorState.create({
    doc: REALISTIC,
    extensions: [
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      xit(),
      syntaxHighlighting(xitHighlightStyle),
      syntaxHighlighting(xitColours),
      lintGutter(),
      // validate()'s diagnostics are already in @codemirror/lint's shape.
      linter((v) => validate(v.state.doc.toString()), { delay: 200 }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) render();
      }),
    ],
  }),
});

/** The editor's text. (CodeMirror writes every line ending as \n.) */
function editorText(): string {
  return view.state.doc.toString();
}

function setEditorText(text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

// Sample picker ---------------------------------------------------------------

const sampleSelect = element<HTMLSelectElement>('sample');
samples.forEach((sample, i) => sampleSelect.add(new Option(sample.name, String(i))));
sampleSelect.addEventListener('change', () => setEditorText(samples[Number(sampleSelect.value)]!.source));

// Output tabs -------------------------------------------------------------------

/** What every tab is shown from: the text, and what parse made of it. */
interface Parsed {
  source: string;
  doc: XitDocument;
}

/** Options for the parse and stringify tabs. */
const options = { strict: false, newline: '\n' as Newline, finalNewline: true };

/** Each tab: its button's label, any options it has, and how it renders. */
const TABS = {
  document: { label: 'parse', options: strictOption, render: renderDocument },
  groups: { label: 'getGroups', options: null, render: renderGroups },
  diagnostics: { label: 'validate', options: null, render: renderDiagnostics },
  tokens: { label: 'tokenize', options: null, render: renderTokens },
  'round-trip': { label: 'stringify', options: stringifyOptions, render: renderRoundTrip },
} satisfies Record<string, { label: string; options: (() => string) | null; render: (parsed: Parsed) => string }>;

type Tab = keyof typeof TABS;

const isTab = (id: string | null | undefined): id is Tab => id != null && Object.hasOwn(TABS, id);

const TAB_KEY = 'xitjs-demo-tab';
const stored = load(TAB_KEY);
let tab: Tab = isTab(stored) ? stored : 'document';

const tabButtons = Object.entries(TABS).map(([id, { label }]) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.dataset.tab = id;
  button.addEventListener('click', () => selectTab(id as Tab));
  element('tabs').append(button);
  return button;
});

const output = element('output');
const optionsBox = element('options');

function selectTab(id: Tab) {
  tab = id;
  save(TAB_KEY, id);
  for (const button of tabButtons) button.setAttribute('aria-selected', String(button.dataset.tab === id));
  // Options are drawn only when the tab changes, so typing in the editor never resets them.
  optionsBox.innerHTML = TABS[id].options?.() ?? '';
  render();
}

function render() {
  const source = editorText();
  const parsed = { source, doc: parse(source) };
  renderBadge(parsed);
  renderItemPicker(parsed.doc);
  output.innerHTML = TABS[tab].render(parsed);
}

optionsBox.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input.name === 'strict') options.strict = (input as HTMLInputElement).checked;
  if (input.name === 'newline') options.newline = input.value === 'crlf' ? '\r\n' : '\n';
  if (input.name === 'final-newline') options.finalNewline = (input as HTMLInputElement).checked;
  render();
});

/** `stringify(parse(text)) === text`, and whether `parse(stringify(doc))` gives back `doc`. */
function roundTrip({ source, doc }: Parsed) {
  const written = stringify(doc);
  // Compare as JSON: both are plain data, built in the same order.
  return { written, same: written === source, reread: JSON.stringify(parse(written)) === JSON.stringify(doc) };
}

function renderBadge(parsed: Parsed) {
  const badge = element('round-trip-badge');
  const { same } = roundTrip(parsed);
  badge.className = `badge ${same ? 'ok' : 'bad'}`;
  badge.textContent = same ? 'stringify(parse(text)) === text' : 'round trip differs';
}

function strictOption(): string {
  return `<label><input type="checkbox" name="strict" ${options.strict ? 'checked' : ''} /> strict</label>`;
}

function renderDocument({ source, doc }: Parsed): string {
  if (!options.strict) return `<pre>${escape(JSON.stringify(doc, null, 2))}</pre>`;
  try {
    return `<pre>${escape(JSON.stringify(parse(source, { strict: true }), null, 2))}</pre>`;
  } catch (error) {
    if (!(error instanceof XitParseError)) throw error;
    const lines = error.diagnostics.map((d) => `line ${d.line}: ${d.code}`).join('\n');
    return `<p class="check bad">parse(text, { strict: true }) threw a XitParseError</p><pre>${escape(lines)}</pre>`;
  }
}

function renderGroups({ doc }: Parsed): string {
  const groups = getGroups(doc);
  if (groups.length === 0) return '<p class="muted">No groups.</p>';
  return groups.map((group) => `
    <div class="group">
      <h3>${group.title === null ? '<span class="muted">(no title)</span>' : escape(group.title)}</h3>
      <ul>${group.items.map((item) => `<li>${describeItem(item)}</li>`).join('')}</ul>
    </div>`).join('');
}

function describeItem(item: Item): string {
  const parts = [`<strong>${item.status}</strong>`];
  if (item.priority > 0) parts.push(`priority ${item.priority}`);
  parts.push(`<code>${escape(JSON.stringify(item.description))}</code>`);
  for (const tag of item.tags) parts.push(escape(`#${formatTag(tag)}`));
  if (item.dueDate) parts.push(`due ${escape(item.dueDate.text)} (by ${item.dueDate.date})`);
  return parts.join(' · ');
}

/** A tag as `name` or `name = "value"`. */
function formatTag(tag: Tag): string {
  return tag.value === null ? tag.name : `${tag.name} = ${JSON.stringify(tag.value)}`;
}

function renderDiagnostics({ source }: Parsed): string {
  const diagnostics = validate(source);
  if (diagnostics.length === 0) return '<p class="muted">No errors or warnings.</p>';
  const rows = diagnostics.map((d) => `
    <tr class="clickable" data-from="${d.from}">
      <td class="${d.severity}">${d.severity}</td>
      <td><code>${d.code}</code></td>
      <td>${d.line}:${d.column}</td>
      <td>${escape(d.message)}</td>
    </tr>`).join('');
  return `<table><tr><th>Severity</th><th>Code</th><th>Line:col</th><th>Message</th></tr>${rows}</table>`;
}

function renderTokens({ source }: Parsed): string {
  const rows = tokenize(source).map((t) => {
    const extra = t.type === 'tag' ? formatTag(t.tag)
      : t.type === 'due-date' ? `${t.dueDate.period}, by ${t.dueDate.date}`
      : t.type === 'invalid' ? t.code
      : '';
    return `
      <tr class="clickable" data-from="${t.from}" data-to="${t.to}">
        <td>${t.type}</td>
        <td>${t.from}–${t.to}</td>
        <td><code>${escape(JSON.stringify(source.slice(t.from, t.to)))}</code></td>
        <td>${'status' in t ? t.status : ''}</td>
        <td>${escape(extra)}</td>
      </tr>`;
  }).join('');
  return `<table><tr><th>Type</th><th>Range</th><th>Text</th><th>Status</th><th></th></tr>${rows}</table>`;
}

function stringifyOptions(): string {
  return `
    <label>newline
      <select name="newline">
        <option value="lf" ${options.newline === '\n' ? 'selected' : ''}>\\n</option>
        <option value="crlf" ${options.newline === '\r\n' ? 'selected' : ''}>\\r\\n</option>
      </select>
    </label>
    <label><input type="checkbox" name="final-newline" ${options.finalNewline ? 'checked' : ''} /> finalNewline</label>`;
}

function renderRoundTrip(parsed: Parsed): string {
  const { written, same, reread } = roundTrip(parsed);
  let withOptions: string;
  try {
    withOptions = stringify(parsed.doc, { newline: options.newline, finalNewline: options.finalNewline });
  } catch (error) {
    if (!(error instanceof XitStringifyError)) throw error;
    withOptions = `${error.name}: ${error.message}`;
  }
  const newline = options.newline === '\n' ? '\\n' : '\\r\\n';
  return `
    <p class="check ${same ? 'ok' : 'bad'}"><code>stringify(parse(text)) === text</code></p>
    <p class="check ${reread ? 'ok' : 'bad'}"><code>parse(stringify(doc))</code> gives back <code>doc</code></p>
    <p class="muted">stringify(parse(text)):</p>
    <pre>${escape(written)}</pre>
    <p class="muted">stringify(doc, { newline: '${newline}', finalNewline: ${options.finalNewline} }), as a string:</p>
    <pre>${escape(JSON.stringify(withOptions))}</pre>`;
}

// Clicking a diagnostic or token selects it in the editor.
output.addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-from]');
  if (!row) return;
  const from = Number(row.dataset.from);
  const to = Number(row.dataset.to ?? row.dataset.from);
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
});

// Editing items -----------------------------------------------------------------

const itemSelect = element<HTMLSelectElement>('item');
const message = element('edit-message');

/** Lists the document's items by block index, keeping the selection where it can. */
function renderItemPicker(doc: XitDocument) {
  const selected = itemSelect.value;
  itemSelect.replaceChildren();
  doc.blocks.forEach((block, index) => {
    if (block.type !== 'item') return;
    const first = block.raw?.split('\n')[0] ?? block.description;
    itemSelect.add(new Option(first, String(index)));
  });
  if ([...itemSelect.options].some((o) => o.value === selected)) itemSelect.value = selected;
  syncItemControls(doc);
}

function selectedItem(doc: XitDocument): { index: number; item: Item } | null {
  const index = Number(itemSelect.value);
  const block = doc.blocks[index];
  return itemSelect.value !== '' && block?.type === 'item' ? { index, item: block } : null;
}

function syncItemControls(doc: XitDocument) {
  const selected = selectedItem(doc);
  if (!selected) return;
  element<HTMLSelectElement>('status').value = selected.item.status;
  element<HTMLInputElement>('priority').value = String(selected.item.priority);
}
itemSelect.addEventListener('change', () => syncItemControls(parse(editorText())));

/** Applies a change to the document and writes it back into the editor, or shows why it can't. */
function edit(action: string, change: (doc: XitDocument) => XitDocument) {
  try {
    setEditorText(stringify(change(parse(editorText()))));
    show(`${action}: done.`, 'ok');
  } catch (error) {
    if (error instanceof XitEditError || error instanceof XitStringifyError) show(`${error.name}: ${error.message}`, 'error');
    else throw error;
  }
}

function editItem(action: string, change: (item: Item) => Item) {
  edit(action, (doc) => {
    const selected = selectedItem(doc);
    if (!selected) throw new XitEditError('Pick an item first.');
    return { ...doc, blocks: doc.blocks.with(selected.index, change(selected.item)) };
  });
}

function show(text: string, kind: 'ok' | 'error') {
  message.textContent = text;
  message.className = `message ${kind}`;
}

/** The trimmed text of an input. */
const inputText = (id: string) => element<HTMLInputElement>(id).value.trim();

element('apply-status').addEventListener('click', () => {
  const status = element<HTMLSelectElement>('status').value as Status;
  const priority = Number(inputText('priority'));
  editItem('updateItem', (item) => updateItem(item, { status, priority }));
});
element('set-tag').addEventListener('click', () => {
  editItem('setTag', (item) => setTag(item, inputText('tag-name'), inputText('tag-value') || null));
});
element('remove-tag').addEventListener('click', () => {
  editItem('removeTag', (item) => removeTag(item, inputText('tag-name')));
});
element('set-due').addEventListener('click', () => {
  editItem('setDueDate', (item) => setDueDate(item, inputText('due')));
});
element('clear-due').addEventListener('click', () => {
  editItem('setDueDate(null)', (item) => setDueDate(item, null));
});
element('add-item').addEventListener('click', () => {
  const text = inputText('new-item');
  edit('createItem', (doc) => {
    // After the last item, or at the end.
    const last = doc.blocks.findLastIndex((b) => b.type === 'item');
    return { ...doc, blocks: doc.blocks.toSpliced(last + 1, 0, createItem(text)) };
  });
});

// Trying a description or a due date ------------------------------------------

const descriptionInput = element<HTMLInputElement>('try-description');
const dueInput = element<HTMLInputElement>('try-due');

function renderTries() {
  element('description-output').textContent =
    `parseDescription(…) = ${JSON.stringify(parseDescription(descriptionInput.value), null, 2)}`;
  element('due-output').textContent =
    `parseDueDate(${JSON.stringify(dueInput.value)}) = ${JSON.stringify(parseDueDate(dueInput.value), null, 2)}`;
}
descriptionInput.addEventListener('input', renderTries);
dueInput.addEventListener('input', renderTries);

// Helpers ---------------------------------------------------------------------

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`No #${id}`);
  return found as T;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, text: string) {
  try {
    localStorage.setItem(key, text);
  } catch {
    // Storage may be unavailable (private windows); the tab just isn't remembered.
  }
}

selectTab(tab);
renderTries();
