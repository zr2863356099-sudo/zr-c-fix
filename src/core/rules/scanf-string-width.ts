import { inferType } from '../infer';
import type { SymbolTable } from '../symbols';
import { parseCallFormat, pairArguments, conversionRange } from './format-string';
import { callSites, familyInfo, familyOf } from './library';
import type { Rule } from './types';
import { makeIssue, type SyntaxNode } from './utils';

/** Buffers larger than this are left alone; the user may know what they are doing. */
const MAX_BUFFER = 256;

export const rule: Rule = {
  id: 'scanf-string-width',
  channel: 'ghost',
  severity: 'warning',

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
        const { conversion, argument } = pair;
        if (
          !argument ||
          conversion.conversion !== 's' ||
          conversion.length !== '' ||
          conversion.width !== undefined
        ) {
          continue;
        }

        const size = knownArraySize(argument, ctx.table);
        if (size === undefined || size < 2 || size > MAX_BUFFER) {
          continue;
        }

        const range = conversionRange(ctx.text, format.literal, conversion);
        if (range.startLine !== range.endLine) {
          continue;
        }
        const newText = `${conversion.prefix}${size - 1}s`;
        issues.push(
          makeIssue(
            rule,
            range,
            `'%s' has no width for a ${size}-byte buffer; use '${newText}'`,
            `'%s' 没有指定宽度，缓冲区为 ${size} 字节，应改为 '${newText}'`,
            { range, newText },
          ),
        );
      }
    }

    return issues;
  },
};

function knownArraySize(
  argument: SyntaxNode,
  table: SymbolTable,
): number | undefined {
  const type = inferType(argument, table);
  if (type.base !== 'char' || type.ptr !== 0) {
    return undefined;
  }
  if ((type.dims?.length ?? 0) === 0) {
    return undefined;
  }
  return type.dims?.[0];
}
