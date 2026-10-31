import { afterAll, describe, expect, it } from 'vitest';
import { DocumentAnalysis } from '../src/core/analysis';
import { buildInlineCorrection } from '../src/core/correction';
import type { CParser } from '../src/core/parser';
import { DEFAULT_RULE_CONFIG } from '../src/core/rules/types';
import { hashLine, SuppressionTable } from '../src/core/suppression';
import { createTestParser } from './helpers/parser';

const TARGET_LINES = 2000;
const BUDGET_MS = 30;
const CURRENT_LINE = 5;

let parser: CParser | undefined;

async function getParser(): Promise<CParser> {
  parser ??= await createTestParser();
  return parser;
}

function buildLargeSource(targetLines: number): string {
  const lines = ['#include <stdio.h>', '#include <string.h>', ''];
  // 3 header lines + 10 lines per function + (functionCount + 5) lines in main.
  const functionCount = Math.max(0, Math.floor((targetLines - 8) / 11));

  for (let index = 0; index < functionCount; index++) {
    lines.push(
      `int sum_${index}(int n) {`,
      '  int i;',
      index === 0
        ? '  int sum = 0; scanf("%d", sum);'
        : '  int sum = 0;',
      '  int values[16];',
      '  for (i = 0; i < 16; i++) {',
      '    values[i] = i + n;',
      '  }',
      '  printf("%d\\n", values[0]);',
      '  return sum + n;',
      '}',
    );
  }

  lines.push('int main(void) {', '  int total = 0;');
  for (let index = 0; index < functionCount; index++) {
    lines.push(`  total += sum_${index}(${index});`);
  }
  lines.push('  printf("%d\\n", total);', '  return 0;', '}');

  while (lines.length < targetLines) {
    lines.push('/* padding */');
  }

  return lines.join('\n');
}

describe('2000-line correction cycle', () => {
  afterAll(() => {
    parser?.dispose();
    parser = undefined;
  });

  it('reuses the version cache within the 30ms budget', async () => {
    const active = await getParser();
    const source = buildLargeSource(TARGET_LINES);
    const lines = source.split('\n');
    expect(lines).toHaveLength(TARGET_LINES);

    const analysis = new DocumentAnalysis(
      active,
      source,
      1,
      DEFAULT_RULE_CONFIG,
    );

    // First pass pays for parse, symbols and rules; the 300ms cycle below must reuse it.
    analysis.getLineIssues(CURRENT_LINE);

    const lineText = lines[CURRENT_LINE] ?? '';
    const suppression = new SuppressionTable();
    const started = performance.now();
    const issues = analysis.getLineIssues(CURRENT_LINE);
    const fingerprint = analysis.getTypeFingerprint();
    const key = {
      lineHash: hashLine(lineText),
      ruleId: issues[0]?.ruleId ?? 'benchmark',
      typeFingerprint: fingerprint,
    };
    suppression.consume(key);
    expect(suppression.isSuppressed(key)).toBe(true);
    const correction = buildInlineCorrection(
      issues,
      CURRENT_LINE,
      source,
      'whole-line',
    );
    const elapsed = performance.now() - started;
    analysis.dispose();

    expect(fingerprint.length).toBeGreaterThan(0);
    expect(key.lineHash.length).toBeGreaterThan(0);
    expect(correction?.newText).toContain('&sum');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
