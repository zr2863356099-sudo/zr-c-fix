import { describe, expect, it } from 'vitest';
import { runRule } from './rules/helpers';

/** One source per rule, chosen to trigger exactly the rule under test. */
const SAMPLES: ReadonlyArray<{ ruleId: string; source: string }> = [
  { ruleId: 'undeclared-variable', source: 'int main(void) { return i; }\n' },
  {
    ruleId: 'missing-semicolon',
    source: 'int main(void) { int x = 1 return 0; }\n',
  },
  {
    ruleId: 'missing-include-hash',
    source: 'include <stdio.h>\nint main(void) { return 0; }\n',
  },
  {
    ruleId: 'unbalanced-braces',
    source: 'int main(void) {\n  return 0;\n',
  },
  {
    ruleId: 'int-literal-overflow',
    source: 'int main(void) { return 2147483648; }\n',
  },
  {
    ruleId: 'format-type-mismatch',
    source:
      '#include <stdio.h>\nint main(void) { long long r = 5; printf("%d", r); return 0; }\n',
  },
  {
    ruleId: 'scanf-missing-amp',
    source:
      '#include <stdio.h>\nint main(void) { int x; scanf("%d", x); return 0; }\n',
  },
  {
    ruleId: 'shadowing',
    source: 'int x;\nint main(void) { int x = 1; return x; }\n',
  },
  {
    ruleId: 'sprintf-unsafe',
    source:
      '#include <stdio.h>\nint main(void) { char buf[10]; sprintf(buf, "%d", 1); return 0; }\n',
  },
  {
    ruleId: 'unknown-type',
    source: 'int main(void) { doube x = 1.0; return 0; }\n',
  },
];

/** Sentence fragments that must not survive into the Chinese text. */
const ENGLISH_FRAGMENTS =
  /\b(?:is|are|the|use|not|does|did|mean|missing|unknown|uninitialized|shadow|exceed|expect|incomplete|unsafe|declared)\b/i;

describe('messageZh', () => {
  it.each(SAMPLES)('$ruleId is Chinese', async ({ ruleId, source }) => {
    const issues = await runRule(source, ruleId);

    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.messageZh.trim().length).toBeGreaterThan(0);
      expect(issue.messageZh).not.toBe(issue.message);
      expect(issue.messageZh).toMatch(/[一-鿿]/);
      expect(issue.messageZh).not.toMatch(ENGLISH_FRAGMENTS);
    }
  });
});
