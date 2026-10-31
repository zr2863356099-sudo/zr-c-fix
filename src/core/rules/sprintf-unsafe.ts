import { inferType } from '../infer';
import { callSites } from './library';
import type { Rule } from './types';
import { makeIssue, rangeFromNode, rangeFromOffsets, unwrapParentheses } from './utils';

const SPRINTF = new Set(['sprintf']);

export const rule: Rule = {
  id: 'sprintf-unsafe',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const site of callSites(ctx.root, SPRINTF)) {
      const destination = site.args[0];
      if (!destination) {
        continue;
      }

      const type = inferType(destination, ctx.table);
      if (
        type.base !== 'char' ||
        type.ptr !== 0 ||
        (type.dims?.length ?? 0) === 0
      ) {
        continue;
      }

      const destText = unwrapParentheses(destination).text;
      const start = site.nameNode.startIndex;
      const end = destination.endIndex;
      if (
        site.nameNode.startPosition.row !== destination.endPosition.row
      ) {
        continue;
      }

      const range = rangeFromNode(destination);
      issues.push(
        makeIssue(
          rule,
          range,
          `sprintf into fixed-size array '${destText}'; use snprintf`,
          `向固定大小数组 '${destText}' 使用 sprintf，不安全，应改用 snprintf`,
          {
            range: rangeFromOffsets(ctx.text, start, end),
            newText: `snprintf(${destText}, sizeof ${destText}`,
          },
        ),
      );
    }

    return issues;
  },
};
