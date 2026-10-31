import type { Issue, Rule } from './types';
import { makeIssue, maskNonCode, rangeFromOffsets } from './utils';

/**
 * Typographic characters that NFKC leaves alone. Everything else goes through
 * normalization, so full-width punctuation, letters, digits and spaces are covered
 * without an exhaustive table.
 */
const SMALL_TABLE: ReadonlyMap<string, string> = new Map([
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
]);

export const rule: Rule = {
  id: 'non-ascii-in-code',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const masked = maskNonCode(ctx.text);
    const issues: Issue[] = [];
    let index = 0;

    while (index < masked.length) {
      const width = masked.codePointAt(index)! > 0xffff ? 2 : 1;
      const char = masked.slice(index, index + width);
      if (isAscii(char)) {
        index += width;
        continue;
      }

      const replacement = replacementFor(char);
      if (replacement === undefined) {
        issues.push(
          makeIssue(
            rule,
            rangeFromOffsets(ctx.text, index, index + width),
            `Non-ASCII character '${char}' in code`,
            `代码中有非 ASCII 字符 '${char}'`,
            undefined,
            'hint',
          ),
        );
        index += width;
        continue;
      }

      // Merge the adjacent run of fixable non-ASCII characters into one issue.
      const start = index;
      let newText = '';
      let firstChar = '';
      let firstReplacement = '';
      while (index < masked.length) {
        const runWidth = masked.codePointAt(index)! > 0xffff ? 2 : 1;
        const current = masked.slice(index, index + runWidth);
        if (isAscii(current)) {
          break;
        }
        const currentReplacement = replacementFor(current);
        if (currentReplacement === undefined) {
          break;
        }
        if (firstChar === '') {
          firstChar = current;
          firstReplacement = currentReplacement;
        }
        newText += currentReplacement;
        index += runWidth;
      }

      const range = rangeFromOffsets(ctx.text, start, index);
      issues.push(
        makeIssue(
          rule,
          range,
          `Non-ASCII '${firstChar}' in code; use '${firstReplacement}'`,
          `代码中有非 ASCII 字符 '${firstChar}'，应改为 '${firstReplacement}'`,
          { range, newText },
        ),
      );
    }

    return issues;
  },
};

function isAscii(char: string): boolean {
  return char.charCodeAt(0) <= 0x7f;
}

/** Single printable ASCII replacement, or undefined when the character is not fixable. */
function replacementFor(char: string): string | undefined {
  const normalized = char.normalize('NFKC');
  if (normalized.length === 1) {
    const code = normalized.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      return normalized;
    }
  }
  return SMALL_TABLE.get(char);
}
