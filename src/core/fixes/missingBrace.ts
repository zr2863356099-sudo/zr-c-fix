export interface BraceFix {
  /** Insertion offset from the start of the document. */
  offset: number;
  /** Text to insert at `offset`. */
  insert: string;
}

/**
 * Builds the fix for a file whose only unclosed brace is the final `}`. More than one
 * unmatched open is ambiguous, so the fix is withheld (fail-closed).
 */
export function buildMissingBraceFix(
  text: string,
  unclosedCount: number,
): BraceFix | undefined {
  if (unclosedCount !== 1) {
    return undefined;
  }

  const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
  const lastLine = text.slice(lastBreak + 1);

  return {
    offset: text.length,
    insert: lastLine.trim().length === 0 ? '}' : '\n}',
  };
}
