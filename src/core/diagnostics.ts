import { isIssueVisible, type IssueVisibilityContext } from './issueVisibility';
import { SYNTAX_REPAIR_RULES } from './rules/syntaxRepair';
import type { Issue } from './rules/types';

export interface DiagnosticSelection {
  issues: readonly Issue[];
  hasError: boolean;
  /** Lines covered by an ERROR or missing node. */
  errorLines: ReadonlySet<number>;
  /** `cfix.diagnostics.includeFixable`; when false only hints are listed. */
  includeFixable: boolean;
}

export type DiagnosticLocale = 'zh' | 'en';

/** Picks the user-facing text for `cfix.locale`, defaulting to Chinese. */
export function diagnosticMessage(
  issue: Pick<Issue, 'message' | 'messageZh'>,
  locale: DiagnosticLocale,
): string {
  return locale === 'en' ? issue.message : issue.messageZh;
}

/**
 * Chooses which issues reach the Problems panel. Fixable issues are listed unless the
 * file is mid-edit, where only issues on clean lines, hints and syntax repairs are
 * trustworthy.
 */
export function selectDiagnostics(input: DiagnosticSelection): Issue[] {
  const { issues, includeFixable } = input;

  if (!includeFixable) {
    return issues.filter((issue) => issue.channel === 'hint');
  }

  const visibility: IssueVisibilityContext = {
    hasError: input.hasError,
    errorLines: input.errorLines,
    syntaxRepairRules: SYNTAX_REPAIR_RULES,
  };
  return issues.filter((issue) => isIssueVisible(issue, visibility));
}
