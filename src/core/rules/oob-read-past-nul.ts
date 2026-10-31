import { inferType } from '../infer';
import {
  collectNodes,
  rangeFromNode,
  unwrapParentheses,
  type SyntaxNode,
} from './utils';
import type { Rule } from './types';
import { makeIssue } from './utils';

interface TerminatorCheck {
  /** Text of the array/pointer being indexed. */
  base: string;
  /** Normalized text of the index expression. */
  index: string;
}

export const rule: Rule = {
  id: 'oob-read-past-nul',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const node of collectNodes(ctx.root, 'binary_expression')) {
      if (operatorBetween(ctx.text, node) !== '&&') {
        continue;
      }
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (!left || !right) {
        continue;
      }

      const check = terminatorCheck(ctx.text, left);
      if (!check) {
        continue;
      }

      for (const read of collectNodes(right, 'subscript_expression')) {
        const parsed = parseSubscript(read);
        if (!parsed || normalized(parsed.base.text) !== check.base) {
          continue;
        }
        if (!isIndexPlusOne(ctx.text, parsed.index, check.index)) {
          continue;
        }

        const baseType = inferType(parsed.base, ctx.table);
        if (baseType.base !== 'char') {
          continue;
        }

        issues.push(
          makeIssue(
            rule,
            rangeFromNode(read),
            `Read past the '\\0' terminator of '${parsed.base.text}'`,
            `越界读取 '${parsed.base.text}' 的 '\\0' 结束符之后`,
          ),
        );
      }
    }

    return issues;
  },
};

/** Matches `s[i] == '\0'` and `'\0' == s[i]`. */
function terminatorCheck(
  text: string,
  node: SyntaxNode,
): TerminatorCheck | undefined {
  const condition = unwrapParentheses(node);
  if (condition.type !== 'binary_expression') {
    return undefined;
  }
  if (operatorBetween(text, condition) !== '==') {
    return undefined;
  }

  const left = unwrapParentheses(condition.namedChild(0) ?? condition);
  const right = unwrapParentheses(condition.namedChild(1) ?? condition);
  if (!left || !right) {
    return undefined;
  }

  const candidate = isNulLiteral(left)
    ? right
    : isNulLiteral(right)
      ? left
      : undefined;
  if (!candidate) {
    return undefined;
  }

  const subscript = parseSubscript(candidate);
  if (!subscript) {
    return undefined;
  }
  return {
    base: normalized(subscript.base.text),
    index: normalized(subscript.index.text),
  };
}

interface ParsedSubscript {
  base: SyntaxNode;
  index: SyntaxNode;
}

function parseSubscript(node: SyntaxNode): ParsedSubscript | undefined {
  const subscript = unwrapParentheses(node);
  if (subscript.type !== 'subscript_expression') {
    return undefined;
  }
  const base = subscript.childForFieldName('argument') ?? subscript.namedChild(0);
  const index = subscript.childForFieldName('index') ?? subscript.namedChild(1);
  return base && index ? { base, index } : undefined;
}

function isIndexPlusOne(
  text: string,
  index: SyntaxNode,
  baseIndex: string,
): boolean {
  const expression = unwrapParentheses(index);
  if (expression.type !== 'binary_expression') {
    return false;
  }
  if (operatorBetween(text, expression) !== '+') {
    return false;
  }
  const left = unwrapParentheses(expression.namedChild(0) ?? expression);
  const right = unwrapParentheses(expression.namedChild(1) ?? expression);
  if (!left || !right) {
    return false;
  }
  if (
    normalized(left.text) === baseIndex &&
    integerLiteralValue(right) === 1
  ) {
    return true;
  }
  return (
    normalized(right.text) === baseIndex && integerLiteralValue(left) === 1
  );
}

function isNulLiteral(node: SyntaxNode): boolean {
  const literal = unwrapParentheses(node);
  if (literal.type === 'number_literal') {
    return integerLiteralValue(literal) === 0;
  }
  if (literal.type !== 'char_literal') {
    return false;
  }
  const inner = literal.text.slice(1, -1).toLowerCase();
  return /^\\0+$/.test(inner) || /^\\x0+$/.test(inner);
}

function operatorBetween(text: string, node: SyntaxNode): string | undefined {
  const left = node.childForFieldName('left') ?? node.namedChild(0);
  const right =
    node.childForFieldName('right') ??
    node.namedChild(node.namedChildCount - 1);
  if (!left || !right) {
    return undefined;
  }
  return text.slice(left.endIndex, right.startIndex).trim();
}

function integerLiteralValue(node: SyntaxNode): number | undefined {
  if (node.type !== 'number_literal') {
    return undefined;
  }
  const cleaned = node.text.replace(/[uUlL]+$/, '');
  if (cleaned.length === 0 || /[.eEpP]/.test(cleaned)) {
    return undefined;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function normalized(text: string): string {
  return text.replace(/\s+/g, '');
}
