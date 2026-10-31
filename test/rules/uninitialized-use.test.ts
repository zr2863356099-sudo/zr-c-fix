import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('uninitialized-use', () => {
  it('reports a use after a branch without else assigns the variable', async () => {
    const issues = await runRule(
      'int main(){ int c = 1; int x; if (c) x = 2; printf("%d", x); return 0; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'uninitialized-use',
      channel: 'hint',
    });
    expect(issues[0]?.fix?.newText).toBe(' = 0');
  });

  it('suggests = 0 when the variable is accumulated', async () => {
    const issues = await runRule(
      'void f(int a){ int s; s = s + a; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe(' = 0');
  });

  it('suggests = 1 when the variable is multiplied', async () => {
    const issues = await runRule(
      'void f(int a){ int p; p = p * a; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe(' = 1');
  });

  it('does not suggest a value when the variable is compared', async () => {
    const issues = await runRule(
      'void f(int* a){ int m; for(int i=0;i<3;i++) if (a[i] > m) m = a[i]; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('suggests = NULL for a pointer', async () => {
    const issues = await runRule(
      'void f(){ int *q; *q = 1; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe(' = NULL');
  });

  it('reports a variable used in its own initializer', async () => {
    const issues = await runRule(
      'void f(){ int x = x + 1; }\n',
      'uninitialized-use',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('own initializer');
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('accepts a declaration with an initializer', async () => {
    await expect(
      runRule('int main(){ int x = 0; return x; }\n', 'uninitialized-use'),
    ).resolves.toEqual([]);
  });

  it('accepts a variable assigned on both branches', async () => {
    await expect(
      runRule(
        'int main(){ int c = 1; int x; if (c) x = 1; else x = 2; return x; }\n',
        'uninitialized-use',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts a variable defined through scanf', async () => {
    await expect(
      runRule(
        'int main(){ int x; scanf("%d", &x); return x; }\n',
        'uninitialized-use',
      ),
    ).resolves.toEqual([]);
  });
});
