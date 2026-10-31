import { describe, expect, it } from 'vitest';
import { isIssueVisible } from '../src/core/issueVisibility';
import type { Channel, Issue } from '../src/core/rules/types';

const SYNTAX_REPAIRS = new Set(['missing-semicolon']);

function issue(ruleId: string, channel: Channel, line: number): Issue {
  return {
    ruleId,
    channel,
    severity: 'error',
    range: { startLine: line, startChar: 0, endLine: line, endChar: 1 },
    message: ruleId,
    messageZh: ruleId,
  };
}

describe('isIssueVisible', () => {
  it('shows every issue when the file has no syntax error', () => {
    expect(
      isIssueVisible(issue('format-type-mismatch', 'ghost', 0), {
        hasError: false,
        errorLines: new Set([0]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(true);
  });

  it('hides a non-syntax issue on a line covered by an ERROR', () => {
    expect(
      isIssueVisible(issue('format-type-mismatch', 'ghost', 3), {
        hasError: true,
        errorLines: new Set([3, 4]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(false);
  });

  it('shows syntax repair rules on an error line', () => {
    expect(
      isIssueVisible(issue('missing-semicolon', 'ghost', 3), {
        hasError: true,
        errorLines: new Set([3]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(true);
  });

  it('shows issues on lines the parser did not flag', () => {
    expect(
      isIssueVisible(issue('format-type-mismatch', 'ghost', 8), {
        hasError: true,
        errorLines: new Set([3, 4]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(true);
  });

  it('shows syntax report rules on an error line', () => {
    for (const ruleId of [
      'unbalanced-braces',
      'incomplete-expression',
    ]) {
      expect(
        isIssueVisible(issue(ruleId, 'hint', 3), {
          hasError: true,
          errorLines: new Set([3]),
          syntaxRepairRules: SYNTAX_REPAIRS,
        }),
      ).toBe(true);
    }
  });

  it('hides a hint-channel issue on an error line', () => {
    expect(
      isIssueVisible(issue('shadowing', 'hint', 3), {
        hasError: true,
        errorLines: new Set([3]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(false);
  });

  it('hides undeclared-variable on a line covered by an ERROR', () => {
    expect(
      isIssueVisible(issue('undeclared-variable', 'hint', 3), {
        hasError: true,
        errorLines: new Set([3]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(false);
  });

  it('shows undeclared-variable on a line the parser did not flag', () => {
    expect(
      isIssueVisible(issue('undeclared-variable', 'hint', 8), {
        hasError: true,
        errorLines: new Set([3]),
        syntaxRepairRules: SYNTAX_REPAIRS,
      }),
    ).toBe(true);
  });
});
