import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('undeclared-variable', () => {
  it('suggests the closest declared variable', async () => {
    const issues = await runRule(
      'int count; void f(){ cnt = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'undeclared-variable',
      channel: 'ghost',
      fix: { newText: 'count' },
    });
    expect(issues[0]?.message).toBe(
      "'cnt' is not declared; did you mean 'count'?",
    );
  });

  it('reports a hint when no candidate is close enough', async () => {
    const issues = await runRule(
      'int x; void f(){ var = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'undeclared-variable',
      channel: 'hint',
      severity: 'error',
    });
    expect(issues[0]?.message).toBe("Unknown identifier 'var'");
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('reports a single-character identifier once per line without a fix', async () => {
    const issues = await runRule(
      'void f(){ x = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ channel: 'hint' });
    expect(issues[0]?.message).toBe("Unknown identifier 'x'");
    expect(issues[0]?.fix).toBeUndefined();
  });

  it('inserts int before an undeclared for-loop initializer', async () => {
    const issues = await runRule(
      'void f(){ for ( i=0; i<3; i++){} }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      channel: 'ghost',
      fix: {
        newText: 'int ',
        range: { startLine: 0, startChar: 16, endLine: 0, endChar: 16 },
      },
    });
  });

  it('inserts one int for a comma-initialized for loop', async () => {
    const issues = await runRule(
      'void f(){ for ( i=0, j=0; i<3; i++){} }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(2);
    const i = issues.find((issue) => issue.message.includes("'i'"));
    const j = issues.find((issue) => issue.message.includes("'j'"));
    expect(i?.fix?.newText).toBe('int ');
    expect(j?.fix).toBeUndefined();
  });

  it('inserts int before a single for-loop initializer', async () => {
    const issues = await runRule(
      'void f(){ for ( i=0; i<3; i++){} }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('int ');
  });

  it('does not fix a malformed for-loop initializer', async () => {
    // tree-sitter parses `in i = 0` as a declaration, so there is no clean assignment.
    const issues = await runRule(
      'void f(){ for ( in i = 0; i<3; i++){} }',
      'undeclared-variable',
    );

    expect(issues.some((issue) => issue.fix !== undefined)).toBe(false);
  });

  it('accepts a macro name', async () => {
    await expect(
      runRule(
        '#define N 10\nint main(){ int a[N]; return a[0]; }',
        'undeclared-variable',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts struct field access', async () => {
    await expect(
      runRule(
        'struct S { int v; }; void f(struct S s){ s.v = 1; }',
        'undeclared-variable',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts a library function name', async () => {
    await expect(
      runRule('void f(){ printf("hi"); }', 'undeclared-variable'),
    ).resolves.toEqual([]);
  });

  it('skips ALL_CAPS identifiers', async () => {
    await expect(
      runRule('void f(){ MAX = 1; }', 'undeclared-variable'),
    ).resolves.toEqual([]);
  });

  it('skips predefined library identifiers', async () => {
    await expect(
      runRule('void f(){ int x = 0; if (x > EOF) {} }', 'undeclared-variable'),
    ).resolves.toEqual([]);

    // Without the declaration, only `x` is reported; EOF must stay silent.
    const issues = await runRule(
      'void f(){ if (x > EOF) {} }',
      'undeclared-variable',
    );
    expect(issues.every((issue) => !issue.message.includes("'EOF'"))).toBe(true);
  });

  it('reports identifiers on a clean line when another line has a parse error', async () => {
    const issues = await runRule(
      'void f(){\nfor ( i=0; i < 3; i++){}\n',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ channel: 'ghost' });
    expect(issues[0]?.message).toBe("Unknown identifier 'i'");
    expect(issues[0]?.fix?.newText).toBe('int ');
  });

  it('reports one issue for repeated occurrences on the same line', async () => {
    const issues = await runRule(
      'void f(){ baz = baz + baz + baz + baz; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("Unknown identifier 'baz'");
  });

  it('stays silent for a no-candidate identifier when a header is unknown', async () => {
    await expect(
      runRule(
        '#include <ctype.h>\nvoid f(){ x = 1; }',
        'undeclared-variable',
      ),
    ).resolves.toEqual([]);
  });

  it('gives a no-candidate hint when the file has no includes', async () => {
    const issues = await runRule(
      'void f(){ q = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ channel: 'hint' });
    expect(issues[0]?.message).toBe("Unknown identifier 'q'");
  });

  it('gives a no-candidate hint when all includes are known', async () => {
    const issues = await runRule(
      '#include <stdio.h>\nvoid f(){ q = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ channel: 'hint' });
    expect(issues[0]?.message).toBe("Unknown identifier 'q'");
  });

  it('fixes a transposed name', async () => {
    const issues = await runRule(
      'int total; void f(){ totl = 1; }',
      'undeclared-variable',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('total');
  });
});
