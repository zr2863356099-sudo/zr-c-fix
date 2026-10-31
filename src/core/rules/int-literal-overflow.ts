import type { Rule } from './types';
import { collectNodes, makeIssue, rangeFromNode } from './utils';

const INT_MAX = 2147483647;

export const rule: Rule = {
  id: 'int-literal-overflow',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const literal of collectNodes(ctx.root, 'number_literal')) {
      const text = literal.text;
      const digits = text.startsWith('-') || text.startsWith('+')
        ? text.slice(1)
        : text;
      if (hasFloatSuffix(digits) || hasWideSuffix(digits)) {
        continue;
      }

      const value = integerValue(digits);
      if (value === undefined || value <= INT_MAX) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(literal),
          'Integer literal exceeds int range',
          '整数字面量超出 int 范围',
        ),
      );
    }

    return issues;
  },
};

function hasWideSuffix(text: string): boolean {
  return /[uUlL]/.test(text);
}

function hasFloatSuffix(text: string): boolean {
  if (/^0[xX]/.test(text)) {
    return text.includes('.') || /[pP]/.test(text);
  }
  return text.includes('.') || /[eE]/.test(text);
}

function integerValue(text: string): number | undefined {
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(text)) {
    return Number.parseInt(text.slice(1), 8);
  }
  if (/^[0-9]+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return undefined;
}
