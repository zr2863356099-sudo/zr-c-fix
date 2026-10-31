import { inferType } from '../infer';
import type { SymbolTable } from '../symbols';
import type { TypeInfo } from '../types';
import type { Range, Rule, RuleContext } from './types';
import {
  collectNodes,
  isSingleLine,
  makeIssue,
  rangeFromNode,
  unwrapParentheses,
  type SyntaxNode,
} from './utils';

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const EQUALITY_OPERATORS = new Set(['==', '!=']);
const ATOMIC_INDEX_BASES = new Set([
  'identifier',
  'subscript_expression',
  'call_expression',
  'field_expression',
]);

interface ComparisonSite {
  node: SyntaxNode;
  operator: string;
  left: SyntaxNode;
  right: SyntaxNode;
}

/** One repair: compare the first character instead of the strings. */
export interface FirstCharComparisonFix {
  range: Range;
  newText: string;
}

/** One repair: compare the strings with `strcmp`. */
export interface StrcmpComparisonFix {
  range: Range;
  newText: string;
}

export const rule: Rule = {
  id: 'string-eq-literal',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const site of comparisonSites(ctx.text, ctx.root, ctx.table)) {
      const { node, operator, left, right } = site;
      const equality = EQUALITY_OPERATORS.has(operator);
      const message = equality
        ? `${left.text} ${operator} ${right.text}: compares addresses, not contents`
        : `${left.text} ${operator} ${right.text}: compares pointer addresses, not lexicographic order`;
      const messageZh = equality
        ? `'${left.text}' 与 '${right.text}' 比较的是地址而不是字符串内容`
        : `'${left.text}' 与 '${right.text}' 按地址比较，不是按字符串字典序`;

      const fix = isSingleLine(node)
        ? {
            range: rangeFromNode(node),
            newText:
              (equality ? undefined : firstCharRewrite(site, ctx.table)) ??
              strcmpText(site),
          }
        : undefined;

      issues.push(makeIssue(rule, rangeFromNode(node), message, messageZh, fix));
    }

    return issues;
  },
};

/**
 * Repairs for the common intent behind `score > "0"`: compare the first character.
 * Only offered when exactly one side is a one-character string literal and the other
 * side is a character pointer or array, so the rewrite is always well typed.
 */
export function firstCharComparisonFixes(
  ctx: Pick<RuleContext, 'text' | 'root' | 'table'>,
): FirstCharComparisonFix[] {
  const fixes: FirstCharComparisonFix[] = [];

  for (const site of comparisonSites(ctx.text, ctx.root, ctx.table)) {
    const newText = firstCharRewrite(site, ctx.table);
    if (!newText) {
      continue;
    }
    fixes.push({ range: rangeFromNode(site.node), newText });
  }

  return fixes;
}

/**
 * The `strcmp` alternative for relational comparisons with a one-character literal.
 * Equality comparisons and multi-character literals already use `strcmp` as the
 * primary fix, so they are not listed here.
 */
export function strcmpFixFor(
  ctx: Pick<RuleContext, 'text' | 'root' | 'table'>,
): StrcmpComparisonFix[] {
  const fixes: StrcmpComparisonFix[] = [];

  for (const site of comparisonSites(ctx.text, ctx.root, ctx.table)) {
    if (EQUALITY_OPERATORS.has(site.operator)) {
      continue;
    }
    if (!firstCharRewrite(site, ctx.table)) {
      continue;
    }
    fixes.push({
      range: rangeFromNode(site.node),
      newText: strcmpText(site),
    });
  }

  return fixes;
}

function strcmpText(site: ComparisonSite): string {
  return `strcmp(${site.left.text}, ${site.right.text}) ${site.operator} 0`;
}

/** The first-character rewrite for a site, or undefined when it is not well typed. */
function firstCharRewrite(
  site: ComparisonSite,
  table: SymbolTable,
): string | undefined {
  const { operator, left, right } = site;
  const leftLiteral = singleCharLiteral(left);
  const rightLiteral = singleCharLiteral(right);
  if ((leftLiteral === undefined) === (rightLiteral === undefined)) {
    return undefined;
  }

  const literal = leftLiteral ?? rightLiteral;
  const other = leftLiteral ? right : left;
  if (!literal) {
    return undefined;
  }
  if (!isCharPointerLike(inferType(unwrapParentheses(other), table))) {
    return undefined;
  }

  const otherText = firstCharAccess(other);
  if (!otherText) {
    return undefined;
  }

  const leftText = leftLiteral ? literal : otherText;
  const rightText = rightLiteral ? literal : otherText;
  return `${leftText} ${operator} ${rightText}`;
}

function comparisonSites(
  text: string,
  root: SyntaxNode,
  table: SymbolTable,
): ComparisonSite[] {
  const sites: ComparisonSite[] = [];

  for (const node of collectNodes(root, 'binary_expression')) {
    const operator = operatorOf(text, node);
    if (!operator || !COMPARISON_OPERATORS.has(operator)) {
      continue;
    }

    const left = node.childForFieldName('left') ?? node.namedChild(0);
    const right =
      node.childForFieldName('right') ??
      node.namedChild(node.namedChildCount - 1);
    if (!left || !right) {
      continue;
    }

    const leftType = inferType(unwrapParentheses(left), table);
    const rightType = inferType(unwrapParentheses(right), table);
    if (!isCharPointerLike(leftType) || !isCharPointerLike(rightType)) {
      continue;
    }

    sites.push({ node, operator, left, right });
  }

  return sites;
}

function isCharPointerLike(type: TypeInfo): boolean {
  return (
    type.base === 'char' &&
    (type.ptr > 0 || (type.dims?.length ?? 0) > 0)
  );
}

function operatorOf(text: string, node: SyntaxNode): string | undefined {
  const field = node.childForFieldName('operator')?.text;
  if (field) {
    return field;
  }

  const left = node.childForFieldName('left') ?? node.namedChild(0);
  const right =
    node.childForFieldName('right') ??
    node.namedChild(node.namedChildCount - 1);
  if (!left || !right || right.startIndex <= left.endIndex) {
    return undefined;
  }
  return text.slice(left.endIndex, right.startIndex).trim();
}

/** Renders a one-character string literal as a character literal. */
function singleCharLiteral(node: SyntaxNode): string | undefined {
  const literal = unwrapParentheses(node);
  if (literal.type !== 'string_literal') {
    return undefined;
  }

  const text = literal.text;
  if (!text.startsWith('"') || !text.endsWith('"')) {
    return undefined;
  }

  const content = text.slice(1, -1);
  if (decodedLength(content) !== 1) {
    return undefined;
  }
  return charLiteral(content);
}

function charLiteral(content: string): string | undefined {
  let out = '';

  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === undefined) {
      return undefined;
    }

    if (character === '\\') {
      const next = content[index + 1];
      if (next === undefined) {
        return undefined;
      }
      out += character + next;
      index++;
      continue;
    }

    out += character === "'" ? "\\'" : character;
  }

  return `'${out}'`;
}

/** `score` -> `score[0]`; parenthesizes compound operands to keep the precedence. */
function firstCharAccess(node: SyntaxNode): string | undefined {
  const inner = unwrapParentheses(node);
  if (inner.type === 'string_literal' || inner.type === 'concatenated_string') {
    return undefined;
  }
  return ATOMIC_INDEX_BASES.has(inner.type)
    ? `${node.text}[0]`
    : `(${node.text})[0]`;
}

/** Number of characters the literal body encodes; undefined for malformed escapes. */
function decodedLength(content: string): number | undefined {
  let length = 0;
  let index = 0;

  while (index < content.length) {
    const character = content[index];
    if (character !== '\\') {
      length++;
      index++;
      continue;
    }

    const next = content[index + 1];
    if (next === undefined) {
      return undefined;
    }
    length++;

    if (next === 'x' || next === 'X') {
      index += 2;
      let digits = 0;
      while (index < content.length && /[0-9a-fA-F]/.test(content[index] ?? '')) {
        digits++;
        index++;
      }
      if (digits === 0) {
        return undefined;
      }
    } else if (/[0-7]/.test(next)) {
      index++;
      let digits = 0;
      while (
        digits < 3 &&
        index < content.length &&
        /[0-7]/.test(content[index] ?? '')
      ) {
        digits++;
        index++;
      }
    } else if (next === 'u' || next === 'U') {
      const count = next === 'u' ? 4 : 8;
      index += 2;
      for (let remaining = 0; remaining < count; remaining++) {
        if (!/[0-9a-fA-F]/.test(content[index] ?? '')) {
          return undefined;
        }
        index++;
      }
    } else {
      index += 2;
    }
  }

  return length;
}
