import type { Rule } from './types';
import {
  collectNodes,
  isSingleLine,
  makeIssue,
  rangeFromNode,
  unwrapParentheses,
} from './utils';

export const rule: Rule = {
  id: 'assignment-in-condition',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const statement of collectNodes(ctx.root, [
      'if_statement',
      'while_statement',
    ])) {
      const condition = statement.childForFieldName('condition');
      if (!condition) {
        continue;
      }

      const expression = unwrapParentheses(condition);
      if (expression.type !== 'assignment_expression') {
        continue;
      }

      const operator = expression.children.find((child) => !child.isNamed());
      // Compound assignments (`+=`) cannot be repaired by doubling `=`.
      if (!operator || operator.text !== '=' || !isSingleLine(operator)) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(expression),
          "Assignment in condition; use '==' to compare",
          "条件中使用了赋值，应改为 '==' 比较",
          {
            range: rangeFromNode(operator),
            newText: '==',
          },
        ),
      );
    }

    return issues;
  },
};
