import { inferType } from '../infer';
import {
  collectNodes,
  declaratorIdentifier,
  nearestAncestor,
  rangeFromNode,
  unwrapParentheses,
  type SyntaxNode,
} from './utils';
import { integerRank } from './type-model';
import type { Rule } from './types';
import { makeIssue } from './utils';

const WRITE_TYPES = [
  'assignment_expression',
  'update_expression',
  'pointer_expression',
  'init_declarator',
];

export const rule: Rule = {
  id: 'div-by-zero',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const node of collectNodes(ctx.root, 'binary_expression')) {
      const operator = operatorBetween(ctx.text, node);
      if (operator !== '/' && operator !== '%') {
        continue;
      }

      const divisor = node.childForFieldName('right');
      if (!divisor) {
        continue;
      }

      const target = unwrapParentheses(divisor);
      if (integerLiteralValue(target) === 0) {
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(divisor),
            `Division by zero literal in '${node.text}'`,
            `'${node.text}' 中除数为零`,
          ),
        );
        continue;
      }

      if (target.type !== 'identifier') {
        continue;
      }
      const type = inferType(target, ctx.table);
      if (integerRank(type) === undefined) {
        continue;
      }

      if (
        isGuarded(node, target.text, ctx.text, ctx.root) ||
        latestWriteIsNonZero(node, target.text, ctx.text, ctx.root)
      ) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(target),
          `Possible division by zero: '${target.text}' may be 0`,
          `可能除零：'${target.text}' 可能为 0`,
        ),
      );
    }

    return issues;
  },
};

function isGuarded(
  division: SyntaxNode,
  name: string,
  text: string,
  root: SyntaxNode,
): boolean {
  const body =
    nearestAncestor(division, 'function_definition')?.childForFieldName('body') ??
    root;
  return (
    guardedByAncestors(division, name, text, body) ||
    guardedByPrecedingReturn(division, name, text, body)
  );
}

function guardedByAncestors(
  division: SyntaxNode,
  name: string,
  text: string,
  body: SyntaxNode,
): boolean {
  let parent = division.parent;

  while (parent && parent.type !== 'function_definition') {
    if (parent.type === 'if_statement') {
      const condition = parent.childForFieldName('condition');
      const consequence = parent.childForFieldName('consequence');
      const alternative = parent.childForFieldName('alternative');
      if (
        condition &&
        !writesBetween(body, name, text, condition.endIndex, division.startIndex)
      ) {
        if (
          contains(consequence, division) &&
          impliesNonZero(condition, name, text)
        ) {
          return true;
        }
        if (
          contains(alternative, division) &&
          impliesZero(condition, name, text)
        ) {
          return true;
        }
      }
    } else if (parent.type === 'binary_expression') {
      const operator = operatorBetween(text, parent);
      const left = parent.childForFieldName('left');
      const right = parent.childForFieldName('right');
      if (left && right && contains(right, division)) {
        if (operator === '&&' && impliesNonZero(left, name, text)) {
          return true;
        }
        if (operator === '||' && impliesZero(left, name, text)) {
          return true;
        }
      }
    } else if (parent.type === 'conditional_expression') {
      const condition = parent.childForFieldName('condition');
      const consequence = parent.childForFieldName('consequence');
      const alternative = parent.childForFieldName('alternative');
      if (condition) {
        if (
          contains(consequence, division) &&
          impliesNonZero(condition, name, text)
        ) {
          return true;
        }
        if (
          contains(alternative, division) &&
          impliesZero(condition, name, text)
        ) {
          return true;
        }
      }
    }

    parent = parent.parent;
  }

  return false;
}

/**
 * `if (x == 0) return ...; x / y` — a guard that exits the function (or loop)
 * before the division runs.
 */
function guardedByPrecedingReturn(
  division: SyntaxNode,
  name: string,
  text: string,
  body: SyntaxNode,
): boolean {
  let current: SyntaxNode = division;

  while (current.parent && current.parent.type !== 'function_definition') {
    const parent = current.parent;
    if (parent.type === 'compound_statement') {
      for (const sibling of parent.namedChildren) {
        if (sibling.endIndex > division.startIndex) {
          break;
        }
        if (
          guardExitsWhenZero(sibling, name, text) &&
          !writesBetween(
            body,
            name,
            text,
            sibling.endIndex,
            division.startIndex,
          )
        ) {
          return true;
        }
      }
    }
    current = parent;
  }

  return false;
}

function guardExitsWhenZero(
  node: SyntaxNode,
  name: string,
  text: string,
): boolean {
  if (node.type === 'compound_statement') {
    return node.namedChildren.some((child) =>
      guardExitsWhenZero(child, name, text),
    );
  }
  if (node.type !== 'if_statement') {
    return false;
  }

  const condition = node.childForFieldName('condition');
  const consequence = node.childForFieldName('consequence');
  const alternative = node.childForFieldName('alternative');
  if (!condition) {
    return false;
  }
  if (impliesZero(condition, name, text) && definitelyExits(consequence)) {
    return true;
  }
  if (impliesNonZero(condition, name, text) && definitelyExits(alternative)) {
    return true;
  }
  return false;
}

/** A comparison true only when `name` is non-zero. */
function impliesNonZero(
  condition: SyntaxNode,
  name: string,
  text: string,
): boolean {
  const node = unwrapParentheses(condition);

  if (node.type === 'identifier') {
    return node.text === name;
  }

  if (node.type === 'binary_expression') {
    const operator = operatorBetween(text, node);
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right) {
      return false;
    }
    if (operator === '&&') {
      return (
        impliesNonZero(left, name, text) || impliesNonZero(right, name, text)
      );
    }
    if (operator === '||') {
      return (
        impliesNonZero(left, name, text) && impliesNonZero(right, name, text)
      );
    }
    const leftNode = unwrapParentheses(left);
    const rightNode = unwrapParentheses(right);
    if (leftNode.type === 'identifier' && leftNode.text === name) {
      return comparisonImpliesNonZero(operator, rightNode);
    }
    if (rightNode.type === 'identifier' && rightNode.text === name) {
      return comparisonImpliesNonZero(
        reverseOperator(operator),
        leftNode,
      );
    }
  }

  return false;
}

/** A comparison true only when `name` is zero. */
function impliesZero(
  condition: SyntaxNode,
  name: string,
  text: string,
): boolean {
  const node = unwrapParentheses(condition);

  if (node.type === 'binary_expression') {
    const operator = operatorBetween(text, node);
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right) {
      return false;
    }
    if (operator === '&&') {
      return impliesZero(left, name, text) || impliesZero(right, name, text);
    }
    if (operator === '||') {
      return impliesZero(left, name, text) && impliesZero(right, name, text);
    }
    const leftNode = unwrapParentheses(left);
    const rightNode = unwrapParentheses(right);
    if (leftNode.type === 'identifier' && leftNode.text === name) {
      return comparisonImpliesZero(operator, rightNode);
    }
    if (rightNode.type === 'identifier' && rightNode.text === name) {
      return comparisonImpliesZero(reverseOperator(operator), leftNode);
    }
  }

  if (node.type === 'unary_expression' && node.text.trimStart().startsWith('!')) {
    const inner = node.namedChild(0);
    return inner !== null && impliesNonZero(inner, name, text);
  }

  return false;
}

function comparisonImpliesNonZero(
  operator: string | undefined,
  other: SyntaxNode,
): boolean {
  const value = integerLiteralValue(other);
  if (value === undefined) {
    return false;
  }
  switch (operator) {
    case '!=':
      return value === 0;
    case '==':
      return value !== 0;
    case '>':
      return value >= 0;
    case '>=':
      return value >= 1;
    case '<':
      return value <= 0;
    case '<=':
      return value <= -1;
    default:
      return false;
  }
}

function comparisonImpliesZero(
  operator: string | undefined,
  other: SyntaxNode,
): boolean {
  return operator === '==' && integerLiteralValue(other) === 0;
}

function reverseOperator(operator: string | undefined): string | undefined {
  switch (operator) {
    case '>':
      return '<';
    case '>=':
      return '<=';
    case '<':
      return '>';
    case '<=':
      return '>=';
    default:
      return operator;
  }
}

function contains(
  ancestor: SyntaxNode | null | undefined,
  node: SyntaxNode,
): boolean {
  return (
    ancestor !== null &&
    ancestor !== undefined &&
    ancestor.startIndex <= node.startIndex &&
    node.endIndex <= ancestor.endIndex
  );
}

function definitelyExits(node: SyntaxNode | null | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case 'return_statement':
    case 'break_statement':
    case 'continue_statement':
    case 'goto_statement':
      return true;
    case 'compound_statement':
      return node.namedChildren.some(definitelyExits);
    case 'if_statement':
      return (
        definitelyExits(node.childForFieldName('consequence')) &&
        definitelyExits(node.childForFieldName('alternative'))
      );
    case 'else_clause':
      return definitelyExits(node.namedChildren[0]);
    case 'labeled_statement':
      return definitelyExits(node.namedChildren[0]);
    default:
      return false;
  }
}

/**
 * True when the most recent write to `name` before the division is a non-zero
 * integer literal, e.g. `for (i = 2; i <= n / i; ++i)`.
 */
function latestWriteIsNonZero(
  division: SyntaxNode,
  name: string,
  text: string,
  root: SyntaxNode,
): boolean {
  const body =
    nearestAncestor(division, 'function_definition')?.childForFieldName('body') ??
    root;
  let latestIndex = -1;
  let knownNonZero = false;

  const consider = (index: number, nonZero: boolean): void => {
    if (index < division.startIndex && index > latestIndex) {
      latestIndex = index;
      knownNonZero = nonZero;
    }
  };

  for (const node of collectNodes(body, 'assignment_expression')) {
    const left = node.childForFieldName('left');
    const unwrapped = left ? unwrapParentheses(left) : undefined;
    if (!unwrapped || unwrapped.type !== 'identifier' || unwrapped.text !== name) {
      continue;
    }
    const right = node.childForFieldName('right');
    const plainAssign = operatorBetween(text, node) === '=';
    const value =
      plainAssign && right ? integerLiteralValue(unwrapParentheses(right)) : undefined;
    consider(node.startIndex, value !== undefined && value !== 0);
  }

  for (const node of collectNodes(body, 'update_expression')) {
    const argument = node.childForFieldName('argument') ?? node.namedChild(0);
    const unwrapped = argument ? unwrapParentheses(argument) : undefined;
    if (unwrapped?.type === 'identifier' && unwrapped.text === name) {
      consider(node.startIndex, false);
    }
  }

  for (const node of collectNodes(body, 'init_declarator')) {
    const identifier = declaratorIdentifier(
      node.childForFieldName('declarator'),
    );
    if (!identifier || identifier.text !== name) {
      continue;
    }
    const value = node.childForFieldName('value');
    const literal = value
      ? integerLiteralValue(unwrapParentheses(value))
      : undefined;
    consider(node.startIndex, literal !== undefined && literal !== 0);
  }

  for (const node of collectNodes(body, 'pointer_expression')) {
    if (!node.text.trimStart().startsWith('&')) {
      continue;
    }
    const argument = node.childForFieldName('argument') ?? node.namedChild(0);
    const unwrapped = argument ? unwrapParentheses(argument) : undefined;
    if (unwrapped?.type === 'identifier' && unwrapped.text === name) {
      consider(node.startIndex, false);
    }
  }

  return latestIndex >= 0 && knownNonZero;
}

function writesBetween(
  body: SyntaxNode,
  name: string,
  text: string,
  from: number,
  to: number,
): boolean {
  for (const node of collectNodes(body, WRITE_TYPES)) {
    if (node.startIndex < from || node.startIndex >= to) {
      continue;
    }
    if (writeTargetName(node, text) === name) {
      return true;
    }
  }
  return false;
}

function writeTargetName(
  node: SyntaxNode,
  text: string,
): string | undefined {
  switch (node.type) {
    case 'assignment_expression': {
      const left = node.childForFieldName('left');
      const unwrapped = left ? unwrapParentheses(left) : undefined;
      return unwrapped?.type === 'identifier' ? unwrapped.text : undefined;
    }
    case 'update_expression': {
      const argument = node.childForFieldName('argument') ?? node.namedChild(0);
      const unwrapped = argument ? unwrapParentheses(argument) : undefined;
      return unwrapped?.type === 'identifier' ? unwrapped.text : undefined;
    }
    case 'pointer_expression': {
      if (!node.text.trimStart().startsWith('&')) {
        return undefined;
      }
      const argument = node.childForFieldName('argument') ?? node.namedChild(0);
      const unwrapped = argument ? unwrapParentheses(argument) : undefined;
      return unwrapped?.type === 'identifier' ? unwrapped.text : undefined;
    }
    case 'init_declarator': {
      return declaratorIdentifier(node.childForFieldName('declarator'))?.text;
    }
    default:
      return undefined;
  }
}

function operatorBetween(
  text: string,
  node: SyntaxNode,
): string | undefined {
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
  if (node.type === 'number_literal') {
    const cleaned = node.text.replace(/[uUlL]+$/, '');
    if (cleaned.length === 0 || /[.eEpP]/.test(cleaned)) {
      return undefined;
    }
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : undefined;
  }

  if (node.type === 'unary_expression') {
    const inner = node.namedChild(0);
    if (!inner) {
      return undefined;
    }
    const value = integerLiteralValue(inner);
    if (value === undefined) {
      return undefined;
    }
    const prefix = node.text.trimStart();
    if (prefix.startsWith('-')) {
      return -value;
    }
    if (prefix.startsWith('+')) {
      return value;
    }
  }

  return undefined;
}
