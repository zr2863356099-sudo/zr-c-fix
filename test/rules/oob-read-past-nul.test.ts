import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('oob-read-past-nul', () => {
  it('reports reading s[i+1] after s[i] is the terminator', async () => {
    const issues = await runRule(
      'int main(){ char s[10]; int i = 0; if (s[i] == \'\\0\' && s[i + 1] == \'x\') return 1; return 0; }\n',
      'oob-read-past-nul',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'oob-read-past-nul',
      channel: 'hint',
    });
  });

  it('handles the reversed terminator comparison', async () => {
    const issues = await runRule(
      'int main(){ char s[10]; int i = 0; if (\'\\0\' == s[i] && s[i+1] == \'x\') return 1; return 0; }\n',
      'oob-read-past-nul',
    );

    expect(issues).toHaveLength(1);
  });

  it('ignores reads at the same index', async () => {
    await expect(
      runRule(
        'int main(){ char s[10]; int i = 0; if (s[i] == \'\\0\' && s[i] == \'x\') return 1; return 0; }\n',
        'oob-read-past-nul',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores non-NUL checks', async () => {
    await expect(
      runRule(
        'int main(){ char s[10]; int i = 0; if (s[i] != \'\\0\' && s[i+1] == \'x\') return 1; return 0; }\n',
        'oob-read-past-nul',
      ),
    ).resolves.toEqual([]);
  });

  it('requires a char array', async () => {
    await expect(
      runRule(
        'int main(){ int s[10]; int i = 0; if (s[i] == 0 && s[i+1] == 1) return 1; return 0; }\n',
        'oob-read-past-nul',
      ),
    ).resolves.toEqual([]);
  });
});
