import { inferType } from '../infer';
import {
  pairArguments,
  parseCallFormat,
} from './format-string';
import { callSites, familyInfo, familyOf } from './library';
import type { Rule } from './types';
import { makeIssue, rangeFromNode, unwrapParentheses } from './utils';

export const rule: Rule = {
  id: 'scanf-missing-amp',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const issues = [];

    for (const site of callSites(ctx.root)) {
      const family = familyOf(site.name);
      if (!family) {
        continue;
      }
      const info = familyInfo(family);
      if (info.mode !== 'scanf') {
        continue;
      }

      const format = parseCallFormat(site.call, info.formatIndex, 'scanf');
      if (!format || !format.supported) {
        continue;
      }

      const valueArguments = site.args.slice(info.formatIndex + 1);
      for (const pair of pairArguments(format, valueArguments, 'scanf')) {
        const argument = pair.argument;
        if (!argument) {
          continue;
        }

        const inner = unwrapParentheses(argument);
        if (inner.type !== 'identifier') {
          continue;
        }
        if (
          argument.type === 'pointer_expression' &&
          argument.text.trimStart().startsWith('&')
        ) {
          continue;
        }

        const type = inferType(argument, ctx.table);
        if (type.base === 'unknown' || type.base === 'struct' || type.base === 'void') {
          continue;
        }
        if (type.ptr > 0 || (type.dims?.length ?? 0) > 0) {
          continue;
        }

        const position = argument.startPosition;
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(argument),
            `'${inner.text}' is passed by value to scanf; add '&'`,
            `scanf 按值接收了 '${inner.text}'，需要加 '&'`,
            {
              range: {
                startLine: position.row,
                startChar: position.column,
                endLine: position.row,
                endChar: position.column,
              },
              newText: '&',
            },
          ),
        );
      }
    }

    return issues;
  },
};
