import { describe, expect, it } from 'vitest';
import { mergeLineFixes } from '../src/core/merge';
import type { Channel, Issue, Range, Severity } from '../src/core/rules/types';

function makeIssue(
  ruleId: string,
  severity: Severity,
  fix?: { range: Range; newText: string },
): Issue {
  const channel: Channel = 'ghost';
  return {
    ruleId,
    channel,
    severity,
    range: fix?.range ?? { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
    message: ruleId,
    messageZh: ruleId,
    ...(fix ? { fix } : {}),
  };
}

describe('mergeLineFixes', () => {
  it('returns null when the line has no fixes', () => {
    expect(mergeLineFixes([], 0, 'int x = 1\n')).toBeNull();
    expect(
      mergeLineFixes(
        [makeIssue('missing-semicolon', 'error')],
        0,
        'int x = 1\n',
      ),
    ).toBeNull();
  });

  it('turns a single insertion into a whole-line replacement', () => {
    const issues = [
      makeIssue('missing-semicolon', 'error', {
        range: { startLine: 0, startChar: 9, endLine: 0, endChar: 9 },
        newText: ';',
      }),
    ];

    expect(mergeLineFixes(issues, 0, 'int x = 1\n')).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 9 },
      newText: 'int x = 1;',
    });
  });

  it('applies non-overlapping fixes from right to left', () => {
    const issues = [
      makeIssue('a', 'warning', {
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 1 },
        newText: 'X',
      }),
      makeIssue('b', 'warning', {
        range: { startLine: 0, startChar: 2, endLine: 0, endChar: 3 },
        newText: 'Y',
      }),
    ];

    expect(mergeLineFixes(issues, 0, 'abcd\n')?.newText).toBe('XbYd');
  });

  it('keeps the higher severity when fixes overlap', () => {
    const issues = [
      makeIssue('assignment-in-condition', 'warning', {
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 3 },
        newText: 'X',
      }),
      makeIssue('missing-semicolon', 'error', {
        range: { startLine: 0, startChar: 1, endLine: 0, endChar: 4 },
        newText: 'Y',
      }),
    ];

    expect(mergeLineFixes(issues, 0, 'abcdef\n')).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 6 },
      newText: 'aYef',
    });
  });

  it('merges three fixes into one replacement when two overlap', () => {
    const issues = [
      makeIssue('a', 'warning', {
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 2 },
        newText: 'X',
      }),
      makeIssue('b', 'error', {
        range: { startLine: 0, startChar: 1, endLine: 0, endChar: 3 },
        newText: 'Y',
      }),
      makeIssue('c', 'warning', {
        range: { startLine: 0, startChar: 5, endLine: 0, endChar: 6 },
        newText: 'Z',
      }),
    ];

    expect(mergeLineFixes(issues, 0, 'abcdefgh\n')).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 8 },
      newText: 'aYdeZgh',
    });
  });

  it('breaks equal-severity overlap by rule order', () => {
    const issues = [
      makeIssue('missing-semicolon', 'warning', {
        range: { startLine: 0, startChar: 2, endLine: 0, endChar: 5 },
        newText: 'Y',
      }),
      makeIssue('assignment-in-condition', 'warning', {
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 3 },
        newText: 'X',
      }),
    ];

    expect(mergeLineFixes(issues, 0, 'abcdef\n')?.newText).toBe('Xdef');
  });

  it('ignores a fix anchored on a different line than its issue', () => {
    const issue: Issue = {
      ruleId: 'uninitialized-use',
      channel: 'hint',
      severity: 'warning',
      range: { startLine: 1, startChar: 0, endLine: 1, endChar: 1 },
      message: 'x',
      messageZh: 'x',
      fix: {
        range: { startLine: 0, startChar: 5, endLine: 0, endChar: 5 },
        newText: ' = 0',
      },
    };

    expect(mergeLineFixes([issue], 0, 'int x;\nuse(x);\n')).toBeNull();
  });

  it('still merges a fix anchored on the issue line', () => {
    const issue: Issue = {
      ruleId: 'uninitialized-use',
      channel: 'hint',
      severity: 'warning',
      range: { startLine: 0, startChar: 14, endLine: 0, endChar: 15 },
      message: 'x',
      messageZh: 'x',
      fix: {
        range: { startLine: 0, startChar: 5, endLine: 0, endChar: 5 },
        newText: ' = 0',
      },
    };

    expect(mergeLineFixes([issue], 0, 'int x; printf(x);')).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 17 },
      newText: 'int x = 0; printf(x);',
    });
  });

  it('ignores fixes on another line or outside the line bounds', () => {
    const otherLine = makeIssue('a', 'error', {
      range: { startLine: 1, startChar: 0, endLine: 1, endChar: 1 },
      newText: 'X',
    });
    expect(mergeLineFixes([otherLine], 0, 'abc\ndef\n')).toBeNull();

    const outOfBounds = makeIssue('a', 'error', {
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 99 },
      newText: 'X',
    });
    expect(mergeLineFixes([outOfBounds], 0, 'abc\n')).toBeNull();
  });
});
