import type { Diagnostic } from './types.ts';

/** Thrown by `parse(source, { strict: true })` when the source has errors. */
export class XitParseError extends Error {
  override name = 'XitParseError';
  /** Every error-severity diagnostic in the source. */
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const [first] = diagnostics;
    const summary = first ? `${first.line}:${first.column}: ${first.message}` : 'invalid document';
    const more = diagnostics.length > 1 ? ` (and ${diagnostics.length - 1} more)` : '';
    super(`${summary}${more}`);
    this.diagnostics = diagnostics;
  }
}

/** Thrown by `stringify` when a document can't be written so that it reads back the same. */
export class XitStringifyError extends Error {
  override name = 'XitStringifyError';
  /** The index in `blocks` of the block that couldn't be written. */
  readonly blockIndex: number;

  constructor(message: string, blockIndex: number) {
    super(`blocks[${blockIndex}]: ${message}`);
    this.blockIndex = blockIndex;
  }
}

/** Thrown by `setTag`, `removeTag` and `setDueDate` when an edit can't be made as asked. */
export class XitEditError extends Error {
  override name = 'XitEditError';
}
