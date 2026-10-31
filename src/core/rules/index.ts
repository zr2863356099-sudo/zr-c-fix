import { RULES, getEnabledRuleIds, ruleOrder } from './registry';
import type { Issue, RuleContext, Severity } from './types';

export * from './types';
export { PRESET_RULES, RULES, getEnabledRuleIds, ruleOrder } from './registry';

/**
 * Runs the enabled rules in registration order and folds same-position diagnostics into
 * one main issue (error before warning, then rule order); the rest go to `related`.
 */
export function runRules(
  ctx: RuleContext,
  enabledIds?: readonly string[],
): Issue[] {
  const enabled = new Set(
    enabledIds ?? getEnabledRuleIds(ctx.config.preset, ctx.config.overrides),
  );

  const issues: Issue[] = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.id)) {
      continue;
    }

    const override = ctx.config.overrides[rule.id];
    const severity =
      override === 'warning' || override === 'error' ? override : rule.severity;
    for (const issue of rule.check(ctx)) {
      issues.push(issue.severity === severity ? issue : { ...issue, severity });
    }
  }

  return collapseSamePosition(issues);
}

function collapseSamePosition(issues: readonly Issue[]): Issue[] {
  const groups = new Map<string, Issue[]>();

  for (const issue of issues) {
    const key = `${issue.range.startLine}:${issue.range.startChar}`;
    const group = groups.get(key);
    if (group) {
      group.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  const result: Issue[] = [];
  for (const group of groups.values()) {
    group.sort(compareIssuePriority);
    const main = group[0];
    if (!main) {
      continue;
    }
    if (group.length > 1) {
      main.related = group.slice(1).map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        message: issue.message,
      }));
    }
    result.push(main);
  }

  return result.sort(
    (left, right) =>
      left.range.startLine - right.range.startLine ||
      left.range.startChar - right.range.startChar ||
      compareIssuePriority(left, right),
  );
}

function compareIssuePriority(left: Issue, right: Issue): number {
  const severity = severityRank(left.severity) - severityRank(right.severity);
  if (severity !== 0) {
    return severity;
  }
  return ruleOrder(left.ruleId) - ruleOrder(right.ruleId);
}

function severityRank(severity: Severity): number {
  return severity === 'error' ? 0 : 1;
}
