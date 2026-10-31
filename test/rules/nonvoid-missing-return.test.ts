import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('nonvoid-missing-return', () => {
  it('reports a fall-through path in a non-void function', async () => {
    const issues = await runRule(
      'int gcd(int a, int b){ if (b == 0) return a; else gcd(b, a % b); }\n',
      'nonvoid-missing-return',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'nonvoid-missing-return',
      channel: 'hint',
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('reports a bare return in a non-void function', async () => {
    const issues = await runRule(
      'int f(int x){ if (x) return; return 1; }\n',
      'nonvoid-missing-return',
    );

    expect(issues).toHaveLength(1);
  });

  it('accepts a function that returns on every path', async () => {
    await expect(
      runRule('int f(int x){ if (x) return 1; else return 2; }\n', 'nonvoid-missing-return'),
    ).resolves.toEqual([]);
  });

  it('ignores main and void functions', async () => {
    await expect(
      runRule('int main(){ }\nvoid f(){ }\n', 'nonvoid-missing-return'),
    ).resolves.toEqual([]);
  });
});
