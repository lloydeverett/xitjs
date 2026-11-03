// Character classes from the spec's glossary.

const ZS = /^\p{Zs}$/u;
const PUNCTUATION = /^\p{P}$/u;

/**
 * A blank character: Unicode Zs (spaces, including NBSP), plus tab. The spec's
 * glossary says Zs only; the syntax guide says "whitespace", and without tab a
 * tab-only line wouldn't be blank, so tab is included on purpose.
 */
export function isBlankChar(char: string): boolean {
  return char === '\t' || ZS.test(char);
}

/** A line that is empty or only blank characters. */
export function isBlankLine(line: string): boolean {
  for (const char of line) if (!isBlankChar(char)) return false;
  return true;
}

export function isPunctuation(char: string): boolean {
  return PUNCTUATION.test(char);
}

/** Matches one or more tag name characters (letters, ASCII digits, `_`, `-`) at `lastIndex`. */
export const TAG_NAME = /[\p{L}0-9_-]+/uy;

/** The whole code point that starts at `index`, or '' at the end. */
export function charAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? '' : String.fromCodePoint(code);
}

/** The whole code point that ends just before `index`, or '' at the start. */
export function charBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.slice(index - 1, index);
}
