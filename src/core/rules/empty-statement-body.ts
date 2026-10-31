import type { Rule } from './types';
import {
  collectNodes,
  isSingleLine,
  makeIssue,
  rangeFromNode,
  type SyntaxNode,
} from './utils';

export const rule: Rule = {
  id: 'empty-statement-body',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const statement of collectNodes(ctx.root, [
      'if_statement',
      'while_statement',
      'for_statement',
    ])) {
      const bodies: Array<SyntaxNode | null> =
        statement.type === 'if_statement'
          ? [statement.childForFieldName('consequence')]
          : [statement.childForFieldName('body')];

      for (const body of bodies) {
        if (
          !body ||
          body.type !== 'expression_statement' ||
          body.namedChildren.length > 0
        ) {
          continue;
        }

        if (statement.type === 'while_statement' && hasSideEffectCondition(statement)) {
          continue;
        }
        if (!isSingleLine(body)) {
          continue;
        }

        const range = rangeFromNode(body);
        issues.push(
          makeIssue(rule, range, "Empty statement body; remove ';'", "语句体为空，删除 ';'", {
            range,
            newText: '',
          }),
        );
      }
    }

    return issues;
  },
};

function hasSideEffectCondition(statement: SyntaxNode): boolean {
  const condition = statement.childForFieldName('condition');
  if (!condition) {
    return false;
  }
  return (
    collectNodes(condition, 'assignment_expression').length > 0 ||
    collectNodes(condition, 'call_expression').length > 0
  );
}
