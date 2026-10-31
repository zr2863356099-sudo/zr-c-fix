import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('missing-include-hash', () => {
  it('inserts # before a top-level include', async () => {
    const issues = await runRule(
      'include <stdio.h>\nint main() { return 0; }\n',
      'missing-include-hash',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'missing-include-hash',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 7 },
      fix: {
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
        newText: '#',
      },
    });
  });

  it('handles indentation and string.h', async () => {
    const issues = await runRule('  include <string.h>\n', 'missing-include-hash');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.range.startChar).toBe(2);
    expect(issues[0]?.fix?.range.startChar).toBe(2);
  });

  it('accepts a real #include', async () => {
    await expect(
      runRule('#include <stdio.h>\nint main() { return 0; }\n', 'missing-include-hash'),
    ).resolves.toEqual([]);
  });

  it('ignores include-looking lines inside a function', async () => {
    await expect(
      runRule(
        'int main() {\n  include <stdio.h>\n  return 0;\n}\n',
        'missing-include-hash',
      ),
    ).resolves.toEqual([]);
  });
});
