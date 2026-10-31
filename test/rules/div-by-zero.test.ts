import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('div-by-zero', () => {
  it('reports a zero literal divisor', async () => {
    const issues = await runRule(
      'int main(){ int x = 1; return x / 0; }\n',
      'div-by-zero',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'div-by-zero',
      channel: 'hint',
    });
  });

  it('reports a divisor of unknown value', async () => {
    const issues = await runRule(
      'int f(int b){ return 10 / b; }\n',
      'div-by-zero',
    );

    expect(issues).toHaveLength(1);
  });

  it('accepts an enclosing != 0 check', async () => {
    await expect(
      runRule(
        'int f(int b){ if (b != 0) return 10 / b; return 0; }\n',
        'div-by-zero',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts an early return for zero', async () => {
    await expect(
      runRule(
        'int f(int b){ if (b == 0) return 0; return 10 / b; }\n',
        'div-by-zero',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts a divisor initialized to a non-zero literal', async () => {
    await expect(
      runRule(
        'int f(int n){ int i; for (i = 2; i <= n / i; ++i) { } return i; }\n',
        'div-by-zero',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores floating-point divisors', async () => {
    await expect(
      runRule('int main(){ double a = 1.0, b = 2.0; return (int)(a / b); }\n', 'div-by-zero'),
    ).resolves.toEqual([]);
  });
});
