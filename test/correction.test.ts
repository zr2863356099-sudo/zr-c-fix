import { describe, expect, it } from 'vitest';
import { buildInlineCorrection } from '../src/core/correction';
import type { Issue } from '../src/core/rules/types';

function fixIssue(
  ruleId: string,
  startChar: number,
  endChar: number,
  newText: string,
): Issue {
  const range = { startLine: 0, startChar, endLine: 0, endChar };
  return {
    ruleId,
    channel: 'ghost',
    severity: 'error',
    range,
    message: ruleId,
    messageZh: ruleId,
    fix: { range, newText },
  };
}

describe('buildInlineCorrection', () => {
  it('returns the whole corrected line in whole-line mode', () => {
    const issues = [
      fixIssue('scanf-missing-amp', 12, 12, '&'),
      fixIssue('format-type-mismatch', 7, 9, '%ld'),
    ];

    expect(buildInlineCorrection(issues, 0, 'scanf("%d", x);', 'whole-line')).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 15 },
      newText: 'scanf("%ld", &x);',
      ruleId: 'format-type-mismatch',
    });
  });

  it('narrows to the first accepted fix in fragment mode', () => {
    const issues = [
      fixIssue('scanf-missing-amp', 12, 13, '&x'),
      fixIssue('format-type-mismatch', 7, 9, '%ld'),
    ];

    expect(buildInlineCorrection(issues, 0, 'scanf("%d", x);', 'fragment')).toEqual({
      range: { startLine: 0, startChar: 7, endLine: 0, endChar: 9 },
      newText: '%ld',
      ruleId: 'format-type-mismatch',
    });
  });

  it('returns null when the line has no accepted fix', () => {
    expect(buildInlineCorrection([], 0, 'int x = 0;', 'whole-line')).toBeNull();
    expect(
      buildInlineCorrection(
        [{ ...fixIssue('a', 0, 1, 'B'), fix: undefined }],
        0,
        'abc',
        'fragment',
      ),
    ).toBeNull();
  });
});
