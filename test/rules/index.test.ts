import { describe, expect, it } from 'vitest';
import { getEnabledRuleIds, RULES } from '../../src/core/rules';
import { runRule } from './helpers';

describe('rule registry and presets', () => {
  it('registers every milestone rule', () => {
    expect(RULES.map((rule) => rule.id)).toEqual([
      'non-ascii-in-code',
      'unbalanced-braces',
      'missing-include-hash',
      'stray-literal',
      'char-string-literal',
      'string-eq-literal',
      'implicit-declaration',
      'unknown-type',
      'incomplete-expression',
      'undeclared-variable',
      'assignment-in-condition',
      'missing-semicolon',
      'scanf-missing-amp',
      'format-type-mismatch',
      'invalid-format-specifier',
      'format-arg-count',
      'call-arg-count',
      'scanf-string-width',
      'sprintf-unsafe',
      'missing-include',
      'nonvoid-missing-return',
      'shadowing',
      'uninitialized-use',
      'div-by-zero',
      'oob-read-past-nul',
      'for-cond-var-never-updated',
      'nested-loop-counter-clobber',
      'empty-statement-body',
      'int-literal-overflow',
      'stack-large-local',
      'stack-vla',
    ]);
  });

  it('mirrors the preset sizes in docs/RULES.md', () => {
    expect(getEnabledRuleIds('core')).toHaveLength(31);
    expect(getEnabledRuleIds('standard')).toHaveLength(50);
    expect(getEnabledRuleIds('all')).toHaveLength(53);
  });

  it('applies per-rule overrides on top of the preset', () => {
    const disabled = getEnabledRuleIds('core', {
      'unbalanced-braces': 'off',
    });
    expect(disabled).not.toContain('unbalanced-braces');
    expect(disabled).toHaveLength(30);

    const enabled = getEnabledRuleIds('core', {
      'sign-compare': 'error',
    });
    expect(enabled).toContain('sign-compare');
  });

  it('runs only the requested rules', async () => {
    const source = 'int main() {\n  int x = 1\n  return 0;\n';

    const onlySemicolon = await runRule(source, 'missing-semicolon');
    expect(onlySemicolon.map((issue) => issue.ruleId)).toEqual([
      'missing-semicolon',
    ]);

    const onlyBraces = await runRule(source, 'unbalanced-braces');
    expect(onlyBraces.map((issue) => issue.ruleId)).toEqual([
      'unbalanced-braces',
    ]);
  });
});
