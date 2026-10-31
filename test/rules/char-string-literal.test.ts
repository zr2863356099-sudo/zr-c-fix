import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CParser } from '../../src/core/parser';
import { strcmpComparisonFixes } from '../../src/core/rules/char-string-literal';
import { buildSymbolTable } from '../../src/core/symbols';
import { createTestParser } from '../helpers/parser';
import { runRule } from './helpers';

let parser: CParser | undefined;

beforeAll(async () => {
  parser = await createTestParser();
});

afterAll(() => {
  parser?.dispose();
  parser = undefined;
});

function strcmpFixes(source: string) {
  if (!parser) {
    throw new Error('parser not initialised');
  }
  const tree = parser.parse(source);
  try {
    return strcmpComparisonFixes({
      text: source,
      root: tree.rootNode,
      table: buildSymbolTable(tree.rootNode, source),
    });
  } finally {
    tree.delete();
  }
}

describe('char-string-literal', () => {
  it('rewrites a string literal assigned to a char array element', async () => {
    const issues = await runRule(
      'int main(){ char b[2]; b[0] = "\\0"; return 0; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'char-string-literal',
      channel: 'ghost',
      fix: { newText: "'\\0'" },
    });
  });

  it('rewrites a single-character string initializer', async () => {
    const issues = await runRule(
      'int main(){ char c = "a"; return c; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe("'a'");
  });

  it('accepts a character literal', async () => {
    await expect(
      runRule("int main(){ char c = 'a'; return c; }\n", 'char-string-literal'),
    ).resolves.toEqual([]);
  });

  it('accepts string initialization of a char pointer or array', async () => {
    await expect(
      runRule(
        'char *p = "a"; char s[2] = "a"; int main(){ return 0; }\n',
        'char-string-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores multi-character strings', async () => {
    await expect(
      runRule('int main(){ char c; c = "ab"; return 0; }\n', 'char-string-literal'),
    ).resolves.toEqual([]);
  });
});

describe('char-string-literal comparisons', () => {
  it('rewrites a one-character literal compared with a char element', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s[0] == "P") { } return 0; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'char-string-literal',
      channel: 'ghost',
      fix: { newText: "'P'" },
    });
  });

  it('handles the literal on the left', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if ("P" == s[0]) { } return 0; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe("'P'");
  });

  it('covers relational operators', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s[0] != "x") { } return 0; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe("'x'");
  });

  it('reports a multi-character literal without a fix', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s[0] == "NP") { } return 0; }\n',
      'char-string-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix).toBeUndefined();
    expect(issues[0]?.channel).toBe('hint');
    expect(issues[0]?.messageZh).toBe('字符与字符串指针比较（类型不匹配）');
  });

  it('accepts a character compared with a character literal', async () => {
    await expect(
      runRule(
        "int main(void) { char c; if (c == 'P') { } return 0; }\n",
        'char-string-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('leaves char arrays to string-eq-literal', async () => {
    await expect(
      runRule(
        'int main(void) { char s[5]; if (s == "P") { } return 0; }\n',
        'char-string-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores non-char values compared with a string literal', async () => {
    await expect(
      runRule(
        'int main(void) { int a = 0; if (a == "P") { } return 0; }\n',
        'char-string-literal',
      ),
    ).resolves.toEqual([]);
  });
});

describe('char-string-literal strcmp alternative', () => {
  it('rewrites a whole-string comparison for an array element', () => {
    const fixes = strcmpFixes(
      'int main(void) { char s[5]; if (s[0] == "NP") { } return 0; }\n',
    );

    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.newText).toBe('strcmp(s, "NP") == 0');
  });

  it('keeps the operand order when the literal is on the left', () => {
    const fixes = strcmpFixes(
      'int main(void) { char s[5]; if ("NP" == s[0]) { } return 0; }\n',
    );

    expect(fixes[0]?.newText).toBe('strcmp(s, "NP") == 0');
  });

  it('flips relational operators for a literal on the left', () => {
    const fixes = strcmpFixes(
      'int main(void) { char s[5]; if ("NP" < s[0]) { } return 0; }\n',
    );

    expect(fixes[0]?.newText).toBe('strcmp(s, "NP") > 0');
  });

  it('does not offer the rewrite for a non-constant index', () => {
    const fixes = strcmpFixes(
      'int main(void) { char s[5]; int i = 0; if (s[i] == "NP") { } return 0; }\n',
    );

    expect(fixes).toEqual([]);
  });

  it('does not offer the rewrite for a plain char variable', () => {
    const fixes = strcmpFixes(
      'int main(void) { char c; if (c == "NP") { } return 0; }\n',
    );

    expect(fixes).toEqual([]);
  });

  it('does not offer the rewrite for a one-character literal', () => {
    const fixes = strcmpFixes(
      'int main(void) { char s[5]; if (s[0] == "P") { } return 0; }\n',
    );

    expect(fixes).toEqual([]);
  });
});
