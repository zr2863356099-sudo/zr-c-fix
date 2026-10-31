import type Parser from 'web-tree-sitter';
import {
  copyType,
  unknownType,
  withDims,
  type BaseType,
  type TypeInfo,
} from './types';

export type SyntaxNode = Parser.SyntaxNode;

export interface Symbol {
  name: string;
  type: TypeInfo;
  scope: 'file' | 'function' | 'block';
  /** Zero-based line of the declarator identifier, matching VS Code lines. */
  declLine: number;
  isParam: boolean;
  /** tree-sitter node id of the declarator identifier; identifies nested declarations. */
  declNodeId: number;
}

export interface SymbolTable {
  readonly symbols: readonly Symbol[];
  /** Latest declaration of `name` in source order. */
  lookup(name: string): Symbol | undefined;
  /** Innermost declaration of `name` visible at `at`; latest one when no node is given. */
  resolve(name: string, at?: SyntaxNode): Symbol | undefined;
}

interface Entry {
  symbol: Symbol;
  order: number;
  scopeStart: number;
  scopeEnd: number;
}

interface ScopeFrame {
  kind: Symbol['scope'];
  start: number;
  end: number;
}

const DECLARATOR_TYPES = new Set([
  'identifier',
  'init_declarator',
  'pointer_declarator',
  'array_declarator',
  'function_declarator',
  'parenthesized_declarator',
  'attributed_declarator',
]);

const TYPE_NODE_TYPES = new Set([
  'primitive_type',
  'sized_type_specifier',
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'type_identifier',
]);

/**
 * Builds a fresh symbol table from a parse tree. Callers rebuild this on every document
 * change: nothing is merged, so a removed or retyped declaration cannot survive.
 */
export function buildSymbolTable(rootNode: SyntaxNode, _text: string): SymbolTable {
  const entries: Entry[] = [];
  const byName = new Map<string, Entry[]>();

  const fileFrame: ScopeFrame = {
    kind: 'file',
    start: rootNode.startIndex,
    end: rootNode.endIndex,
  };

  function addSymbol(
    nameNode: SyntaxNode,
    type: TypeInfo,
    frame: ScopeFrame,
    isParam: boolean,
  ): void {
    const symbol: Symbol = {
      name: nameNode.text,
      type,
      scope: frame.kind,
      declLine: nameNode.startPosition.row,
      isParam,
      declNodeId: nameNode.id,
    };
    const entry: Entry = {
      symbol,
      order: nameNode.startIndex,
      scopeStart: frame.start,
      scopeEnd: frame.end,
    };
    entries.push(entry);

    const sameName = byName.get(symbol.name);
    if (sameName) {
      sameName.push(entry);
    } else {
      byName.set(symbol.name, [entry]);
    }
  }

  function walk(node: SyntaxNode, frame: ScopeFrame, functionBody: boolean): void {
    switch (node.type) {
      case 'function_definition': {
        const functionFrame: ScopeFrame = {
          kind: 'function',
          start: node.startIndex,
          end: node.endIndex,
        };
        const declarator = node.childForFieldName('declarator');
        const functionDeclarator = findFunctionDeclarator(declarator);
        if (functionDeclarator) {
          collectParameters(functionDeclarator, functionFrame);
        }

        const body = node.childForFieldName('body');
        if (body) {
          walk(body, functionFrame, true);
        }
        return;
      }

      case 'compound_statement': {
        const nextFrame = functionBody
          ? frame
          : { kind: 'block' as const, start: node.startIndex, end: node.endIndex };
        for (const child of node.namedChildren) {
          walk(child, nextFrame, false);
        }
        return;
      }

      case 'for_statement': {
        const loopFrame: ScopeFrame = {
          kind: 'block',
          start: node.startIndex,
          end: node.endIndex,
        };
        for (const child of node.namedChildren) {
          walk(child, loopFrame, false);
        }
        return;
      }

      case 'declaration': {
        collectDeclaration(node, frame);
        return;
      }

      // Struct/union/enum members are not variables in the enclosing scope.
      case 'field_declaration':
      case 'struct_specifier':
      case 'union_specifier':
      case 'enum_specifier':
      case 'type_definition':
        return;

      default:
        for (const child of node.namedChildren) {
          walk(child, frame, false);
        }
    }
  }

  function collectDeclaration(node: SyntaxNode, frame: ScopeFrame): void {
    const typeNode =
      node.childForFieldName('type') ??
      node.namedChildren.find((child) => TYPE_NODE_TYPES.has(child.type)) ??
      null;
    const isConst = hasConstQualifier(node);
    let base = typeFromSpecifierNode(typeNode);
    if (node.hasError()) {
      base = unknownType();
    }
    base = applyConst(base, isConst);

    for (const child of node.namedChildren) {
      if (!DECLARATOR_TYPES.has(child.type)) {
        continue;
      }

      const parsed = parseDeclarator(child, base, false);
      if (!parsed || parsed.sawFunction) {
        continue;
      }
      addSymbol(parsed.nameNode, parsed.type, frame, false);
    }
  }

  function collectParameters(
    functionDeclarator: SyntaxNode,
    frame: ScopeFrame,
  ): void {
    const parameters = functionDeclarator.childForFieldName('parameters');
    if (!parameters) {
      return;
    }

    for (const parameter of parameters.namedChildren) {
      if (parameter.type !== 'parameter_declaration') {
        continue;
      }

      const declarator = parameter.childForFieldName('declarator');
      if (!declarator) {
        continue;
      }

      const typeNode =
        parameter.childForFieldName('type') ??
        parameter.namedChildren.find((child) => TYPE_NODE_TYPES.has(child.type)) ??
        null;
      let base = typeFromSpecifierNode(typeNode);
      if (parameter.hasError()) {
        base = unknownType();
      }
      base = applyConst(base, hasConstQualifier(parameter));

      const parsed = parseDeclarator(declarator, base, true);
      if (!parsed || parsed.sawFunction) {
        continue;
      }
      addSymbol(parsed.nameNode, parsed.type, frame, true);
    }
  }

  walk(rootNode, fileFrame, false);

  function latest(name: string): Entry | undefined {
    const candidates = byName.get(name);
    if (!candidates || candidates.length === 0) {
      return undefined;
    }

    let best = candidates[0];
    for (const candidate of candidates) {
      if (candidate && (!best || candidate.order >= best.order)) {
        best = candidate;
      }
    }
    return best;
  }

  return {
    symbols: entries.map((entry) => entry.symbol),

    lookup(name: string): Symbol | undefined {
      return latest(name)?.symbol;
    },

    resolve(name: string, at?: SyntaxNode): Symbol | undefined {
      if (!at) {
        return latest(name)?.symbol;
      }

      const candidates = byName.get(name);
      if (!candidates) {
        return undefined;
      }

      let best: Entry | undefined;
      for (const candidate of candidates) {
        if (candidate.order >= at.startIndex) {
          continue;
        }
        if (at.startIndex < candidate.scopeStart || at.endIndex > candidate.scopeEnd) {
          continue;
        }
        if (!best || isBetterScope(candidate, best)) {
          best = candidate;
        }
      }
      return best?.symbol;
    },
  };
}

/** Parses a type specifier node (`primitive_type`, `struct_specifier`, ...) into TypeInfo. */
export function typeFromSpecifierNode(node: SyntaxNode | null): TypeInfo {
  if (!node || node.type === 'ERROR') {
    return unknownType();
  }

  switch (node.type) {
    case 'primitive_type':
    case 'sized_type_specifier':
      return { base: baseFromWords(node.text), ptr: 0 };

    case 'struct_specifier':
    case 'union_specifier':
      return { base: 'struct', ptr: 0 };

    case 'enum_specifier':
    case 'type_identifier':
    default:
      // Typedef names are not resolved in single-file mode; fail closed.
      return unknownType();
  }
}

function baseFromWords(text: string): BaseType {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 1) {
    switch (words[0]) {
      case 'int':
        return 'int';
      case 'char':
        return 'char';
      case 'float':
        return 'float';
      case 'double':
        return 'double';
      case 'short':
        return 'short';
      case 'long':
        return 'long';
      case 'void':
        return 'void';
      case 'unsigned':
        return 'unsigned';
      case 'signed':
        return 'signed';
      case 'size_t':
        return 'ulong';
      default:
        return 'unknown';
    }
  }

  if (words.includes('double')) {
    // `long double` has no dedicated BaseType; keep the floating behavior.
    return 'double';
  }
  if (words.includes('float')) {
    return 'float';
  }
  if (words.includes('char')) {
    // Unsigned/signed char collapse into char; no narrower scalar exists.
    return 'char';
  }
  if (words.includes('void')) {
    return 'void';
  }

  const longs = words.filter((word) => word === 'long').length;
  const isUnsigned = words.includes('unsigned');
  const isSigned = words.includes('signed');

  if (longs >= 2) {
    return isUnsigned ? 'ulonglong' : 'longlong';
  }
  if (longs === 1) {
    return isUnsigned ? 'ulong' : 'long';
  }
  if (words.includes('short')) {
    return 'short';
  }
  if (isUnsigned) {
    return 'unsigned';
  }
  if (isSigned) {
    return 'signed';
  }
  if (words.includes('int')) {
    return 'int';
  }
  return 'unknown';
}

interface ParsedDeclarator {
  nameNode: SyntaxNode;
  type: TypeInfo;
  sawFunction: boolean;
}

function parseDeclarator(
  declarator: SyntaxNode,
  base: TypeInfo,
  isParam: boolean,
): ParsedDeclarator | undefined {
  let current: SyntaxNode | null = declarator;
  let type = withDims(copyType(base), undefined);
  let sawFunction = false;
  // The declarator tree visits suffixes inside-out, so each new dimension is prepended.
  let dims: number[] | undefined;
  let unknownDimension = false;

  while (current) {
    switch (current.type) {
      case 'identifier':
        return {
          nameNode: current,
          type: unknownDimension ? withDims(type, undefined) : withDims(type, dims),
          sawFunction,
        };

      case 'init_declarator':
      case 'parenthesized_declarator':
      case 'attributed_declarator':
        current = current.childForFieldName('declarator');
        break;

      case 'pointer_declarator':
        type = { ...type, ptr: type.ptr + 1 };
        dims = undefined;
        unknownDimension = false;
        current = current.childForFieldName('declarator');
        break;

      case 'array_declarator': {
        if (isParam) {
          // Array parameters decay to pointers; their written length is meaningless.
          type = { ...type, ptr: type.ptr + 1 };
          dims = undefined;
          unknownDimension = false;
        } else {
          const length = arrayLength(current.childForFieldName('size'));
          if (length === undefined) {
            // Any unknown dimension makes the whole shape unusable for size math.
            unknownDimension = true;
            dims = undefined;
          } else if (!unknownDimension) {
            dims = [length, ...(dims ?? [])];
          }
        }
        current = current.childForFieldName('declarator');
        break;
      }

      case 'function_declarator':
        sawFunction = true;
        current = current.childForFieldName('declarator');
        break;

      default:
        return undefined;
    }
  }

  return undefined;
}

function arrayLength(sizeNode: SyntaxNode | null): number | undefined {
  if (!sizeNode || sizeNode.type !== 'number_literal') {
    return undefined;
  }

  const normalized = sizeNode.text.replace(/[uUlL]+$/, '');
  let value: number;

  if (/^0[xX][0-9a-fA-F]+$/.test(normalized)) {
    value = Number.parseInt(normalized.slice(2), 16);
  } else if (/^0[0-7]+$/.test(normalized)) {
    // C octal literal: 010 is 8, not 10.
    value = Number.parseInt(normalized.slice(1), 8);
  } else if (/^[0-9]+$/.test(normalized)) {
    value = Number.parseInt(normalized, 10);
  } else {
    return undefined;
  }

  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function findFunctionDeclarator(
  declarator: SyntaxNode | null,
): SyntaxNode | undefined {
  let current: SyntaxNode | null = declarator;

  while (current) {
    if (current.type === 'function_declarator') {
      return current;
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

function hasConstQualifier(node: SyntaxNode): boolean {
  return node.namedChildren.some(
    (child) => child.type === 'type_qualifier' && /\bconst\b/.test(child.text),
  );
}

function applyConst(type: TypeInfo, isConst: boolean): TypeInfo {
  return isConst ? { ...type, const: true } : type;
}

function isBetterScope(candidate: Entry, current: Entry): boolean {
  const candidateSpan = candidate.scopeEnd - candidate.scopeStart;
  const currentSpan = current.scopeEnd - current.scopeStart;

  if (candidateSpan !== currentSpan) {
    return candidateSpan < currentSpan;
  }
  return candidate.order > current.order;
}
