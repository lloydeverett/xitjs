// xitjs/codemirror: [x]it! highlighting for CodeMirror 6, built on tokenizeLine.
//
//   import { xit, xitHighlightStyle } from 'xitjs/codemirror';
//   extensions: [xit(), syntaxHighlighting(xitHighlightStyle)]

import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { shiftTokens, startLineState, tokenizeLine } from './tokenize.ts';
import type { LineState, Status, Token } from './types.ts';

/**
 * The highlighting tags xit tokens get. Each derives from a standard tag, so
 * a theme that knows nothing of xit still highlights them. Every token of an
 * item also gets its status's tag (`open`, `checked` and so on), to style a
 * whole item by its status. Text and continuation-line indentation get only
 * that.
 */
export const xitTags = {
  title: Tag.define(tags.heading),
  checkbox: Tag.define(tags.atom),
  priority: Tag.define(tags.keyword),
  tag: Tag.define(tags.labelName),
  dueDate: Tag.define(tags.literal),
  invalid: Tag.define(tags.invalid),
  open: Tag.define(),
  checked: Tag.define(),
  ongoing: Tag.define(),
  obsolete: Tag.define(),
  inQuestion: Tag.define(),
} as const;

type TagName = keyof typeof xitTags;

const STATUS_TAG: Record<Status, TagName> = {
  open: 'open',
  checked: 'checked',
  ongoing: 'ongoing',
  obsolete: 'obsolete',
  'in-question': 'inQuestion',
};

const TOKEN_TAG: Partial<Record<Token['type'], TagName>> = {
  title: 'title',
  checkbox: 'checkbox',
  priority: 'priority',
  tag: 'tag',
  'due-date': 'dueDate',
  invalid: 'invalid',
};

/** The tag names StreamLanguage gets for a token (space-separated), or null for none. */
function style(token: Token): string | null {
  if (token.type === 'indent') return null;
  const names = [TOKEN_TAG[token.type], 'status' in token ? STATUS_TAG[token.status] : undefined];
  return names.filter((n) => n !== undefined).join(' ') || null;
}

/** StreamLanguage's state: mutable, so it wraps the tokenizer's frozen state. */
interface State {
  /** The state for the next line. */
  line: LineState;
  /** Whether the next line is the document's first (which may start with a byte-order mark). */
  firstLine: boolean;
  /** The tokens of the line being read, and the next one to emit. */
  tokens: readonly Token[];
  index: number;
}

/** [x]it! as a CodeMirror language. */
export const xitLanguage = StreamLanguage.define<State>({
  name: 'xit',
  startState: () => ({ line: startLineState(), firstLine: true, tokens: [], index: 0 }),
  copyState: (state) => ({ ...state }),
  blankLine(state) {
    state.line = tokenizeLine('', state.line).state;
    state.firstLine = false;
  },
  token(stream, state) {
    // Tokenize the whole line at its start; that also gives the state for the next one.
    if (stream.sol()) {
      // As in tokenize, a byte-order mark isn't part of the first line.
      const bom = state.firstLine && stream.string.startsWith('\uFEFF') ? 1 : 0;
      const { tokens, state: next } = tokenizeLine(stream.string.slice(bom), state.line);
      state.line = next;
      state.firstLine = false;
      state.tokens = bom ? shiftTokens(tokens, bom) : tokens;
      state.index = 0;
    }
    const token = state.tokens[state.index];
    if (!token) {
      stream.skipToEnd();
      return null;
    }
    // A space between tokens (after a checkbox or priority) has no style.
    if (stream.pos < token.from) {
      stream.pos = token.from;
      return null;
    }
    stream.pos = token.to;
    state.index++;
    return style(token);
  },
  tokenTable: xitTags,
});

/** The language, for an editor's extensions. */
export function xit(): LanguageSupport {
  return new LanguageSupport(xitLanguage);
}

/**
 * For code blocks in markdown, with `@codemirror/lang-markdown`:
 * `markdown({ codeLanguages: [xitLanguageDescription] })` highlights ```xit
 * blocks.
 */
export const xitLanguageDescription = LanguageDescription.of({
  name: '[x]it!',
  alias: ['xit'],
  extensions: ['xit'],
  support: xit(),
});

/**
 * A plain default style, with no colours so it suits any theme: titles and
 * priorities bold, checked and obsolete items faded (obsolete ones struck
 * through), invalid lines underlined. Colours come from the theme's styles
 * for the standard tags `xitTags` derive from.
 */
export const xitHighlightStyle = HighlightStyle.define([
  { tag: xitTags.title, fontWeight: 'bold' },
  { tag: xitTags.priority, fontWeight: 'bold' },
  { tag: xitTags.checked, opacity: '0.6' },
  { tag: xitTags.obsolete, opacity: '0.6', textDecoration: 'line-through' },
  { tag: xitTags.invalid, textDecoration: 'underline wavy' },
]);
