import { collectNodes, type SyntaxNode } from './utils';

/**
 * Headers whose declarations this extension models. Anything else may declare macros,
 * constants or globals we cannot see, so rules stay silent for those files.
 */
const KNOWN_HEADERS = new Set([
  'stdio.h',
  'string.h',
  'stddef.h',
  'stdbool.h',
]);

/**
 * True when every `#include` in the file names a header in KNOWN_HEADERS. A file with
 * no includes qualifies. Unquoted, unparsable or unknown includes fail closed.
 */
export function knownHeadersOnly(root: SyntaxNode): boolean {
  for (const include of collectNodes(root, 'preproc_include')) {
    const target = include.namedChildren[0];
    if (!target) {
      return false;
    }

    let path = target.text.trim();
    if (
      (path.startsWith('<') && path.endsWith('>')) ||
      (path.startsWith('"') && path.endsWith('"'))
    ) {
      path = path.slice(1, -1).trim();
    } else {
      return false;
    }

    if (!KNOWN_HEADERS.has(path)) {
      return false;
    }
  }

  return true;
}
