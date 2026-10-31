import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('int-literal-overflow', () => {
  it('flags a decimal literal above INT_MAX', async () => {
    const issues = await runRule(
      'int main() { int x = 2147483648; return 0; }\n',
      'int-literal-overflow',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'int-literal-overflow',
      channel: 'hint',
      severity: 'warning',
      range: { startLine: 0, startChar: 21, endLine: 0, endChar: 31 },
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('flags -2147483648 through its literal', async () => {
    const issues = await runRule(
      'int main() { int x = -2147483648; return 0; }\n',
      'int-literal-overflow',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.range).toEqual({
      startLine: 0,
      startChar: 21,
      endLine: 0,
      endChar: 32,
    });
  });

  it('flags large hex and octal literals', async () => {
    const issues = await runRule(
      'int a = 0xFFFFFFFF; int b = 020000000000;\n',
      'int-literal-overflow',
    );

    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it('accepts INT_MAX and float literals', async () => {
    await expect(
      runRule('int main() { int x = 2147483647; return 0; }\n', 'int-literal-overflow'),
    ).resolves.toEqual([]);

    await expect(
      runRule('double x = 1e10; float y = 3.5e9;\n', 'int-literal-overflow'),
    ).resolves.toEqual([]);
  });

  it('respects explicit wide suffixes', async () => {
    await expect(
      runRule('long long x = 2147483648LL; unsigned y = 2147483648U;\n', 'int-literal-overflow'),
    ).resolves.toEqual([]);
  });
});
