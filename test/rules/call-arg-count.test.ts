import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('call-arg-count', () => {
  it('reports gets with no arguments', async () => {
    const issues = await runRule(
      'int main(){ gets(); return 0; }\n',
      'call-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'call-arg-count',
      channel: 'hint',
      severity: 'error',
      message: "'gets' expects 1 argument, got 0",
      messageZh: "'gets' 需要 1 个参数，当前只有 0 个",
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('completes fgets on a char array', async () => {
    const issues = await runRule(
      'int main(){ char a[10]; fgets(a); return 0; }\n',
      'call-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      channel: 'ghost',
      message: "'fgets' expects 3 arguments, got 1",
      fix: {
        range: { startLine: 0, startChar: 31, endLine: 0, endChar: 31 },
        newText: ', sizeof a, stdin',
      },
    });
  });

  it('offers no fix when fgets gets something other than a char array', async () => {
    const issues = await runRule(
      'int main(){ char *p = 0; fgets(p); return 0; }\n',
      'call-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.channel).toBe('hint');
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('does not check the upper bound of variadic functions', async () => {
    await expect(
      runRule('int main(){ printf("%d", 1); return 0; }\n', 'call-arg-count'),
    ).resolves.toEqual([]);
  });

  it('reports strlen with no arguments', async () => {
    const issues = await runRule(
      'int main(){ strlen(); return 0; }\n',
      'call-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("'strlen' expects 1 argument, got 0");
  });

  it('reports too many arguments to a non-variadic function', async () => {
    const issues = await runRule(
      'int main(){ int r = strcmp("a", "b", 1); return 0; }\n',
      'call-arg-count',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("'strcmp' expects 2 arguments, got 3");
  });

  it('ignores calls to functions defined in the file', async () => {
    await expect(
      runRule(
        'int strlen(char *s, int n){ return n; }\nint main(){ strlen("a", 2); return 0; }\n',
        'call-arg-count',
      ),
    ).resolves.toEqual([]);
  });
});
