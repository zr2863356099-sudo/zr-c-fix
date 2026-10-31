import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('scanf-missing-amp', () => {
  it('inserts & for a scalar argument passed by value', async () => {
    const issues = await runRule(
      'int main(){ int x; scanf("%d", x); return 0; }\n',
      'scanf-missing-amp',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'scanf-missing-amp',
      channel: 'ghost',
      fix: { newText: '&' },
    });
  });

  it('accepts an address argument', async () => {
    await expect(
      runRule('int main(){ int x; scanf("%d", &x); return 0; }\n', 'scanf-missing-amp'),
    ).resolves.toEqual([]);
  });

  it('ignores pointer arguments', async () => {
    await expect(
      runRule('int main(){ int *p; scanf("%d", p); return 0; }\n', 'scanf-missing-amp'),
    ).resolves.toEqual([]);
  });
});
