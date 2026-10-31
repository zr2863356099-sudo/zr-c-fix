import { rule as assignmentInCondition } from './assignment-in-condition';
import { rule as callArgCount } from './call-arg-count';
import { rule as charStringLiteral } from './char-string-literal';
import { rule as divByZero } from './div-by-zero';
import { rule as emptyStatementBody } from './empty-statement-body';
import { rule as forCondVarNeverUpdated } from './for-cond-var-never-updated';
import { rule as formatArgCount } from './format-arg-count';
import { rule as formatTypeMismatch } from './format-type-mismatch';
import { rule as implicitDeclaration } from './implicit-declaration';
import { rule as incompleteExpression } from './incomplete-expression';
import { rule as intLiteralOverflow } from './int-literal-overflow';
import { rule as invalidFormatSpecifier } from './invalid-format-specifier';
import { rule as missingInclude } from './missing-include';
import { rule as missingIncludeHash } from './missing-include-hash';
import { rule as missingSemicolon } from './missing-semicolon';
import { rule as nestedLoopCounterClobber } from './nested-loop-counter-clobber';
import { rule as nonAsciiInCode } from './non-ascii-in-code';
import { rule as nonvoidMissingReturn } from './nonvoid-missing-return';
import { rule as oobReadPastNul } from './oob-read-past-nul';
import { rule as scanfMissingAmp } from './scanf-missing-amp';
import { rule as scanfStringWidth } from './scanf-string-width';
import { rule as shadowing } from './shadowing';
import { rule as sprintfUnsafe } from './sprintf-unsafe';
import { rule as stackLargeLocal } from './stack-large-local';
import { rule as stackVla } from './stack-vla';
import { rule as strayLiteral } from './stray-literal';
import { rule as stringEqLiteral } from './string-eq-literal';
import type { PresetName, Rule, RuleOverride } from './types';
import { rule as unbalancedBraces } from './unbalanced-braces';
import { rule as undeclaredVariable } from './undeclared-variable';
import { rule as uninitializedUse } from './uninitialized-use';
import { rule as unknownType } from './unknown-type';

/** Registration order also breaks ties between same-severity issues. */
export const RULES: readonly Rule[] = [
  nonAsciiInCode,
  unbalancedBraces,
  missingIncludeHash,
  strayLiteral,
  charStringLiteral,
  stringEqLiteral,
  implicitDeclaration,
  unknownType,
  incompleteExpression,
  undeclaredVariable,
  assignmentInCondition,
  missingSemicolon,
  scanfMissingAmp,
  formatTypeMismatch,
  invalidFormatSpecifier,
  formatArgCount,
  callArgCount,
  scanfStringWidth,
  sprintfUnsafe,
  missingInclude,
  nonvoidMissingReturn,
  shadowing,
  uninitializedUse,
  divByZero,
  oobReadPastNul,
  forCondVarNeverUpdated,
  nestedLoopCounterClobber,
  emptyStatementBody,
  intLiteralOverflow,
  stackLargeLocal,
  stackVla,
];

const RULE_ORDER = new Map(
  RULES.map((rule, index) => [rule.id, index] as const),
);

export function ruleOrder(ruleId: string): number {
  return RULE_ORDER.get(ruleId) ?? Number.MAX_SAFE_INTEGER;
}

// Preset membership mirrors docs/RULES.md. Rules that are not implemented yet stay in
// the lists so later milestones light them up without touching the presets.
const CORE_RULES: readonly string[] = [
  'scanf-missing-amp',
  'format-type-mismatch',
  'invalid-format-specifier',
  'format-arg-count',
  'call-arg-count',
  'scanf-string-width',
  'sprintf-unsafe',
  'missing-include',
  'assignment-in-condition',
  'missing-semicolon',
  'nonvoid-missing-return',
  'shadowing',
  'uninitialized-use',
  'div-by-zero',
  'int-literal-overflow',
  'oob-read-past-nul',
  'for-cond-var-never-updated',
  'nested-loop-counter-clobber',
  'empty-statement-body',
  'stack-large-local',
  'stack-vla',
  'unbalanced-braces',
  'missing-include-hash',
  'stray-literal',
  'char-string-literal',
  'string-eq-literal',
  'implicit-declaration',
  'incomplete-expression',
  'undeclared-variable',
  'non-ascii-in-code',
  'unknown-type',
];

const STANDARD_RULES: readonly string[] = [
  'scanf-trailing-newline',
  'scanf-c-newline',
  'strcmp-truthiness',
  'strncpy-no-nul',
  'strcpy-overflow',
  'strcat-overflow',
  'string-literal-write',
  'sizeof-as-length',
  'integer-division',
  'chained-comparison',
  'array-oob-literal',
  'bitwise-precedence',
  'switch-fallthrough',
  'void-main',
  'unreachable-else-if',
  'stack-recursion-large-frame',
  'stack-no-base-case',
  'sizeof-param-array',
  'sign-compare',
];

const DISABLED_BY_DEFAULT: readonly string[] = [
  'unchecked-scanf-return',
  'strlen-int-truncation',
  'loop-off-by-one',
];

export const PRESET_RULES: Readonly<Record<PresetName, readonly string[]>> = {
  core: CORE_RULES,
  standard: [...CORE_RULES, ...STANDARD_RULES],
  all: [...CORE_RULES, ...STANDARD_RULES, ...DISABLED_BY_DEFAULT],
};

export function getEnabledRuleIds(
  preset: PresetName,
  overrides: Readonly<Record<string, RuleOverride>> = {},
): string[] {
  const enabled = new Set(PRESET_RULES[preset]);

  for (const [ruleId, override] of Object.entries(overrides)) {
    if (override === 'off') {
      enabled.delete(ruleId);
    } else {
      enabled.add(ruleId);
    }
  }

  return Array.from(enabled);
}
