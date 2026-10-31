import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('invalid-format-specifier', () => {
  it('completes scanf %l from an unsigned long long target', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x; scanf("%l", &x); return 0; }\n',
      'invalid-format-specifier',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('ghost');
    expect(issues[0]?.fix?.newText).toBe('%llu');
    expect(issues[0]?.message).toBe(
      "Incomplete format specifier '%l'; did you mean '%llu'?",
    );
  });

  it('completes scanf %l from a long target', async () => {
    const issues = await runRule(
      'int main(){ long x; scanf("%l", &x); return 0; }\n',
      'invalid-format-specifier',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%ld');
  });

  it('reports an incomplete specifier without an argument as a hint', async () => {
    const issues = await runRule(
      'int main(){ printf("%l"); return 0; }\n',
      'invalid-format-specifier',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('hint');
    expect(issues[0]?.fix).toBeUndefined();
    expect(issues[0]?.message).toBe("Incomplete format specifier '%l'");
  });

  it('reports an illegal conversion character', async () => {
    const issues = await runRule(
      'int main(){ int a = 1; printf("%q", a); return 0; }\n',
      'invalid-format-specifier',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%d');
    expect(issues[0]?.message).toBe(
      "Invalid format specifier '%q'; did you mean '%d'?",
    );
  });

  it('accepts a valid specifier', async () => {
    await expect(
      runRule('int main(){ int a = 1; printf("%d", a); return 0; }\n', 'invalid-format-specifier'),
    ).resolves.toEqual([]);
  });

  it('accepts an escaped percent', async () => {
    await expect(
      runRule('int main(){ printf("%%"); return 0; }\n', 'invalid-format-specifier'),
    ).resolves.toEqual([]);
  });
});
