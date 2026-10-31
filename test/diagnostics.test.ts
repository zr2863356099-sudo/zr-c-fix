import { describe, expect, it } from 'vitest';
import {
  diagnosticMessage,
  selectDiagnostics,
} from '../src/core/diagnostics';
import type { Issue } from '../src/core/rules/types';

function issue(ruleId: string, channel: Issue['channel']): Issue {
  const range = { startLine: 0, startChar: 0, endLine: 0, endChar: 1 };
  return {
    ruleId,
    channel,
    severity: 'warning',
    range,
    message: `en:${ruleId}`,
    messageZh: `zh:${ruleId}`,
  };
}

const hint = issue('shadowing', 'hint');
const syntaxRepair = issue('missing-semicolon', 'ghost');
const ghost = issue('format-type-mismatch', 'ghost');
const issues = [hint, syntaxRepair, ghost];

const NO_ERROR_LINES: ReadonlySet<number> = new Set();
const ERROR_ON_LINE_0: ReadonlySet<number> = new Set([0]);

describe('diagnosticMessage', () => {
  it('uses the Chinese message when locale is zh', () => {
    expect(diagnosticMessage(hint, 'zh')).toBe('zh:shadowing');
  });

  it('uses the English message when locale is en', () => {
    expect(diagnosticMessage(hint, 'en')).toBe('en:shadowing');
  });
});

describe('selectDiagnostics', () => {
  it('lists every issue when fixable issues are enabled and the file parses', () => {
    expect(
      selectDiagnostics({
        issues,
        hasError: false,
        errorLines: NO_ERROR_LINES,
        includeFixable: true,
      }),
    ).toEqual([hint, syntaxRepair, ghost]);
  });

  it('keeps syntax repairs but drops hints on error lines', () => {
    expect(
      selectDiagnostics({
        issues,
        hasError: true,
        errorLines: ERROR_ON_LINE_0,
        includeFixable: true,
      }),
    ).toEqual([syntaxRepair]);
  });

  it('keeps unknown-type repairs while dropping semantic fixable issues', () => {
    const unknownType = issue('unknown-type', 'ghost');
    expect(
      selectDiagnostics({
        issues: [unknownType, ghost],
        hasError: true,
        errorLines: ERROR_ON_LINE_0,
        includeFixable: true,
      }),
    ).toEqual([unknownType]);
  });

  it('keeps non-ASCII repairs while the file has syntax errors', () => {
    const nonAscii = issue('non-ascii-in-code', 'ghost');
    expect(
      selectDiagnostics({
        issues: [nonAscii],
        hasError: true,
        errorLines: ERROR_ON_LINE_0,
        includeFixable: true,
      }),
    ).toEqual([nonAscii]);
  });

  it('keeps semantic issues on lines without syntax errors', () => {
    const cleanGhost: Issue = {
      ...ghost,
      range: { startLine: 4, startChar: 0, endLine: 4, endChar: 1 },
    };
    expect(
      selectDiagnostics({
        issues: [cleanGhost],
        hasError: true,
        errorLines: ERROR_ON_LINE_0,
        includeFixable: true,
      }),
    ).toEqual([cleanGhost]);
  });

  it('lists hints only when fixable issues are disabled', () => {
    expect(
      selectDiagnostics({
        issues,
        hasError: false,
        errorLines: NO_ERROR_LINES,
        includeFixable: false,
      }),
    ).toEqual([hint]);
    expect(
      selectDiagnostics({
        issues,
        hasError: true,
        errorLines: ERROR_ON_LINE_0,
        includeFixable: false,
      }),
    ).toEqual([hint]);
  });
});
