import type { Rule } from './types';
import { makeIssue, maskNonCode } from './utils';

const INCLUDE = 'include';
const HEADER_PATTERN = /<[^>]+>/;

export const rule: Rule = {
  id: 'missing-include-hash',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const lines = splitLines(maskNonCode(ctx.text));
    const issues = [];
    let depth = 0;

    for (let line = 0; line < lines.length; line++) {
      const text = lines[line] ?? '';
      if (depth === 0) {
        const match = /^([ \t]*)include\b/.exec(text);
        if (match) {
          const column = match[1]?.length ?? 0;
          const rest = text.slice(column + INCLUDE.length);
          if (HEADER_PATTERN.test(rest)) {
            issues.push(
              makeIssue(
                rule,
                {
                  startLine: line,
                  startChar: column,
                  endLine: line,
                  endChar: column + INCLUDE.length,
                },
                "Missing '#' before include",
                "include 前缺少 '#'",
                {
                  range: {
                    startLine: line,
                    startChar: column,
                    endLine: line,
                    endChar: column,
                  },
                  newText: '#',
                },
              ),
            );
          }
        }
      }

      for (const ch of text) {
        if (ch === '{') {
          depth++;
        } else if (ch === '}' && depth > 0) {
          depth--;
        }
      }
    }

    return issues;
  },
};

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}
