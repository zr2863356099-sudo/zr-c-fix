import { SYNTAX_REPORT_RULES } from './rules/syntaxRepair';
import type { Issue } from './rules/types';

export interface IssueVisibilityContext {
  hasError: boolean;
  errorLines: ReadonlySet<number>;
  syntaxRepairRules: ReadonlySet<string>;
}

/**
 * Decides whether an issue may be shown while the syntax tree is incomplete. Without
 * syntax errors everything is visible. With errors, only issues on lines the parser did
 * not flag remain trustworthy, plus token-level syntax repairs and rules that report
 * the syntax problem itself.
 */
export function isIssueVisible(
  issue: Issue,
  ctx: IssueVisibilityContext,
): boolean {
  if (!ctx.hasError) {
    return true;
  }
  if (
    ctx.syntaxRepairRules.has(issue.ruleId) ||
    SYNTAX_REPORT_RULES.has(issue.ruleId)
  ) {
    return true;
  }
  return !ctx.errorLines.has(issue.range.startLine);
}
