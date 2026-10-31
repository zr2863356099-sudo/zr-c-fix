import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CParser } from '../../src/core/parser';
import { firstCharComparisonFixes, strcmpFixFor } from '../../src/core/rules/string-eq-literal';
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

function alternatives(source: string) {
  if (!parser) {
    throw new Error('parser not initialised');
  }
  const tree = parser.parse(source);
  try {
    return firstCharComparisonFixes({
      text: source,
      root: tree.rootNode,
      table: buildSymbolTable(tree.rootNode, source),
    });
  } finally {
    tree.delete();
  }
}

function strcmpAlternatives(source: string) {
  if (!parser) {
    throw new Error('parser not initialised');
  }
  const tree = parser.parse(source);
  try {
    return strcmpFixFor({
      text: source,
      root: tree.rootNode,
      table: buildSymbolTable(tree.rootNode, source),
    });
  } finally {
    tree.delete();
  }
}

describe('string-eq-literal', () => {
  it('rewrites == between a char array and a string literal to strcmp', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s == "abc") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'string-eq-literal',
      channel: 'ghost',
      severity: 'warning',
      fix: { newText: 'strcmp(s, "abc") == 0' },
    });
  });

  it('prefers the first-character comparison for > with a one-character literal', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s > "0") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe("s[0] > '0'");
  });

  it('prefers the first-character comparison for <= with a one-character literal', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s <= "9") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe("s[0] <= '9'");
  });

  it('keeps strcmp for > with a multi-character literal', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s > "abc") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('strcmp(s, "abc") > 0');
  });

  it('keeps strcmp for == with a one-character literal', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s == "0") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('strcmp(s, "0") == 0');
  });

  it('keeps strcmp for != with a one-character literal', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s != "0") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('strcmp(s, "0") != 0');
  });

  it('reports both sides of a pointer comparison', async () => {
    const issues = await runRule(
      'int main(void) { char *p, *q; if (p < q) { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('strcmp(p, q) < 0');
  });

  it('groups equality messages and includes both operands', async () => {
    const [issue] = await runRule(
      'int main(void) { char s[5]; if (s != "abc") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issue?.message).toContain('compares addresses, not contents');
    expect(issue?.message).toContain('s');
    expect(issue?.message).toContain('"abc"');
    expect(issue?.messageZh).toContain('比较的是地址而不是字符串内容');
  });

  it('groups relational messages and includes both operands', async () => {
    const [issue] = await runRule(
      'int main(void) { char s[5]; if (s >= "9") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issue?.message).toContain(
      'compares pointer addresses, not lexicographic order',
    );
    expect(issue?.messageZh).toContain('按地址比较，不是按字符串字典序');
  });

  it('ignores integer comparisons', async () => {
    await expect(
      runRule(
        'int main(void) { int a = 1; if (a > 0) { } return 0; }\n',
        'string-eq-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores character comparisons', async () => {
    await expect(
      runRule(
        "int main(void) { char c = '5'; if (c > '0') { } return 0; }\n",
        'string-eq-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores a char element compared with a string literal', async () => {
    await expect(
      runRule(
        'int main(void) { char s[5]; if (s[0] == "a") { } return 0; }\n',
        'string-eq-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores the correct strcmp form', async () => {
    await expect(
      runRule(
        'int main(void) { char s[5]; if (strcmp(s, "a") == 0) { } return 0; }\n',
        'string-eq-literal',
      ),
    ).resolves.toEqual([]);
  });

  it('reports each comparison independently in a logical chain', async () => {
    const issues = await runRule(
      'int main(void) { char s[5]; if (s > "0" && s < "9") { } return 0; }\n',
      'string-eq-literal',
    );

    expect(issues.map((issue) => issue.fix?.newText)).toEqual([
      "s[0] > '0'",
      "s[0] < '9'",
    ]);
  });
});

describe('string-eq-literal first-character alternative', () => {
  it('offers the array element comparison', () => {
    const fixes = alternatives(
      'int main(void) { char s[5]; if (s > "0") { } return 0; }\n',
    );

    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.newText).toBe("s[0] > '0'");
  });

  it('keeps the operand order when the literal is on the left', () => {
    const fixes = alternatives(
      'int main(void) { char s[5]; if ("9" < s) { } return 0; }\n',
    );

    expect(fixes[0]?.newText).toBe("'9' < s[0]");
  });

  it('offers the alternative for a char pointer', () => {
    const fixes = alternatives(
      'int main(void) { char *p; if (p >= "9") { } return 0; }\n',
    );

    expect(fixes[0]?.newText).toBe("p[0] >= '9'");
  });

  it('parenthesizes compound pointer operands', () => {
    const fixes = alternatives(
      'int main(void) { char **pp; if (*pp > "0") { } return 0; }\n',
    );

    expect(fixes[0]?.newText).toBe("(*pp)[0] > '0'");
  });

  it('does not offer the alternative for multi-character literals', () => {
    const fixes = alternatives(
      'int main(void) { char s[5]; if (s == "abc") { } return 0; }\n',
    );

    expect(fixes).toEqual([]);
  });

  it('does not offer the alternative when both sides are literals', () => {
    const fixes = alternatives(
      'int main(void) { if ("a" == "b") { } return 0; }\n',
    );

    expect(fixes).toEqual([]);
  });
});

describe('string-eq-literal strcmp alternative', () => {
  it('offers strcmp for a relational comparison with a one-character literal', () => {
    const fixes = strcmpAlternatives(
      'int main(void) { char s[5]; if (s > "0") { } return 0; }\n',
    );

    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.newText).toBe('strcmp(s, "0") > 0');
  });

  it('does not offer strcmp for equality, which already uses strcmp', () => {
    expect(
      strcmpAlternatives(
        'int main(void) { char s[5]; if (s == "0") { } return 0; }\n',
      ),
    ).toEqual([]);
  });

  it('does not offer strcmp for multi-character literals', () => {
    expect(
      strcmpAlternatives(
        'int main(void) { char s[5]; if (s > "abc") { } return 0; }\n',
      ),
    ).toEqual([]);
  });
});
