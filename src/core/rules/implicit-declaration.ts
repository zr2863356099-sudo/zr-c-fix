import { SIGNATURES } from '../signatures';
import { collectDefines } from './constants';
import { damerauLevenshtein } from './edit-distance';
import { knownHeadersOnly } from './headers';
import {
  callSites,
  fileFunctionNames,
  functionPointerNames,
  isKnownSignature,
} from './library';
import type { Rule } from './types';
import { makeIssue, rangeFromNode } from './utils';

const MAX_DISTANCE = 2;

export const rule: Rule = {
  id: 'implicit-declaration',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    // An unknown header may declare functions we do not know about.
    if (!knownHeadersOnly(ctx.root)) {
      return [];
    }

    const issues = [];
    const localFunctions = fileFunctionNames(ctx.root);
    const functionPointers = functionPointerNames(ctx.root);
    const macros = collectDefines(ctx.root).names;
    const signatureNames = SIGNATURES.map((signature) => signature.name);

    for (const site of callSites(ctx.root)) {
      const name = site.name;
      if (
        isKnownSignature(name) ||
        localFunctions.has(name) ||
        functionPointers.has(name) ||
        macros.has(name) ||
        ctx.table.resolve(name, site.call)
      ) {
        continue;
      }

      const candidates = signatureNames.filter(
        (candidate) =>
          candidate !== name &&
          damerauLevenshtein(name, candidate) <= MAX_DISTANCE,
      );
      const suggestion =
        candidates.length === 1 ? candidates[0] : undefined;
      // We only vouch for signatures we know; an unfamiliar name is not an error.
      if (!suggestion) {
        continue;
      }

      issues.push(
        makeIssue(
          rule,
          rangeFromNode(site.nameNode),
          `'${name}' is not declared; did you mean '${suggestion}'?`,
          `未声明的标识符 '${name}'，是否想用 '${suggestion}'`,
          {
            range: rangeFromNode(site.nameNode),
            newText: suggestion,
          },
          'ghost',
        ),
      );
    }

    return issues;
  },
};
