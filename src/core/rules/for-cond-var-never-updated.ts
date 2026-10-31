import type { Rule } from './types';
import {
  collectNodes,
  declaredIdentifiers,
  makeIssue,
  rangeFromNode,
  writeSites,
  type SyntaxNode,
} from './utils';

export const rule: Rule = {
  id: 'for-cond-var-never-updated',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues = [];

    for (const loop of collectNodes(ctx.root, 'for_statement')) {
      const condition = loop.childForFieldName('condition');
      if (!condition) {
        continue;
      }

      // Only identifiers that the loop itself initializes count as control variables;
      // otherwise `i < n` or `i < strlen(s)` would point at n/strlen.
      const initialized = initializerNames(loop.childForFieldName('initializer'));
      if (initialized.size === 0) {
        continue;
      }
      const controlVariables = collectNodes(condition, 'identifier').filter(
        (identifier) => initialized.has(identifier.text),
      );
      if (controlVariables.length === 0) {
        continue;
      }

      const body = loop.childForFieldName('body');
      if (body && exitsLoop(body)) {
        continue;
      }

      const written = new Set<string>();
      const update = loop.childForFieldName('update');
      if (update) {
        for (const site of writeSites(update)) {
          written.add(site.name);
        }
      }
      if (body) {
        for (const site of writeSites(body)) {
          written.add(site.name);
        }
      }

      const neverUpdated = controlVariables.find(
        (identifier) => !written.has(identifier.text),
      );
      if (!neverUpdated) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(neverUpdated),
          `Loop condition variable '${neverUpdated.text}' is never updated; possible infinite loop`,
          `循环条件变量 '${neverUpdated.text}' 从未更新，可能导致死循环`,
        ),
      );
    }

    return issues;
  },
};

function initializerNames(initializer: SyntaxNode | null): Set<string> {
  if (!initializer) {
    return new Set();
  }
  if (initializer.type === 'declaration') {
    return new Set(
      declaredIdentifiers(initializer).map((identifier) => identifier.text),
    );
  }
  return new Set(writeSites(initializer).map((site) => site.name));
}

function exitsLoop(body: SyntaxNode): boolean {
  return (
    collectNodes(body, 'break_statement').length > 0 ||
    collectNodes(body, 'return_statement').length > 0
  );
}
