import type { Rule } from './types';
import {
  collectNodes,
  isSingleLine,
  lineBounds,
  makeIssue,
  maskNonCode,
  rangeFromNode,
} from './utils';

const STRAY_PATTERN = /^\d+(\s+\d+)*$/;
const CONTEXT_TOKENS = /[};]/;
const CONTEXT_LINES = 2;

export const rule: Rule = {
  id: 'stray-literal',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const masked = maskNonCode(ctx.text);
    const issues = [];

    for (const errorNode of collectNodes(ctx.root, 'ERROR')) {
      if (errorNode.parent?.type === 'ERROR') {
        continue;
      }
      if (!STRAY_PATTERN.test(errorNode.text)) {
        continue;
      }
      if (!hasContextToken(masked, errorNode.startPosition.row, errorNode.endPosition.row)) {
        continue;
      }

      const range = rangeFromNode(errorNode);
      if (isSingleLine(errorNode)) {
        issues.push(
          makeIssue(rule, range, 'Stray numeric literal', '多余的数字字面量', {
            range,
            newText: '',
          }),
        );
      } else {
        // Deleting across lines would violate the single-line ghost invariant, so a
        // multi-line paste is only surfaced as a hint.
        issues.push(
          makeIssue(
            rule,
            range,
            'Stray numeric literals pasted across lines',
            '跨行粘贴的多余数字字面量',
            undefined,
            'hint',
          ),
        );
      }
    }

    return issues;
  },
};

function hasContextToken(text: string, startLine: number, endLine: number): boolean {
  for (let line = startLine - CONTEXT_LINES; line < startLine; line++) {
    if (lineHasToken(text, line)) {
      return true;
    }
  }
  for (let line = endLine + 1; line <= endLine + CONTEXT_LINES; line++) {
    if (lineHasToken(text, line)) {
      return true;
    }
  }
  return false;
}

function lineHasToken(text: string, line: number): boolean {
  const bounds = lineBounds(text, line);
  return bounds !== undefined && CONTEXT_TOKENS.test(bounds.text);
}
