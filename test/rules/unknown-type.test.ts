import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('unknown-type', () => {
  it('suggests unsigned for a missing leading character', async () => {
    const issues = await runRule('nsigned long long x;', 'unknown-type');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'unknown-type',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 7 },
    });
    expect(issues[0]?.fix).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 7 },
      newText: 'unsigned',
    });
  });

  it('suggests unsigned inside an error-containing declaration', async () => {
    for (const source of ['unsiged int x;', 'unsgned int x;']) {
      const issues = await runRule(source, 'unknown-type');

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        ruleId: 'unknown-type',
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 7 },
      });
      expect(issues[0]?.fix).toEqual({
        range: { startLine: 0, startChar: 0, endLine: 0, endChar: 7 },
        newText: 'unsigned',
      });
    }
  });

  it('ignores builtin types', async () => {
    await expect(runRule('int x;', 'unknown-type')).resolves.toEqual([]);
    await expect(runRule('unsigned int x;', 'unknown-type')).resolves.toEqual([]);
  });

  it('ignores names introduced by typedef', async () => {
    await expect(
      runRule('typedef int myint; myint y;', 'unknown-type'),
    ).resolves.toEqual([]);
  });

  it('ignores struct tags', async () => {
    await expect(
      runRule('struct S { int a; }; struct S s;', 'unknown-type'),
    ).resolves.toEqual([]);
  });

  it('stays silent when no builtin is close enough', async () => {
    await expect(runRule('foobar_t z;', 'unknown-type')).resolves.toEqual([]);
  });
});
