import { inferType } from '../infer';
import { SIGNATURES } from '../signatures';
import type { SymbolTable } from '../symbols';
import { callSites, fileFunctionNames, type CallSite } from './library';
import type { Fix, Issue, Rule } from './types';
import {
  makeIssue,
  rangeFromNode,
  unwrapParentheses,
} from './utils';

const SIGNATURES_BY_NAME = new Map(
  SIGNATURES.map((signature) => [signature.name, signature] as const),
);

export const rule: Rule = {
  id: 'call-arg-count',
  channel: 'hint',
  severity: 'error',

  check(ctx) {
    const issues: Issue[] = [];
    const defined = fileFunctionNames(ctx.root);

    for (const site of callSites(ctx.root)) {
      const signature = SIGNATURES_BY_NAME.get(site.name);
      if (!signature || defined.has(site.name)) {
        continue;
      }

      const actual = site.args.length;
      if (actual < signature.minArgs) {
        const fix = fgetsFix(ctx.table, site);
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(site.call),
            englishMessage(site.name, signature.minArgs, actual),
            `'${site.name}' 需要 ${signature.minArgs} 个参数，当前只有 ${actual} 个`,
            fix,
            fix ? 'ghost' : 'hint',
          ),
        );
        continue;
      }

      if (!signature.variadic && actual > signature.params.length) {
        issues.push(
          makeIssue(
            rule,
            rangeFromNode(site.call),
            englishMessage(site.name, signature.params.length, actual),
            `'${site.name}' 最多接受 ${signature.params.length} 个参数，当前有 ${actual} 个`,
          ),
        );
      }
    }

    return issues;
  },
};

function englishMessage(name: string, expected: number, actual: number): string {
  const noun = expected === 1 ? 'argument' : 'arguments';
  return `'${name}' expects ${expected} ${noun}, got ${actual}`;
}

/**
 * `fgets(a)` on a char array has one obvious completion. Everything else depends on
 * context, so this is the only automatic fix this rule offers.
 */
function fgetsFix(
  table: SymbolTable,
  site: CallSite,
): Fix | undefined {
  if (site.name !== 'fgets' || site.args.length !== 1) {
    return undefined;
  }

  const argument = site.args[0];
  if (!argument) {
    return undefined;
  }
  const inner = unwrapParentheses(argument);
  if (inner.type !== 'identifier') {
    return undefined;
  }

  const type = inferType(argument, table);
  if (
    type.base !== 'char' ||
    type.ptr !== 0 ||
    (type.dims?.length ?? 0) === 0
  ) {
    return undefined;
  }

  const list =
    site.call.childForFieldName('arguments') ?? site.call.namedChild(1) ?? null;
  if (!list) {
    return undefined;
  }
  const open = list.startPosition;
  const close = list.endPosition;
  if (open.row !== close.row || close.column < 1) {
    return undefined;
  }

  const position = close.column - 1;
  const range = {
    startLine: close.row,
    startChar: position,
    endLine: close.row,
    endChar: position,
  };
  return { range, newText: `, sizeof ${inner.text}, stdin` };
}
