import { collectDefines } from './constants';
import { functionDefinitions, isRecursive } from './flow';
import { collectFunctionLocals } from './locals';
import type { Rule } from './types';
import { makeIssue, rangeFromNode, rangeFromOffsets } from './utils';

const DEFAULT_NORMAL_LIMIT_KB = 1024;
const RECURSIVE_LIMIT = 64 * 1024;

export const rule: Rule = {
  id: 'stack-large-local',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];
    const defines = collectDefines(ctx.root);
    const normalLimit =
      Math.max(0, ctx.config.stackLimitKB ?? DEFAULT_NORMAL_LIMIT_KB) * 1024;

    for (const info of functionDefinitions(ctx.root)) {
      if (!info.body || info.body.hasError()) {
        continue;
      }
      const limit = isRecursive(info)
        ? Math.min(RECURSIVE_LIMIT, normalLimit)
        : normalLimit;
      let total = 0;

      for (const local of collectFunctionLocals(info, ctx.table, defines)) {
        if (
          local.isStatic ||
          local.hasOtherStorageClass ||
          local.sizeBytes === undefined
        ) {
          continue;
        }
        const before = total;
        total += local.sizeBytes;
        // Report only the local that pushes the frame over the limit.
        if (total <= limit || before > limit) {
          continue;
        }

        const range = rangeFromNode(local.nameNode);
        const fix =
          local.isStatementLevel && !local.hasOtherStorageClass
            ? {
                range: rangeFromOffsets(
                  ctx.text,
                  local.declaration.startIndex,
                  local.declaration.startIndex,
                ),
                newText: 'static ',
              }
            : undefined;

        issues.push(
          makeIssue(
            rule,
            range,
            `Local variables in '${info.name}' exceed ${formatLimit(limit)}; '${local.name}' is on the stack`,
            `'${info.name}' 的局部变量超出 ${formatLimit(limit)}，'${local.name}' 位于栈上`,
            fix,
            fix ? 'ghost' : 'hint',
          ),
        );
      }
    }

    return issues;
  },
};

function formatLimit(limit: number): string {
  return limit >= 1024 * 1024
    ? `${limit / (1024 * 1024)} MB`
    : `${limit / 1024} KB`;
}
