import {
  alwaysReturnsValue,
  bareReturns,
  functionDefinitions,
  hasUnsupportedFlow,
} from './flow';
import type { Rule } from './types';
import { makeIssue, rangeFromNode } from './utils';

export const rule: Rule = {
  id: 'nonvoid-missing-return',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const info of functionDefinitions(ctx.root)) {
      if (
        !info.body ||
        info.body.hasError() ||
        info.name === 'main' ||
        info.returnType.base === 'void' ||
        info.returnType.base === 'unknown' ||
        hasUnsupportedFlow(info.body)
      ) {
        continue;
      }

      const bare = bareReturns(info.body)[0];
      if (bare) {
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(bare),
            `Non-void function '${info.name}' returns without a value`,
            `非 void 函数 '${info.name}' 的 return 没有返回值`,
          ),
        );
        continue;
      }

      if (!alwaysReturnsValue(info.body)) {
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(info.nameNode),
            `Non-void function '${info.name}' may reach the end without returning a value`,
            `非 void 函数 '${info.name}' 可能执行到末尾仍没有返回值`,
          ),
        );
      }
    }

    return issues;
  },
};
