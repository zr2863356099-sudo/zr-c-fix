import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('stack-large-local', () => {
  it('reports locals that push the frame past 1 MB and suggests static', async () => {
    const issues = await runRule(
      [
        'int main(){',
        '  long long a[100005];',
        '  long long b[100005];',
        '  long long c[100005];',
        '  long long d[100005];',
        '  return 0;',
        '}',
        '',
      ].join('\n'),
      'stack-large-local',
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatchObject({
      ruleId: 'stack-large-local',
      channel: 'ghost',
      fix: { newText: 'static ' },
    });
  });

  it('uses the 64 KB threshold for recursive functions', async () => {
    const issues = await runRule(
      'long long f(int n){ long long a[10000]; return f(n - 1) + a[0]; }\n',
      'stack-large-local',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('ghost');
  });

  it('accepts small locals', async () => {
    await expect(
      runRule('int main(){ int a[10]; double b = 0; return a[0]; }\n', 'stack-large-local'),
    ).resolves.toEqual([]);
  });

  it('does not count static locals', async () => {
    await expect(
      runRule(
        'int main(){ static long long a[200000]; return (int)a[0]; }\n',
        'stack-large-local',
      ),
    ).resolves.toEqual([]);
  });

  it('skips arrays whose size cannot be evaluated', async () => {
    await expect(
      runRule(
        'int main(){ int n = 5; int a[n]; return a[0]; }\n',
        'stack-large-local',
      ),
    ).resolves.toEqual([]);
  });
});
