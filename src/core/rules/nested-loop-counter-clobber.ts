import type { Fix, Rule } from './types';
import {
  collectNodes,
  declaredIdentifiers,
  isSingleLine,
  makeIssue,
  nearestAncestor,
  rangeFromNode,
  writeSites,
  type SyntaxNode,
  type WriteSite,
} from './utils';

export const rule: Rule = {
  id: 'nested-loop-counter-clobber',
  channel: 'ghost',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const inner of collectNodes(ctx.root, 'for_statement')) {
      const outer = nearestAncestor(inner, 'for_statement');
      if (!outer) {
        continue;
      }

      const outerNames = new Set(
        declaredIdentifiers(outer.childForFieldName('initializer')).map(
          (identifier) => identifier.text,
        ),
      );
      if (outerNames.size === 0) {
        continue;
      }

      const update = inner.childForFieldName('update');
      const body = inner.childForFieldName('body');
      const updateWrites = update
        ? writeSites(update).filter((site) => outerNames.has(site.name))
        : [];
      const bodyWrites = body
        ? writeSites(body).filter((site) => outerNames.has(site.name))
        : [];

      const site = updateWrites[0] ?? bodyWrites[0];
      if (!site) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(site.node),
          `Inner loop overwrites outer counter '${site.name}'`,
          `内层循环覆盖了外层计数器 '${site.name}'`,
          buildFix(inner, updateWrites, site),
        ),
      );
    }

    return issues;
  },
};

function buildFix(
  inner: SyntaxNode,
  updateWrites: readonly WriteSite[],
  site: WriteSite,
): Fix | undefined {
  if (updateWrites.length !== 1 || !isSingleLine(site.node)) {
    return undefined;
  }

  const innerNames = declaredIdentifiers(inner.childForFieldName('initializer'));
  if (innerNames.length !== 1) {
    return undefined;
  }

  const replacement = innerNames[0];
  if (!replacement || replacement.text === site.name) {
    return undefined;
  }

  return {
    range: rangeFromNode(site.node),
    newText: replacement.text,
  };
}
