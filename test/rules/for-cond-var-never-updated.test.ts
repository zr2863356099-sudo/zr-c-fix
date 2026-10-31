import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('for-cond-var-never-updated', () => {
  it('flags a for loop whose counter is never updated', async () => {
    const issues = await runRule(
      [
        'int main() {',
        '  int i;',
        '  for (i = 0; i < 10; ) { }',
        '  return 0;',
        '}',
      ].join('\n'),
      'for-cond-var-never-updated',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'for-cond-var-never-updated',
      channel: 'hint',
      severity: 'warning',
      range: { startLine: 2, startChar: 14, endLine: 2, endChar: 15 },
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('flags a loop updated elsewhere but not in update/body', async () => {
    const issues = await runRule(
      [
        'int main() {',
        '  int i;',
        '  for (i = 0; i < 10; ) {',
        '    int x = i;',
        '  }',
        '  return 0;',
        '}',
      ].join('\n'),
      'for-cond-var-never-updated',
    );

    expect(issues).toHaveLength(1);
  });

  it('anchors on the initialized counter, not on bounds or callees', async () => {
    const issues = await runRule(
      'int main() { int n = 3; for (int i = 0; i < n; ) { } return 0; }\n',
      'for-cond-var-never-updated',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("'i'");

    await expect(
      runRule(
        'int main() { char *s = "x"; for (int i = 0; i < strlen(s); i++) { } return 0; }\n',
        'for-cond-var-never-updated',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts loops whose update mentions the condition variable', async () => {
    await expect(
      runRule(
        'int main() { for (int i = 0; i < 10; i++) { } return 0; }\n',
        'for-cond-var-never-updated',
      ),
    ).resolves.toEqual([]);

    await expect(
      runRule(
        'int main() { int i; for (i = 0; i < 10; ) { i += 2; } return 0; }\n',
        'for-cond-var-never-updated',
      ),
    ).resolves.toEqual([]);
  });

  it('stays silent when the body can break or return', async () => {
    await expect(
      runRule(
        'int main() { int i; for (i = 0; i < 10; ) { break; } return 0; }\n',
        'for-cond-var-never-updated',
      ),
    ).resolves.toEqual([]);

    await expect(
      runRule(
        'int f() { int i; for (i = 0; i < 10; ) { return i; } }\n',
        'for-cond-var-never-updated',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores loops without a condition', async () => {
    await expect(
      runRule('int main() { for (;;) { } return 0; }\n', 'for-cond-var-never-updated'),
    ).resolves.toEqual([]);
  });
});
