import {
  callSites,
  fileFunctionNames,
  headerForFunction,
  includedHeaders,
} from './library';
import type { Rule } from './types';
import { makeIssue, rangeFromNode } from './utils';

export const rule: Rule = {
  id: 'missing-include',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const headers = includedHeaders(ctx.root);
    const localFunctions = fileFunctionNames(ctx.root);
    const missing = new Map<string, { name: string; call: import('./utils').SyntaxNode }>();
    const issues = [];

    for (const site of callSites(ctx.root)) {
      const header = headerForFunction(site.name);
      if (!header || headers.has(header) || localFunctions.has(site.name)) {
        continue;
      }
      if (!missing.has(header)) {
        missing.set(header, { name: site.name, call: site.nameNode });
      }
    }

    for (const [header, use] of missing) {
      issues.push(
        makeIssue(
          rule,
          rangeFromNode(use.call),
          `Missing #include <${header}> for '${use.name}'`,
          `'${use.name}' 缺少 #include <${header}>`,
        ),
      );
    }

    return issues;
  },
};
