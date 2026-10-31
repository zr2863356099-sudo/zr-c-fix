import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('stack-vla', () => {
  it('reports a variable-length array', async () => {
    const issues = await runRule(
      'int main(){ int n = 5; int a[n]; return a[0]; }\n',
      'stack-vla',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'stack-vla',
      channel: 'hint',
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('reports a VLA dimension using a function parameter', async () => {
    const issues = await runRule(
      'int f(int n){ int a[n + 1]; return a[0]; }\n',
      'stack-vla',
    );

    expect(issues).toHaveLength(1);
  });

  it('accepts constant-sized arrays', async () => {
    await expect(
      runRule(
        '#define N 10\nint main(){ int a[N]; int b[10]; return a[0] + b[0]; }\n',
        'stack-vla',
      ),
    ).resolves.toEqual([]);
  });
});
