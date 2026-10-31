/**
 * Rules that intentionally operate on missing/ERROR nodes. They stay eligible while the
 * file has syntax errors; every other rule waits for a complete parse.
 *
 * Admission criteria: the fix replaces one token or one spot on a single line, and its
 * detection does not depend on the whole syntax tree being sound.
 */
export const SYNTAX_REPAIR_RULES: ReadonlySet<string> = new Set([
  'non-ascii-in-code',
  'missing-semicolon',
  'stray-literal',
  'char-string-literal',
  'missing-include-hash',
  'unknown-type',
]);

/**
 * Rules whose purpose is to report a syntax problem itself. Unlike repair rules they
 * have no token-level fix, so they must stay visible on lines covered by an ERROR;
 * hiding them would make the diagnostic explain itself away.
 */
export const SYNTAX_REPORT_RULES: ReadonlySet<string> = new Set([
  'unbalanced-braces',
  'incomplete-expression',
]);
