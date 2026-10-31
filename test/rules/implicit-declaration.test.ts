import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('implicit-declaration', () => {
  it('suggests the closest signature name', async () => {
    const issues = await runRule(
      "int main(){ puchar('\\n'); return 0; }\n",
      'implicit-declaration',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'implicit-declaration',
      channel: 'ghost',
      fix: { newText: 'putchar' },
    });
  });

  it('accepts a known library function', async () => {
    await expect(
      runRule("int main(){ putchar('a'); return 0; }\n", 'implicit-declaration'),
    ).resolves.toEqual([]);
  });

  it('accepts a function defined in the file', async () => {
    await expect(
      runRule(
        'int twice(int x){ return x * 2; }\nint main(){ return twice(1); }\n',
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts a function pointer called by name', async () => {
    await expect(
      runRule(
        'int (*fp)(int);\nint main(){ return fp(1); }\n',
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });

  it('accepts a function-like macro', async () => {
    await expect(
      runRule(
        '#define sq(x) ((x) * (x))\nint main(){ return sq(2); }\n',
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });

  it('stays silent when no signature is close enough', async () => {
    await expect(
      runRule('void f(){ foo(); }\n', 'implicit-declaration'),
    ).resolves.toEqual([]);
  });

  it('stays silent for functions from ctype.h', async () => {
    await expect(
      runRule(
        "#include <ctype.h>\nvoid f(){ isdigit('5'); }\n",
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });

  it('stays silent for functions from math.h', async () => {
    await expect(
      runRule(
        '#include <math.h>\nvoid f(){ sqrt(2.0); }\n',
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });

  it('stays silent for functions from stdlib.h', async () => {
    await expect(
      runRule(
        '#include <stdlib.h>\nvoid f(){ malloc(10); }\n',
        'implicit-declaration',
      ),
    ).resolves.toEqual([]);
  });
});
