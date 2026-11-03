// The demo page: a CodeMirror editor using xitjs/codemirror, with what the
// library makes of the text alongside, and controls to edit items with it.

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import {
  XitEditError, XitStringifyError, createItem, getGroups, parse, removeTag, setDueDate, setTag, stringify, tokenize,
  updateItem, validate, type Item, type Status, type XitDocument,
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

/** Colours for xit's tags, from CSS variables so they follow light and dark mode. */
const colours = HighlightStyle.define([
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
      syntaxHighlighting(colours),
      lintGutter(),
      // validate()'s diagnostics are already in @codemirror/lint's shape.
      linter((v) => validate(v.state.doc.toString()), { delay: 200 }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) render();
      }),
    ],
  }),
});

function setText(text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

// Sample picker ---------------------------------------------------------------

const sampleSelect = element<HTMLSelectElement>('sample');
samples.forEach((sample, i) => sampleSelect.add(new Option(sample.name, String(i))));
sampleSelect.addEventListener('change', () => setText(samples[Number(sampleSelect.value)]!.source));

// Output tabs -------------------------------------------------------------------

type Tab = 'document' | 'groups' | 'diagnostics' | 'tokens' | 'round-trip';
let tab: Tab = (load('xitjs-demo-tab') as Tab | null) ?? 'document';

for (const button of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
  button.addEventListener('click', () => {
    tab = button.dataset.tab as Tab;
    save('xitjs-demo-tab', tab);
    render();
  });
}

const output = element('output');

function render() {
  const source = view.state.doc.toString();
  const doc = parse(source);
  for (const button of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  renderBadge(source, doc);
  renderItemPicker(doc);
  switch (tab) {
    case 'document':
      output.innerHTML = `<pre>${escape(JSON.stringify(doc, null, 2))}</pre>`;
      break;
    case 'groups':
      output.innerHTML = renderGroups(doc);
      break;
    case 'diagnostics':
      output.innerHTML = renderDiagnostics(source);
      break;
    case 'tokens':
      output.innerHTML = renderTokens(source);
      break;
    case 'round-trip':
      output.innerHTML = renderRoundTrip(source, doc);
      break;
  }
}

function renderBadge(source: string, doc: XitDocument) {
  const badge = element('round-trip-badge');
  const same = stringify(doc) === source;
  badge.className = `badge ${same ? 'ok' : 'bad'}`;
  badge.textContent = same ? 'stringify(parse(text)) === text' : 'round trip differs';
}

function renderGroups(doc: XitDocument): string {
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
  for (const tag of item.tags) parts.push(`#${escape(tag.name)}${tag.value === null ? '' : `=${escape(JSON.stringify(tag.value))}`}`);
  if (item.dueDate) parts.push(`due ${escape(item.dueDate.text)} (by ${item.dueDate.date})`);
  return parts.join(' · ');
}

function renderDiagnostics(source: string): string {
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

function renderTokens(source: string): string {
  const rows = tokenize(source).map((t) => {
    const extra = t.type === 'tag'
      ? `${t.tag.name}${t.tag.value === null ? '' : ` = ${JSON.stringify(t.tag.value)}`}`
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

function renderRoundTrip(source: string, doc: XitDocument): string {
  let written: string;
  try {
    written = stringify(doc);
  } catch (error) {
    return `<p class="check bad">stringify threw: ${escape(String(error))}</p>`;
  }
  const same = written === source;
  // Compare as JSON: both are plain data, built in the same order.
  const reread = JSON.stringify(parse(written)) === JSON.stringify(doc);
  return `
    <p class="check ${same ? 'ok' : 'bad'}"><code>stringify(parse(text)) === text</code></p>
    <p class="check ${reread ? 'ok' : 'bad'}"><code>parse(stringify(doc))</code> gives back <code>doc</code></p>
    <p class="muted">stringify(parse(text)):</p>
    <pre>${escape(written)}</pre>`;
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

function syncItemControls(doc = parse(view.state.doc.toString())) {
  const selected = selectedItem(doc);
  if (!selected) return;
  element<HTMLSelectElement>('status').value = selected.item.status;
  element<HTMLInputElement>('priority').value = String(selected.item.priority);
}
itemSelect.addEventListener('change', () => syncItemControls());

/** Applies a change to the document and writes it back into the editor, or shows why it can't. */
function edit(describe: string, change: (doc: XitDocument) => XitDocument) {
  try {
    const before = parse(view.state.doc.toString());
    setText(stringify(change(before)));
    show(`${describe}: done.`, 'ok');
  } catch (error) {
    if (error instanceof XitEditError || error instanceof XitStringifyError) show(`${error.name}: ${error.message}`, 'error');
    else throw error;
  }
}

function editItem(describe: string, change: (item: Item) => Item) {
  edit(describe, (doc) => {
    const selected = selectedItem(doc);
    if (!selected) throw new XitEditError('Pick an item first.');
    return { ...doc, blocks: doc.blocks.with(selected.index, change(selected.item)) };
  });
}

function show(text: string, kind: 'ok' | 'error') {
  message.textContent = text;
  message.className = `message ${kind}`;
}

const value = (id: string) => element<HTMLInputElement>(id).value.trim();

element('apply-status').addEventListener('click', () => {
  const status = element<HTMLSelectElement>('status').value as Status;
  const priority = Number(value('priority'));
  editItem('updateItem', (item) => updateItem(item, { status, priority }));
});
element('set-tag').addEventListener('click', () => {
  editItem('setTag', (item) => setTag(item, value('tag-name'), value('tag-value') || null));
});
element('remove-tag').addEventListener('click', () => {
  editItem('removeTag', (item) => removeTag(item, value('tag-name')));
});
element('set-due').addEventListener('click', () => {
  editItem('setDueDate', (item) => setDueDate(item, value('due')));
});
element('clear-due').addEventListener('click', () => {
  editItem('setDueDate(null)', (item) => setDueDate(item, null));
});
element('add-item').addEventListener('click', () => {
  const text = value('new-item');
  edit('createItem', (doc) => {
    // After the last item, or at the end.
    const last = doc.blocks.findLastIndex((b) => b.type === 'item');
    return { ...doc, blocks: doc.blocks.toSpliced(last + 1, 0, createItem(text)) };
  });
});

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

render();
