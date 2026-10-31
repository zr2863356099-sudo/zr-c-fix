import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('nested-loop-counter-clobber', () => {
  it('rewrites an inner update that clobbers the outer counter', async () => {
    const issues = await runRule(
      [
        'int main() {',
        '  for (int i = 0; i < 3; i++) {',
        '    for (int j = 0; j < 3; i++) {',
        '    }',
        '  }',
        '  return 0;',
        '}',
      ].join('\n'),
      'nested-loop-counter-clobber',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'nested-loop-counter-clobber',
      channel: 'ghost',
      severity: 'warning',
      range: { startLine: 2, startChar: 27, endLine: 2, endChar: 28 },
      fix: {
        range: { startLine: 2, startChar: 27, endLine: 2, endChar: 28 },
        newText: 'j',
      },
    });
  });

  it('reports a body write but leaves it unfixable', async () => {
    const issues = await runRule(
      [
        'int main() {',
        '  for (int i = 0; i < 3; i++) {',
        '    for (int j = 0; j < 3; j++) {',
        '      i = 5;',
        '    }',
        '  }',
        '  return 0;',
        '}',
      ].join('\n'),
      'nested-loop-counter-clobber',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('accepts a correct nested loop', async () => {
    await expect(
      runRule(
        [
          'int main() {',
          '  for (int i = 0; i < 3; i++) {',
          '    for (int j = 0; j < 3; j++) {',
          '    }',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
        'nested-loop-counter-clobber',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores an outer counter that is not declared in the for initializer', async () => {
    await expect(
      runRule(
        [
          'int main() {',
          '  int i;',
          '  for (i = 0; i < 3; i++) {',
          '    for (int j = 0; j < 3; i++) {',
          '    }',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
        'nested-loop-counter-clobber',
      ),
    ).resolves.toEqual([]);
  });

  it('does not treat array subscripts as counter writes', async () => {
    await expect(
      runRule(
        [
          'int main() {',
          '  int a[3][3];',
          '  for (int i = 0; i < 3; i++) {',
          '    for (int j = 0; j < 3; j++) {',
          '      a[i][j] = 0;',
          '    }',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
        'nested-loop-counter-clobber',
      ),
    ).resolves.toEqual([]);
  });
});
