import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('assignment-in-condition', () => {
  it('rewrites = to == inside an if condition', async () => {
    const issues = await runRule(
      'int main() { int x = 0; if (x = 5) return 1; return 0; }\n',
      'assignment-in-condition',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'assignment-in-condition',
      channel: 'ghost',
      severity: 'warning',
      range: { startLine: 0, startChar: 28, endLine: 0, endChar: 33 },
      fix: {
        range: { startLine: 0, startChar: 30, endLine: 0, endChar: 31 },
        newText: '==',
      },
    });
  });

  it('also flags while conditions', async () => {
    const issues = await runRule(
      'int main() { int x = 0; while (x = 2) x--; return 0; }\n',
      'assignment-in-condition',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('==');
  });

  it('accepts == comparisons', async () => {
    await expect(
      runRule(
        'int main() { int x = 0; if (x == 5) return 1; return 0; }\n',
        'assignment-in-condition',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores nested assignments below the condition top level', async () => {
    await expect(
      runRule(
        'int main() { int x = 0; int y = 1; if ((x = 5) && y) return 1; return 0; }\n',
        'assignment-in-condition',
      ),
    ).resolves.toEqual([]);
  });

  it('does not try to repair compound assignments', async () => {
    await expect(
      runRule(
        'int main() { int x = 0; if (x += 5) return 1; return 0; }\n',
        'assignment-in-condition',
      ),
    ).resolves.toEqual([]);
  });
});
