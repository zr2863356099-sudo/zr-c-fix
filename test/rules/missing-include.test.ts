import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('missing-include', () => {
  it('reports the first use of a library function without its header', async () => {
    const issues = await runRule(
      'int main(){ printf("x"); return 0; }\n',
      'missing-include',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'missing-include',
      channel: 'hint',
    });
    expect(issues[0]?.message).toContain('stdio.h');
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('accepts an included header', async () => {
    await expect(
      runRule(
        '#include <stdio.h>\nint main(){ printf("x"); return 0; }\n',
        'missing-include',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores functions prototyped in the file', async () => {
    await expect(
      runRule(
        'int strlen(char *s);\nint main(){ return (int)strlen("a"); }\n',
        'missing-include',
      ),
    ).resolves.toEqual([]);
  });

  it('reports one issue per missing header', async () => {
    const issues = await runRule(
      'int main(){ printf("%d", (int)strlen("a")); return 0; }\n',
      'missing-include',
    );

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message).join(' ')).toContain('string.h');
  });
});
