import { specifierForArgument } from '../fixes/formatArity';
import {
  expectedArgumentCount,
  parseCallFormat,
  type InvalidFormatSpecifier,
} from './format-string';
import { callSites, familyInfo, familyOf } from './library';
import type { Issue, Rule } from './types';
import { makeIssue, rangeFromOffsets } from './utils';

/**
 * Reports specifiers that stop after their flags/width/length or use a conversion
 * character outside the legal set. A paired argument with a known type yields an
 * in-place suggestion; otherwise the issue is a hint.
 */
export const rule: Rule = {
  id: 'invalid-format-specifier',
  channel: 'hint',
  severity: 'error',

  check(ctx) {
    const issues: Issue[] = [];

    for (const site of callSites(ctx.root)) {
      const family = familyOf(site.name);
      if (!family) {
        continue;
      }
      const info = familyInfo(family);
      const format = parseCallFormat(site.call, info.formatIndex, info.mode);
      if (!format || format.invalid.length === 0) {
        continue;
      }

      const valueArguments = site.args.slice(info.formatIndex + 1);
      // The parser stops at the first invalid specifier, so all valid conversions
      // precede it and the next value argument is the one it pairs with.
      const paired = valueArguments[expectedArgumentCount(format, info.mode)];

      for (const invalid of format.invalid) {
        const range = rangeFromOffsets(
          ctx.text,
          format.literal.startIndex + invalid.start,
          format.literal.startIndex + invalid.end,
        );
        if (range.startLine !== range.endLine) {
          continue;
        }

        const specifier =
          paired && !invalid.raw.includes('*')
            ? specifierForArgument(paired, ctx.table, info.mode)
            : undefined;
        const fix = specifier ? { range, newText: specifier } : undefined;
        issues.push(
          makeIssue(
            rule,
            range,
            messageFor(invalid, specifier),
            messageZhFor(invalid, specifier),
            fix,
            fix ? 'ghost' : 'hint',
          ),
        );
      }
    }

    return issues;
  },
};

function messageFor(
  invalid: InvalidFormatSpecifier,
  specifier: string | undefined,
): string {
  const kind =
    invalid.conversion === '' ? 'Incomplete' : 'Invalid';
  const message = `${kind} format specifier '${invalid.raw}'`;
  return specifier ? `${message}; did you mean '${specifier}'?` : message;
}

function messageZhFor(
  invalid: InvalidFormatSpecifier,
  specifier: string | undefined,
): string {
  const kind =
    invalid.conversion === '' ? '不完整' : '非法';
  const message = `${kind}的格式符 '${invalid.raw}'`;
  return specifier ? `${message}，是否想用 '${specifier}'` : message;
}
