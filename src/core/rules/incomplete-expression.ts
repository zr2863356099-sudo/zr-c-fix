import type { Issue, Rule } from './types';
import {
  isSingleLine,
  makeIssue,
  rangeFromNode,
  type SyntaxNode,
} from './utils';

const TRAILING_OPERATOR = /([+\-*/%<>=!&|^])\s*$/;

export interface IncompleteExpressionSite {
  node: SyntaxNode;
  operator: string;
}

export const rule: Rule = {
  id: 'incomplete-expression',
  channel: 'hint',
  severity: 'error',

  check(ctx) {
    return incompleteExpressionSites(ctx.root).map((site) =>
      makeIssue(
        rule,
        rangeFromNode(site.node),
        `Incomplete expression: missing right operand after '${site.operator}'`,
        `不完整的表达式：'${site.operator}' 后缺少右操作数`,
      ),
    );
  },
};

/**
 * Tree-sitter sometimes wraps the truncated expression in an ERROR node and sometimes
 * keeps the binary_expression with a missing right operand, so both shapes are matched.
 */
export function incompleteExpressionSites(
  root: SyntaxNode,
): IncompleteExpressionSite[] {
  const found: IncompleteExpressionSite[] = [];

  const visit = (node: SyntaxNode): void => {
    if (isCandidate(node) && isSingleLine(node)) {
      const operator = trailingOperator(node.text);
      if (operator && followedByCloser(node)) {
        found.push({ node, operator });
        return;
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  };

  visit(root);
  return found;
}

function isCandidate(node: SyntaxNode): boolean {
  if (node.type === 'ERROR') {
    return true;
  }
  if (node.type !== 'binary_expression') {
    return false;
  }
  const last = node.child(node.childCount - 1);
  return last !== null && last.isMissing();
}

function trailingOperator(text: string): string | undefined {
  return TRAILING_OPERATOR.exec(text)?.[1];
}

/** The truncated node must be immediately closed by `)` or `;`. */
function followedByCloser(node: SyntaxNode): boolean {
  const next = node.nextSibling;
  return next !== null && (next.type === ')' || next.type === ';');
}
