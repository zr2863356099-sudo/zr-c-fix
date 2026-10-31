import { collectDefines } from './constants';
import { functionDefinitions } from './flow';
import { collectFunctionLocals } from './locals';
import type { Rule } from './types';
import { makeIssue, rangeFromNode } from './utils';

export const rule: Rule = {
  id: 'stack-vla',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];
    const defines = collectDefines(ctx.root);

    for (const info of functionDefinitions(ctx.root)) {
      if (!info.body || info.body.hasError()) {
        continue;
      }
      for (const local of collectFunctionLocals(info, ctx.table, defines)) {
        if (!local.isVla || local.isStatic) {
          continue;
        }
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(local.nameNode),
            `Variable-length array '${local.name}' is allocated on the stack`,
            `变长数组 '${local.name}' 分配在栈上`,
          ),
        );
      }
    }

    return issues;
  },
};
