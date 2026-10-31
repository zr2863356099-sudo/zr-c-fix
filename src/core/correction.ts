import { acceptedLineFixes, mergeLineFixes } from './merge';
import type { Issue, Range } from './rules/types';

export type CorrectionMode = 'whole-line' | 'fragment';

export interface InlineCorrection {
  range: Range;
  newText: string;
  /** Rule whose fix anchors the suggestion and the suppression key. */
  ruleId: string;
}

/**
 * Builds the single-line inline correction. The merged whole-line replacement is the
 * source of truth; fragment mode narrows the accepted range to the first fix so VS Code
 * replaces only that span.
 */
export function buildInlineCorrection(
  issues: readonly Issue[],
  line: number,
  text: string,
  mode: CorrectionMode,
): InlineCorrection | null {
  const first = acceptedLineFixes(issues, line, text)[0];
  if (!first) {
    return null;
  }

  if (mode === 'fragment') {
    return {
      range: first.fix.range,
      newText: first.fix.newText,
      ruleId: first.issue.ruleId,
    };
  }

  const replacement = mergeLineFixes(issues, line, text);
  if (!replacement) {
    return null;
  }

  return {
    range: replacement.range,
    newText: replacement.newText,
    ruleId: first.issue.ruleId,
  };
}
