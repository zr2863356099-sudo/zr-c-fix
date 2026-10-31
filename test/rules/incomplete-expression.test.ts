import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('incomplete-expression', () => {
  it('reports a missing right operand before a closing parenthesis', async () => {
    const issues = await runRule(
      'void f(){ int T=3; while (T-) {} }',
      'incomplete-expression',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'incomplete-expression',
      channel: 'hint',
      severity: 'error',
    });
    expect(issues[0]?.message).toBe(
      "Incomplete expression: missing right operand after '-'",
    );
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('reports an operator before a semicolon', async () => {
    const issues = await runRule(
      'void f(){ int a=1,b=2; int c = a + ; }',
      'incomplete-expression',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe(
      "Incomplete expression: missing right operand after '+'",
    );
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('does not report a complete decrement', async () => {
    await expect(
      runRule('void f(){ int T=3; while (T--) {} }', 'incomplete-expression'),
    ).resolves.toEqual([]);
  });
});
