import { describe, expect, it } from 'vitest';
import { findUnclosedOpens } from '../../src/core/rules/unbalanced-braces';
import { createTestParser } from '../helpers/parser';
import { runRule } from './helpers';

async function countUnclosed(source: string): Promise<number> {
  const parser = await createTestParser();
  const tree = parser.parse(source);
  try {
    return findUnclosedOpens(tree.rootNode).length;
  } finally {
    tree.delete();
    parser.dispose();
  }
}

describe('unbalanced-braces', () => {
  it('reports an unclosed function body on the opening brace', async () => {
    const issues = await runRule(
      'int main() {\n  return 0;\n',
      'unbalanced-braces',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'unbalanced-braces',
      channel: 'hint',
      severity: 'error',
      range: { startLine: 0, startChar: 11, endLine: 0, endChar: 12 },
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('ignores braces inside strings and comments', async () => {
    const balanced = await runRule(
      'int main() { char *s = "{"; /* } */ return 0; }\n',
      'unbalanced-braces',
    );
    expect(balanced).toEqual([]);

    const unclosed = await runRule(
      'int main() {\n  // }\n  return 0;\n',
      'unbalanced-braces',
    );
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0]?.range.startLine).toBe(0);
  });

  it('stays silent while a just-opened block has no body yet', async () => {
    await expect(runRule('int main() {\n', 'unbalanced-braces')).resolves.toEqual(
      [],
    );
  });

  it('counts only genuinely unclosed opens in nested blocks', async () => {
    // A balanced 2-D initializer contributes nothing; main's brace is the only open.
    await expect(
      countUnclosed('int main() {\n  int a[2][2] = {{1, 2}, {3, 4}};\n'),
    ).resolves.toBe(1);

    await expect(
      countUnclosed('int main() {\n  if (x) {\n    return 0;\n'),
    ).resolves.toBe(2);
  });
});
