import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('empty-statement-body', () => {
  it('deletes the semicolon after a while condition', async () => {
    const issues = await runRule(
      'int main() { int i = 0; while (i < 3); return 0; }\n',
      'empty-statement-body',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'empty-statement-body',
      channel: 'ghost',
      severity: 'warning',
      range: { startLine: 0, startChar: 37, endLine: 0, endChar: 38 },
      fix: {
        range: { startLine: 0, startChar: 37, endLine: 0, endChar: 38 },
        newText: '',
      },
    });
  });

  it('flags empty if and for bodies', async () => {
    const ifIssues = await runRule(
      'int main() { int x = 1; if (x); return 0; }\n',
      'empty-statement-body',
    );
    expect(ifIssues).toHaveLength(1);
    expect(ifIssues[0]?.fix?.newText).toBe('');

    const forIssues = await runRule(
      'int main() { for (int i = 0; i < 3; i++); return 0; }\n',
      'empty-statement-body',
    );
    expect(forIssues).toHaveLength(1);
  });

  it('accepts a braced body', async () => {
    await expect(
      runRule(
        'int main() { int i = 0; while (i < 3) { i++; } return 0; }\n',
        'empty-statement-body',
      ),
    ).resolves.toEqual([]);
  });

  it('skips while conditions with assignment or a call', async () => {
    await expect(
      runRule(
        'int main() { int c; while ((c = getchar()) != EOF); return 0; }\n',
        'empty-statement-body',
      ),
    ).resolves.toEqual([]);
  });
});
