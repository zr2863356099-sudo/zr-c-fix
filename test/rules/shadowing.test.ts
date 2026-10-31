import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('shadowing', () => {
  it('reports a local declared in a nested block', async () => {
    const issues = await runRule(
      'int main(){ int x = 0; { int x = 1; return x; } return 0; }\n',
      'shadowing',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'shadowing',
      channel: 'hint',
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('reports a loop variable that shadows an outer variable', async () => {
    const issues = await runRule(
      'int main(){ int i = 0; for (int i = 0; i < 3; i++) { } return i; }\n',
      'shadowing',
    );

    expect(issues).toHaveLength(1);
  });

  it('accepts distinct names', async () => {
    await expect(
      runRule('int main(){ int x = 0; { int y = 1; x = y; } return x; }\n', 'shadowing'),
    ).resolves.toEqual([]);
  });
});
