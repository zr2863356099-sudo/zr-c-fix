import { damerauLevenshtein } from './edit-distance';
import type { Rule } from './types';
import {
  collectNodes,
  isSingleLine,
  makeIssue,
  rangeFromNode,
  type SyntaxNode,
} from './utils';

const BUILTIN_TYPES: readonly string[] = [
  'int',
  'char',
  'float',
  'double',
  'long',
  'short',
  'unsigned',
  'signed',
  'void',
  '_Bool',
  'bool',
  'size_t',
  'ssize_t',
  'ptrdiff_t',
  'int8_t',
  'int16_t',
  'int32_t',
  'int64_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'uint64_t',
  'FILE',
  'time_t',
];

const BUILTIN = new Set<string>(BUILTIN_TYPES);
const MAX_DISTANCE = 2;

export const rule: Rule = {
  id: 'unknown-type',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const typedefs = typedefNames(ctx.root);
    const issues = [];

    for (const declaration of collectNodes(ctx.root, 'declaration')) {
      // Only the type position matters: skip when it is absent or consumed by ERROR.
      // Errors elsewhere (e.g. `unsiged int x;` puts `x` in ERROR) leave the type intact.
      const typeNode = declaration.childForFieldName('type');
      if (!typeNode || typeNode.type === 'ERROR') {
        continue;
      }

      const typeName = declaredTypeName(typeNode);
      if (!typeName) {
        continue;
      }

      const name = typeName.text;
      if (BUILTIN.has(name) || typedefs.has(name)) {
        continue;
      }

      const suggestion = nearestBuiltin(name);
      if (!suggestion || !isSingleLine(typeName)) {
        continue;
      }

      const range = rangeFromNode(typeName);
      issues.push(
        makeIssue(
          rule,
          range,
          `Unknown type '${name}'; did you mean '${suggestion}'?`,
          `未知类型 '${name}'，是否想用 '${suggestion}'`,
          { range, newText: suggestion },
        ),
      );
    }

    return issues;
  },
};

/** Type name a declaration spells out directly, ignoring struct/union/enum tags. */
function declaredTypeName(type: SyntaxNode): SyntaxNode | undefined {
  if (type.type === 'type_identifier') {
    return type;
  }
  if (type.type === 'sized_type_specifier') {
    // `nsigned long long` parses as sized_type_specifier(type_identifier, long, long).
    const inner =
      type.childForFieldName('type') ??
      type.namedChildren.find((child) => child.type === 'type_identifier');
    return inner?.type === 'type_identifier' ? inner : undefined;
  }
  return undefined;
}

function typedefNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>();

  for (const definition of collectNodes(root, 'type_definition')) {
    const declarator = definition.childForFieldName('declarator');
    if (declarator?.type === 'type_identifier') {
      names.add(declarator.text);
    }
  }

  return names;
}

/**
 * Closest builtin type within MAX_DISTANCE edits, or undefined when fail-closed.
 * Ties (e.g. `nsigned` is one edit from both `signed` and `unsigned`) resolve to the
 * longer candidate: the typo dropped a character from the longer name. The canonical
 * list order breaks any remaining tie.
 */
function nearestBuiltin(name: string): string | undefined {
  let bestDistance = MAX_DISTANCE + 1;
  let candidates: string[] = [];

  for (const candidate of BUILTIN_TYPES) {
    const distance = damerauLevenshtein(name, candidate);
    if (distance > MAX_DISTANCE) {
      continue;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      candidates = [candidate];
    } else if (distance === bestDistance) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  return [...candidates].sort((left, right) => {
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    return BUILTIN_TYPES.indexOf(left) - BUILTIN_TYPES.indexOf(right);
  })[0];
}
