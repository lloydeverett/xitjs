import { scanDescription } from './description.ts';
import { CHECKBOX_WIDTH, INDENT } from './item.ts';
import { START, readLine, splitLines } from './lines.ts';
import type { LineState, Status, Token } from './types.ts';

/**
 * Where each piece of a document's syntax is, for highlighting: titles,
 * checkboxes, priorities, tags, due dates and so on, in order, with offsets
 * into `source`. Every character belongs to one token, except line endings, a
 * byte-order mark, and the single space after a checkbox or priority marker.
 *
 * It reads the document exactly as `parse` does, and never throws.
 */
export function tokenize(source: string): Token[] {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const tokens: Token[] = [];
  let state = START;
  for (const line of splitLines(source, bom).lines) {
    const result = tokenizeLine(line.text, state);
    for (const token of result.tokens) tokens.push({ ...token, from: token.from + line.start, to: token.to + line.start });
    state = result.state;
  }
  return tokens;
}

/** The state to tokenize a document's first line with. */
export function startLineState(): LineState {
  return START;
}

/**
 * Tokenizes one line (without its line ending), given the state the line
 * before it left, and returns the state for the line after it. Offsets are
 * into `text`. This is what an editor that highlights line by line needs (like
 * CodeMirror's `StreamLanguage`): the state is all that's carried between
 * lines.
 */
export function tokenizeLine(text: string, state: LineState): { tokens: Token[]; state: LineState } {
  const { line, state: next } = readLine(text, state);
  const whole = { from: 0, to: text.length };
  switch (line.kind) {
    case 'blank':
      return { tokens: text === '' ? [] : [{ type: 'blank', ...whole }], state: next };
    case 'title':
      return { tokens: [{ type: 'title', ...whole }], state: next };
    case 'invalid':
      return { tokens: [{ type: 'invalid', code: line.code, ...whole }], state: next };
    case 'item': {
      const { status, marker } = line;
      const tokens: Token[] = [{ type: 'checkbox', status, from: 0, to: CHECKBOX_WIDTH }];
      if (marker !== null) {
        const from = CHECKBOX_WIDTH + 1;
        tokens.push({ type: 'priority', status, from, to: from + marker.length });
      }
      return description(text, line.description, status, tokens, next);
    }
    case 'continuation': {
      // readLine only finds a continuation line while an item is open, and an open item has a status.
      const status = state.status!;
      const tokens: Token[] = [{ type: 'indent', status, from: 0, to: INDENT.length }];
      return description(text, INDENT.length, status, tokens, next);
    }
  }
}

/** Adds the tokens of a line's description, which starts at `start`. */
function description(
  text: string,
  start: number,
  status: Status,
  tokens: Token[],
  state: LineState,
): { tokens: Token[]; state: LineState } {
  const scanned = scanDescription(text.slice(start), state.hasDueDate);
  let from = start;
  for (const segment of scanned.segments) {
    const to = from + segment.text.length;
    if (segment.type === 'tag') tokens.push({ type: 'tag', status, tag: segment.tag, from, to });
    else if (segment.type === 'due-date') tokens.push({ type: 'due-date', status, dueDate: segment.dueDate, from, to });
    else tokens.push({ type: 'text', status, from, to });
    from = to;
  }
  const hasDueDate = state.hasDueDate || scanned.dueDate !== null;
  return { tokens, state: hasDueDate === state.hasDueDate ? state : Object.freeze({ ...state, hasDueDate }) };
}
