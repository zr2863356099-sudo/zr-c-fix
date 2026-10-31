import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('scanf-string-width', () => {
  it('uses the actual buffer size for the width', async () => {
    const issues = await runRule(
      'int main(){ char s[10]; scanf("%s", s); return 0; }\n',
      'scanf-string-width',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%9s');
    expect(issues[0]?.message).toContain('10-byte buffer');
    expect(issues[0]?.message).toContain("'%9s'");
  });

  it('uses size - 1 for a 100-byte buffer', async () => {
    const issues = await runRule(
      'int main(){ char s[100]; scanf("%s", s); return 0; }\n',
      'scanf-string-width',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%99s');
  });

  it('skips buffers above 256 bytes', async () => {
    await expect(
      runRule('int main(){ char s[257]; scanf("%s", s); return 0; }\n', 'scanf-string-width'),
    ).resolves.toEqual([]);
  });

  it('skips buffers smaller than 2 bytes', async () => {
    await expect(
      runRule('int main(){ char s[1]; scanf("%s", s); return 0; }\n', 'scanf-string-width'),
    ).resolves.toEqual([]);
  });

  it('accepts an explicit width', async () => {
    await expect(
      runRule('int main(){ char s[10]; scanf("%9s", s); return 0; }\n', 'scanf-string-width'),
    ).resolves.toEqual([]);
  });
});
