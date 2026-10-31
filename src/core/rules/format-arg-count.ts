import {
  buildFormatArityEdits,
  specifierForArgument,
} from '../fixes/formatArity';
import {
  conversionRange,
  expectedArgumentCount,
  pairArguments,
  parseCallFormat,
  type ParsedFormat,
} from './format-string';
import { callSites, familyInfo, familyOf } from './library';
import type { Issue, Range, Rule } from './types';
import { makeIssue, rangeFromNode, type SyntaxNode } from './utils';

export const rule: Rule = {
  id: 'format-arg-count',
  channel: 'ghost',
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
      if (!format || !format.supported) {
        continue;
      }

      const valueArguments = site.args.slice(info.formatIndex + 1);
      const expected = expectedArgumentCount(format, info.mode);
      const actual = valueArguments.length;
      if (expected === actual) {
        continue;
      }

      if (expected > actual) {
        const fix = missingArgumentsFix(ctx.text, format, valueArguments, info.mode);
        if (!fix) {
          // Without a single-line edit this rule cannot produce a ghost suggestion.
          continue;
        }
        issues.push(
          makeIssue(
            rule,
            fix,
            `Format expects ${expected} argument(s), but ${actual} provided`,
            `格式符期望 ${expected} 个参数，实际提供 ${actual} 个`,
            { range: fix, newText: '' },
          ),
        );
        continue;
      }

      const extras = valueArguments.slice(expected);
      const first = extras[0];
      if (!first) {
        continue;
      }

      const range = rangeFromNode(first);
      if (extras.length === 1) {
        const specifier = specifierForArgument(first, ctx.table, info.mode);
        if (specifier) {
          const edits = buildFormatArityEdits(
            site.call,
            format.literal,
            first,
            specifier,
          );
          const add = edits.addSpecifier;
          if (add) {
            const updated = formatWithSpecifier(format.literal.text, specifier);
            issues.push(
              makeIssue(
                rule,
                range,
                `Argument has no matching format specifier; use ${updated} or drop the argument`,
                `实参没有匹配的格式符，应改为 ${updated} 或删除该实参`,
                add,
                'ghost',
              ),
            );
            continue;
          }
        }
      }

      const message =
        extras.length === 1
          ? 'Argument has no matching format specifier'
          : `${extras.length} arguments have no matching format specifiers`;
      const messageZh =
        extras.length === 1
          ? '实参没有匹配的格式符'
          : `${extras.length} 个实参没有匹配的格式符`;
      issues.push(makeIssue(rule, range, message, messageZh, undefined, 'hint'));
    }

    return issues;
  },
};

function missingArgumentsFix(
  text: string,
  format: ParsedFormat,
  valueArguments: readonly SyntaxNode[],
  mode: 'printf' | 'scanf',
): Range | undefined {
  const lacking = pairArguments(format, valueArguments, mode).filter(
    (pair) => pair.argument === undefined,
  );
  if (lacking.length === 0) {
    return undefined;
  }

  const first = lacking[0]?.conversion;
  const last = lacking[lacking.length - 1]?.conversion;
  if (!first || !last) {
    return undefined;
  }
  const range = conversionRange(text, format.literal, {
    ...first,
    end: last.end,
  });
  return range.startLine === range.endLine ? range : undefined;
}

function formatWithSpecifier(literalText: string, specifier: string): string {
  const close = literalText.lastIndexOf('"');
  if (close < 0) {
    return literalText;
  }
  return literalText.slice(0, close) + specifier + literalText.slice(close);
}
