import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('format-arg-count', () => {
  it('removes a conversion whose argument is missing', async () => {
    const issues = await runRule(
      'int main(){ int x = 1; printf("%d %d", x); return 0; }\n',
      'format-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('');
  });

  it('completes the format string for one surplus char argument', async () => {
    const issues = await runRule(
      'int main(){ char c = 65; printf("%d", 1, c); return 0; }\n',
      'format-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('ghost');
    expect(issues[0]?.fix?.newText).toBe('%c');
    expect(issues[0]?.message).toBe(
      'Argument has no matching format specifier; use "%d%c" or drop the argument',
    );
  });

  it('completes the format string for one surplus int argument', async () => {
    const issues = await runRule(
      'int main(){ int a = 1, b = 2; printf("%d", a, b); return 0; }\n',
      'format-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%d');
  });

  it('reports two surplus arguments without a fix', async () => {
    const issues = await runRule(
      'int main(){ printf("%d", 1, 2, 3); return 0; }\n',
      'format-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('hint');
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('accepts a matching count', async () => {
    await expect(
      runRule('int main(){ int x = 1; printf("%d", x); return 0; }\n', 'format-arg-count'),
    ).resolves.toEqual([]);
  });
});
