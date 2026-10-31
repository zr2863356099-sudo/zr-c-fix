import { inferType } from '../infer';
import type { TypeInfo } from '../types';
import {
  collectNodes,
  declaratorIdentifier,
  makeIssue,
  rangeFromNode,
  unwrapParentheses,
  type SyntaxNode,
} from './utils';
import type { Range, Rule, RuleContext } from './types';

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const FLIPPED_OPERATORS: Readonly<Record<string, string>> = {
  '==': '==',
  '!=': '!=',
  '<': '>',
  '>': '<',
  '<=': '>=',
  '>=': '<=',
};
const INTEGER_CONSTANT =
  /^(?:0[xX][0-9a-fA-F]+|[0-9]+)(?:[uUlL]|[uU][lL]|[lL][uU])?$/;

interface ComparisonSite {
  node: SyntaxNode;
  operator: string;
  literal: SyntaxNode;
  charSide: SyntaxNode;
  literalOnLeft: boolean;
}

/** Repair for `s[0] == "NP"`: compare the whole string with `strcmp`. */
export interface StrcmpComparisonFix {
  /** String literal range; matches the range the issue is anchored on. */
  issueRange: Range;
  /** Whole comparison to replace. */
  range: Range;
  newText: string;
}

export const rule: Rule = {
  id: 'char-string-literal',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const issues = [];

    for (const node of collectNodes(ctx.root, 'assignment_expression')) {
      if (operatorBetween(ctx.text, node) !== '=') {
        continue;
      }
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (!left || !right) {
        continue;
      }
      const literal = unwrapParentheses(right);
      const content = stringContent(literal);
      if (content === undefined || decodedLength(content) !== 1) {
        continue;
      }
      if (!isCharScalar(inferType(left, ctx.table))) {
        continue;
      }
      issues.push(buildIssue(literal, content));
    }

    for (const node of collectNodes(ctx.root, 'init_declarator')) {
      const value = node.childForFieldName('value');
      if (!value) {
        continue;
      }
      const literal = unwrapParentheses(value);
      const content = stringContent(literal);
      if (content === undefined || decodedLength(content) !== 1) {
        continue;
      }
      const name = declaratorIdentifier(node.childForFieldName('declarator'));
      if (!name) {
        continue;
      }
      const symbol = ctx.table.symbols.find(
        (entry) => entry.declNodeId === name.id,
      );
      if (!symbol || !isCharScalar(symbol.type)) {
        continue;
      }
      issues.push(buildIssue(literal, content));
    }

    for (const site of comparisonSites(ctx.text, ctx.root, ctx.table)) {
      const content = stringContent(site.literal);
      if (content === undefined) {
        continue;
      }
      const length = decodedLength(content);
      if (length === undefined || length === 0) {
        continue;
      }
      if (length === 1) {
        issues.push(buildComparisonIssue(site.literal, content));
      } else {
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(site.literal),
            'String literal compared with char (type mismatch)',
            '字符与字符串指针比较（类型不匹配）',
            undefined,
            'hint',
          ),
        );
      }
    }

    return issues;
  },
};

/**
 * `s[0] == "NP"` can mean "compare the whole string". Only offer that rewrite when the
 * other side is `array[constant]`, so `array` is a safe replacement for the element.
 */
export function strcmpComparisonFixes(
  ctx: Pick<RuleContext, 'text' | 'root' | 'table'>,
): StrcmpComparisonFix[] {
  const fixes: StrcmpComparisonFix[] = [];

  for (const site of comparisonSites(ctx.text, ctx.root, ctx.table)) {
    const content = stringContent(site.literal);
    if (content === undefined) {
      continue;
    }
    const length = decodedLength(content);
    if (length === undefined || length <= 1) {
      continue;
    }

    const charSide = site.charSide;
    const array = constantIndexedArray(charSide, ctx.table);
    if (!array) {
      continue;
    }

    const operator = site.literalOnLeft
      ? (FLIPPED_OPERATORS[site.operator] ?? site.operator)
      : site.operator;
    fixes.push({
      issueRange: rangeFromNode(site.literal),
      range: rangeFromNode(site.node),
      newText: `strcmp(${array}, ${site.literal.text}) ${operator} 0`,
    });
  }

  return fixes;
}

function comparisonSites(
  text: string,
  root: SyntaxNode,
  table: RuleContext['table'],
): ComparisonSite[] {
  const sites: ComparisonSite[] = [];

  for (const node of collectNodes(root, 'binary_expression')) {
    const operator = operatorBetween(text, node);
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

    const leftLiteral = stringLiteralNode(left);
    const rightLiteral = stringLiteralNode(right);
    if ((leftLiteral === undefined) === (rightLiteral === undefined)) {
      continue;
    }

    const literal = leftLiteral ?? rightLiteral;
    const charSide = leftLiteral ? right : left;
    if (!literal) {
      continue;
    }
    if (!isCharScalar(inferType(unwrapParentheses(charSide), table))) {
      continue;
    }

    sites.push({
      node,
      operator,
      literal,
      charSide,
      literalOnLeft: leftLiteral !== undefined,
    });
  }

  return sites;
}

/** `score[0]` -> `score`, only for an identifier base and an integer constant index. */
function constantIndexedArray(
  node: SyntaxNode | null,
  table: RuleContext['table'],
): string | undefined {
  if (!node) {
    return undefined;
  }
  const element = unwrapParentheses(node);
  if (element.type !== 'subscript_expression') {
    return undefined;
  }

  const baseNode =
    element.childForFieldName('argument') ?? element.namedChild(0);
  const indexNode = element.childForFieldName('index') ?? element.namedChild(1);
  if (!baseNode || !indexNode) {
    return undefined;
  }
  const base = unwrapParentheses(baseNode);
  if (base.type !== 'identifier') {
    return undefined;
  }
  if (!isIntegerConstant(unwrapParentheses(indexNode))) {
    return undefined;
  }

  const type = inferType(base, table);
  if (
    type.base !== 'char' ||
    (type.ptr === 0 && (type.dims?.length ?? 0) === 0)
  ) {
    return undefined;
  }
  return base.text;
}

function isIntegerConstant(node: SyntaxNode): boolean {
  return node.type === 'number_literal' && INTEGER_CONSTANT.test(node.text);
}

function stringLiteralNode(node: SyntaxNode): SyntaxNode | undefined {
  const literal = unwrapParentheses(node);
  return literal.type === 'string_literal' ? literal : undefined;
}

function buildIssue(literal: SyntaxNode, content: string) {
  const replacement = charLiteralText(content);
  return makeIssue(
    rule,
    rangeFromNode(literal),
    `String literal assigned to char; use ${replacement}`,
    `字符串字面量赋给了 char，应改为 ${replacement}`,
    { range: rangeFromNode(literal), newText: replacement },
  );
}

function buildComparisonIssue(literal: SyntaxNode, content: string) {
  const replacement = charLiteralText(content);
  return makeIssue(
    rule,
    rangeFromNode(literal),
    `String literal compared with char; use ${replacement}`,
    `字符与字符串指针比较（类型不匹配），应为 ${replacement}`,
    { range: rangeFromNode(literal), newText: replacement },
  );
}

function charLiteralText(content: string): string {
  return `'${content === "'" ? "\\'" : content}'`;
}

function isCharScalar(type: TypeInfo): boolean {
  return (
    type.base === 'char' &&
    type.ptr === 0 &&
    (type.dims?.length ?? 0) === 0
  );
}

function stringContent(node: SyntaxNode): string | undefined {
  if (node.type !== 'string_literal') {
    return undefined;
  }
  const text = node.text;
  if (!text.startsWith('"') || !text.endsWith('"')) {
    return undefined;
  }
  return text.slice(1, -1);
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
      while (
        index < content.length &&
        /[0-9a-fA-F]/.test(content[index] ?? '')
      ) {
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
