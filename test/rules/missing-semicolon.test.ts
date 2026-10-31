import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('missing-semicolon', () => {
  it('inserts ; after a declaration missing one', async () => {
    const issues = await runRule(
      'int main() {\n  int x = 1\n  return 0;\n}\n',
      'missing-semicolon',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'missing-semicolon',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 1, startChar: 11, endLine: 1, endChar: 11 },
      fix: {
        range: { startLine: 1, startChar: 11, endLine: 1, endChar: 11 },
        newText: ';',
      },
    });
  });

  it('inserts ; after a call expression', async () => {
    const issues = await runRule(
      'int main() {\n  printf("x")\n  return 0;\n}\n',
      'missing-semicolon',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.range).toEqual({
      startLine: 1,
      startChar: 13,
      endLine: 1,
      endChar: 13,
    });
  });

  it('accepts statements that already end in ;', async () => {
    await expect(
      runRule(
        'int main() {\n  int x = 1;\n  return 0;\n}\n',
        'missing-semicolon',
      ),
    ).resolves.toEqual([]);
  });

  it('does not insert after a closing brace', async () => {
    await expect(
      runRule(
        'struct S { int x; };\nint main() { return 0; }\n',
        'missing-semicolon',
      ),
    ).resolves.toEqual([]);
  });

  it('finds a missing ; that merged the next line into the statement', async () => {
    const issues = await runRule("b[i]='\\0'\nrev(b);\n", 'missing-semicolon');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'missing-semicolon',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 0, startChar: 9, endLine: 0, endChar: 9 },
      fix: {
        range: { startLine: 0, startChar: 9, endLine: 0, endChar: 9 },
        newText: ';',
      },
    });
  });

  it('skips control lines whose body starts on the next line', async () => {
    const issues = await runRule(
      'int main() {\n  int x = 0;\n  int y = 1\n  if (x)\n  {\n    x = y;\n  }\n  return 0;\n}\n',
      'missing-semicolon',
    );

    expect(issues.map((issue) => issue.range.startLine)).toEqual([2]);
  });

  it('ignores trailing comments when finding the insertion point', async () => {
    const issues = await runRule(
      "int main() {\n  b[i]='\\0' // terminate\n  rev(b);\n  return 0;\n}\n",
      'missing-semicolon',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.range).toEqual({
      startLine: 1,
      startChar: 11,
      endLine: 1,
      endChar: 11,
    });
  });
});
