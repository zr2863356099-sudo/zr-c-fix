import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('stray-literal', () => {
  it('deletes pasted numbers inside a function', async () => {
    const issues = await runRule(
      'int main() {\n  1 2 3\n  return 0;\n}\n',
      'stray-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'stray-literal',
      channel: 'ghost',
      severity: 'error',
      range: { startLine: 1, startChar: 2, endLine: 1, endChar: 7 },
      fix: {
        range: { startLine: 1, startChar: 2, endLine: 1, endChar: 7 },
        newText: '',
      },
    });
  });

  it('deletes pasted numbers at file scope when a statement is nearby', async () => {
    const issues = await runRule(
      'int a;\n1 2 3\nint b;\n',
      'stray-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.range.startLine).toBe(1);
  });

  it('does not flag numbers that are part of an expression', async () => {
    await expect(runRule('int main() { int x = 1 + 2; return 0; }\n', 'stray-literal')).resolves.toEqual(
      [],
    );
  });

  it('does not flag isolated numbers without ; or } nearby', async () => {
    await expect(runRule('1 2 3\n', 'stray-literal')).resolves.toEqual([]);
  });

  it('reports a multi-line paste as a hint without a cross-line fix', async () => {
    const issues = await runRule(
      'int main(){ printf("x"); }\n2\n2\n1\n',
      'stray-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'stray-literal',
      channel: 'hint',
      range: { startLine: 1, endLine: 3 },
    });
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('keeps a ghost fix for a single-line paste', async () => {
    const issues = await runRule('int main(){\n  2 2 1\n}\n', 'stray-literal');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      channel: 'ghost',
      fix: { newText: '' },
    });
  });
});
