import { SIGNATURES } from '../signatures';
import { collectNodes, declaratorIdentifier, type SyntaxNode } from './utils';

export interface CallSite {
  call: SyntaxNode;
  nameNode: SyntaxNode;
  name: string;
  args: SyntaxNode[];
}

export type FormatFamily =
  | 'printf'
  | 'fprintf'
  | 'sprintf'
  | 'snprintf'
  | 'scanf'
  | 'fscanf'
  | 'sscanf';

interface FamilyInfo {
  mode: 'printf' | 'scanf';
  formatIndex: number;
}

const FAMILIES: Readonly<Record<FormatFamily, FamilyInfo>> = {
  printf: { mode: 'printf', formatIndex: 0 },
  fprintf: { mode: 'printf', formatIndex: 1 },
  sprintf: { mode: 'printf', formatIndex: 1 },
  snprintf: { mode: 'printf', formatIndex: 2 },
  scanf: { mode: 'scanf', formatIndex: 0 },
  fscanf: { mode: 'scanf', formatIndex: 1 },
  sscanf: { mode: 'scanf', formatIndex: 1 },
};

const SCANF_FAMILY = new Set<FormatFamily>(['scanf', 'fscanf', 'sscanf']);

const HEADER_BY_FUNCTION: Readonly<Record<string, string>> = {
  printf: 'stdio.h',
  fprintf: 'stdio.h',
  sprintf: 'stdio.h',
  snprintf: 'stdio.h',
  scanf: 'stdio.h',
  fscanf: 'stdio.h',
  sscanf: 'stdio.h',
  gets: 'stdio.h',
  fgets: 'stdio.h',
  puts: 'stdio.h',
  fputs: 'stdio.h',
  putchar: 'stdio.h',
  getchar: 'stdio.h',
  strlen: 'string.h',
  strcpy: 'string.h',
  strncpy: 'string.h',
  strcat: 'string.h',
  strncat: 'string.h',
  strcmp: 'string.h',
  strncmp: 'string.h',
  strchr: 'string.h',
  strstr: 'string.h',
  memset: 'string.h',
  memcpy: 'string.h',
};

const SIGNATURE_NAMES = new Set(SIGNATURES.map((signature) => signature.name));

export function familyOf(name: string): FormatFamily | undefined {
  return name in FAMILIES ? (name as FormatFamily) : undefined;
}

export function familyInfo(family: FormatFamily): FamilyInfo {
  return FAMILIES[family];
}

export function isScanfFamily(name: string): boolean {
  const family = familyOf(name);
  return family !== undefined && SCANF_FAMILY.has(family);
}

export function headerForFunction(name: string): string | undefined {
  return HEADER_BY_FUNCTION[name];
}

export function isKnownSignature(name: string): boolean {
  return SIGNATURE_NAMES.has(name);
}

/** All call expressions whose callee is a plain identifier. */
export function callSites(
  root: SyntaxNode,
  names?: ReadonlySet<string>,
): CallSite[] {
  const sites: CallSite[] = [];

  for (const call of collectNodes(root, 'call_expression')) {
    const functionNode =
      call.childForFieldName('function') ?? call.namedChild(0) ?? null;
    if (!functionNode || functionNode.type !== 'identifier') {
      continue;
    }
    if (names && !names.has(functionNode.text)) {
      continue;
    }
    const list =
      call.childForFieldName('arguments') ?? call.namedChild(1) ?? null;
    sites.push({
      call,
      nameNode: functionNode,
      name: functionNode.text,
      args: list ? list.namedChildren : [],
    });
  }

  return sites;
}

/** Includes normalized to a bare header name (`stdio.h`). */
export function includedHeaders(root: SyntaxNode): Set<string> {
  const headers = new Set<string>();

  for (const include of collectNodes(root, 'preproc_include')) {
    const target = include.namedChildren[0];
    if (!target) {
      continue;
    }
    let text = target.text.trim();
    if (text.startsWith('<') && text.endsWith('>')) {
      text = text.slice(1, -1);
    } else if (text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1);
    }
    headers.add(text);
  }

  return headers;
}

/** Function names defined or prototyped in this file (plain declarators only). */
export function fileFunctionNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>();

  for (const definition of collectNodes(root, 'function_definition')) {
    const declarator = definition.childForFieldName('declarator');
    const name = directFunctionName(declarator);
    if (name) {
      names.add(name.text);
    }
  }

  for (const declaration of collectNodes(root, 'declaration')) {
    for (const child of declaration.namedChildren) {
      const name = directFunctionName(child);
      if (name) {
        names.add(name.text);
      }
    }
  }

  return names;
}

/**
 * Names bound to function-pointer variables (`int (*fp)(int);`). They are not plain
 * calls but must stop `implicit-declaration` from renaming them.
 */
export function functionPointerNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>();

  for (const declaration of collectNodes(root, 'declaration')) {
    for (const child of declaration.namedChildren) {
      collectFunctionPointerNames(child, names);
    }
  }

  return names;
}

function collectFunctionPointerNames(
  node: SyntaxNode,
  names: Set<string>,
): void {
  if (node.type === 'function_declarator') {
    const inner = node.childForFieldName('declarator');
    if (inner && inner.type !== 'identifier') {
      const identifier = declaratorIdentifier(inner);
      if (identifier) {
        names.add(identifier.text);
      }
    }
    return;
  }
  for (const child of node.namedChildren) {
    collectFunctionPointerNames(child, names);
  }
}

function directFunctionName(declarator: SyntaxNode | null): SyntaxNode | undefined {
  let current = declarator;
  while (current) {
    if (current.type === 'function_declarator') {
      const inner = current.childForFieldName('declarator');
      return inner?.type === 'identifier' ? inner : undefined;
    }
    if (
      current.type === 'pointer_declarator' ||
      current.type === 'parenthesized_declarator' ||
      current.type === 'attributed_declarator'
    ) {
      current = current.childForFieldName('declarator');
      continue;
    }
    return undefined;
  }
  return undefined;
}
