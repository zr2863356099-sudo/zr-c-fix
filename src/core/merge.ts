import { ruleOrder } from './rules/registry';
import type { Fix, Issue, Range, Severity } from './rules/types';
import { lineBounds } from './rules/utils';

export interface LineReplacement {
  range: Range;
  newText: string;
}

interface Candidate {
  issue: Issue;
  fix: Fix;
}

export interface AcceptedLineFix {
  issue: Issue;
  fix: Fix;
}

/**
 * Merges every single-line fix on `line` into one whole-line replacement. Overlapping
 * fixes keep the higher severity, then the earlier rule in the registry.
 */
export function mergeLineFixes(
  issues: readonly Issue[],
  line: number,
  text: string,
): LineReplacement | null {
  const bounds = lineBounds(text, line);
  if (!bounds) {
    return null;
  }

  const accepted = acceptedLineFixes(issues, line, text);
  if (accepted.length === 0) {
    return null;
  }

  let newText = bounds.text;
  accepted
    .slice()
    .sort((left, right) => right.fix.range.startChar - left.fix.range.startChar)
    .forEach((candidate) => {
      const { startChar, endChar } = candidate.fix.range;
      newText =
        newText.slice(0, startChar) + candidate.fix.newText + newText.slice(endChar);
    });

  return {
    range: {
      startLine: line,
      startChar: 0,
      endLine: line,
      endChar: bounds.text.length,
    },
    newText,
  };
}

/** Non-overlapping fixes that `mergeLineFixes` would apply, ordered by start offset. */
export function acceptedLineFixes(
  issues: readonly Issue[],
  line: number,
  text: string,
): AcceptedLineFix[] {
  const bounds = lineBounds(text, line);
  if (!bounds) {
    return [];
  }

  const candidates: Candidate[] = [];
  for (const issue of issues) {
    const fix = issue.fix;
    if (
      !fix ||
      fix.range.startLine !== issue.range.startLine ||
      fix.range.startLine !== line ||
      fix.range.endLine !== line ||
      fix.range.startChar < 0 ||
      fix.range.startChar > fix.range.endChar ||
      fix.range.endChar > bounds.text.length
    ) {
      continue;
    }
    candidates.push({ issue, fix });
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort(
    (left, right) =>
      left.fix.range.startChar - right.fix.range.startChar ||
      left.fix.range.endChar - right.fix.range.endChar,
  );

  const accepted: Candidate[] = [];
  for (const cluster of clusterOverlaps(candidates)) {
    const best = cluster.reduce((current, candidate) =>
      comparePriority(candidate.issue, current.issue) < 0 ? candidate : current,
    );
    accepted.push(best);
  }

  return accepted.sort(
    (left, right) => left.fix.range.startChar - right.fix.range.startChar,
  );
}

function clusterOverlaps(candidates: readonly Candidate[]): Candidate[][] {
  const clusters: Candidate[][] = [];

  for (const candidate of candidates) {
    const touching = clusters.filter((cluster) =>
      cluster.some((member) => overlaps(member.fix.range, candidate.fix.range)),
    );

    if (touching.length === 0) {
      clusters.push([candidate]);
      continue;
    }

    const target = touching[0]!;
    target.push(candidate);
    for (const other of touching.slice(1)) {
      target.push(...other);
      clusters.splice(clusters.indexOf(other), 1);
    }
  }

  return clusters;
}

function overlaps(left: Range, right: Range): boolean {
  const leftEmpty = left.startChar === left.endChar;
  const rightEmpty = right.startChar === right.endChar;

  if (leftEmpty && rightEmpty) {
    return left.startChar === right.startChar;
  }
  if (leftEmpty) {
    return left.startChar >= right.startChar && left.startChar < right.endChar;
  }
  if (rightEmpty) {
    return right.startChar >= left.startChar && right.startChar < left.endChar;
  }
  return left.startChar < right.endChar && right.startChar < left.endChar;
}

function comparePriority(left: Issue, right: Issue): number {
  const severity = severityRank(left.severity) - severityRank(right.severity);
  if (severity !== 0) {
    return severity;
  }
  return ruleOrder(left.ruleId) - ruleOrder(right.ruleId);
}

function severityRank(severity: Severity): number {
  return severity === 'error' ? 0 : 1;
}
