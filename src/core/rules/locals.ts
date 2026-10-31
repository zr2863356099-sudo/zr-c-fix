import { typeFromSpecifierNode, type SymbolTable } from '../symbols';
import type { TypeInfo } from '../types';
import {
  evalConstExpression,
  sizeofBase,
  type DefineTable,
} from './constants';
import type { FunctionDefinitionInfo } from './flow';
import { collectNodes, type SyntaxNode } from './utils';

export interface LocalVariable {
  declaration: SyntaxNode;
  declarator: SyntaxNode;
  nameNode: SyntaxNode;
  name: string;
  type: TypeInfo;
  /** Total bytes for one object, or undefined when a dimension could not be evaluated. */
  sizeBytes: number | undefined;
  isStatic: boolean;
  hasOtherStorageClass: boolean;
  isStatementLevel: boolean;
  isVla: boolean;
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

interface DeclaratorShape {
  nameNode: SyntaxNode;
  pointerDepth: number;
  /** Source order (`m[2][n]` -> [2, n]); undefined entries are unsized `[]`. */
  arraySizes: Array<SyntaxNode | undefined>;
  directFunction: boolean;
}

export function collectFunctionLocals(
  info: FunctionDefinitionInfo,
  table: SymbolTable,
  defines: DefineTable,
): LocalVariable[] {
  const locals: LocalVariable[] = [];
  if (!info.body) {
    return locals;
  }

  for (const declaration of collectNodes(info.body, 'declaration')) {
    const typeNode =
      declaration.childForFieldName('type') ??
      declaration.namedChildren.find((child) => TYPE_NODE_TYPES.has(child.type)) ??
      null;
    const base = typeFromSpecifierNode(typeNode);

    let isStatic = false;
    let hasOtherStorageClass = false;
    for (const child of declaration.namedChildren) {
      if (child.type !== 'storage_class_specifier') {
        continue;
      }
      if (/\bstatic\b/.test(child.text)) {
        isStatic = true;
      } else {
        hasOtherStorageClass = true;
      }
    }

    const isStatementLevel = declaration.parent?.type === 'compound_statement';

    for (const child of declaration.namedChildren) {
      if (!DECLARATOR_TYPES.has(child.type)) {
        continue;
      }
      const shape = analyzeDeclarator(child);
      if (!shape || shape.directFunction) {
        continue;
      }

      const type: TypeInfo = {
        ...base,
        ptr: base.ptr + shape.pointerDepth,
      };
      const evaluated = shape.arraySizes.map((sizeNode) =>
        sizeNode ? evalConstExpression(sizeNode, defines) : undefined,
      );
      const isVla = shape.arraySizes.some(
        (sizeNode) =>
          sizeNode !== undefined &&
          evalConstExpression(sizeNode, defines) === undefined &&
          isRuntimeDimension(sizeNode, table, defines),
      );

      locals.push({
        declaration,
        declarator: child,
        nameNode: shape.nameNode,
        name: shape.nameNode.text,
        type,
        sizeBytes: sizeOfLocal(type, shape.arraySizes, evaluated),
        isStatic,
        hasOtherStorageClass,
        isStatementLevel,
        isVla,
      });
    }
  }

  return locals;
}

function sizeOfLocal(
  type: TypeInfo,
  arraySizes: ReadonlyArray<SyntaxNode | undefined>,
  evaluated: ReadonlyArray<number | undefined>,
): number | undefined {
  const element = type.ptr > 0 ? 8 : sizeofBase(type.base);
  if (element === undefined) {
    return undefined;
  }
  if (arraySizes.length === 0) {
    return element;
  }

  let total = element;
  for (const size of evaluated) {
    if (size === undefined || size < 0) {
      return undefined;
    }
    total *= size;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}

function isRuntimeDimension(
  sizeNode: SyntaxNode,
  table: SymbolTable,
  defines: DefineTable,
): boolean {
  if (collectNodes(sizeNode, 'call_expression').length > 0) {
    return true;
  }

  for (const identifier of collectNodes(sizeNode, 'identifier')) {
    if (defines.names.has(identifier.text)) {
      continue;
    }
    if (table.resolve(identifier.text, identifier)) {
      return true;
    }
  }
  return false;
}

function analyzeDeclarator(declarator: SyntaxNode): DeclaratorShape | undefined {
  const state: DeclaratorShape = {
    // Overwritten as soon as the identifier is reached.
    nameNode: declarator,
    pointerDepth: 0,
    arraySizes: [],
    directFunction: false,
  };

  const visit = (node: SyntaxNode): boolean => {
    switch (node.type) {
      case 'identifier':
        state.nameNode = node;
        return true;

      case 'init_declarator':
      case 'parenthesized_declarator':
      case 'attributed_declarator': {
        const inner = node.childForFieldName('declarator');
        return inner !== null && visit(inner);
      }

      case 'pointer_declarator': {
        state.pointerDepth++;
        const inner = node.childForFieldName('declarator');
        return inner !== null && visit(inner);
      }

      case 'array_declarator': {
        const inner = node.childForFieldName('declarator');
        if (!inner || !visit(inner)) {
          return false;
        }
        // Inner suffixes are visited first, so later pushes stay in source order.
        state.arraySizes.push(node.childForFieldName('size') ?? undefined);
        return true;
      }

      case 'function_declarator': {
        const inner = node.childForFieldName('declarator');
        if (!inner) {
          return false;
        }
        if (inner.type === 'identifier') {
          // A prototype or function definition, not a local variable.
          state.directFunction = true;
          state.nameNode = inner;
          return true;
        }
        return visit(inner);
      }

      default:
        return false;
    }
  };

  return visit(declarator) && !state.directFunction ? state : undefined;
}
