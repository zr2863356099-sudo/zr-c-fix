import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('non-ascii-in-code', () => {
  it('fixes a full-width comma', async () => {
    const issues = await runRule('int a，b;', 'non-ascii-in-code');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'non-ascii-in-code',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 0, startChar: 5, endLine: 0, endChar: 6 },
    });
    expect(issues[0]?.fix).toEqual({
      range: { startLine: 0, startChar: 5, endLine: 0, endChar: 6 },
      newText: ',',
    });
  });

  it('merges consecutive fixable characters into one issue', async () => {
    const issues = await runRule('ｉｎｔ a;', 'non-ascii-in-code');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 3 },
      newText: 'int',
    });
  });

  it('maps a full-width space to a normal space', async () => {
    const issues = await runRule('int a　b;', 'non-ascii-in-code');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix).toEqual({
      range: { startLine: 0, startChar: 5, endLine: 0, endChar: 6 },
      newText: ' ',
    });
  });

  it('fixes curly double quotes one by one', async () => {
    const issues = await runRule('char *s = “hi”;', 'non-ascii-in-code');

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.fix?.newText)).toEqual(['"', '"']);
    expect(issues.map((issue) => issue.range.startChar)).toEqual([10, 13]);
  });

  it('ignores non-ASCII inside strings', async () => {
    await expect(runRule('printf("，");', 'non-ascii-in-code')).resolves.toEqual(
      [],
    );
  });

  it('ignores non-ASCII inside comments', async () => {
    await expect(
      runRule('// 中文，注释', 'non-ascii-in-code'),
    ).resolves.toEqual([]);
  });

  it('reports an unmappable character as a hint without a fix', async () => {
    const issues = await runRule('int a; 。', 'non-ascii-in-code');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'non-ascii-in-code',
      channel: 'hint',
      severity: 'error',
      range: { startLine: 0, startChar: 7, endLine: 0, endChar: 8 },
    });
    expect(issues[0]?.message).toBe("Non-ASCII character '。' in code");
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('ignores plain ASCII code', async () => {
    await expect(runRule('int a;', 'non-ascii-in-code')).resolves.toEqual([]);
  });
});
