import type Parser from 'web-tree-sitter';
import { SIGNATURES } from './signatures';
import { typeFromSpecifierNode, type SymbolTable } from './symbols';
import {
  copyType,
  unknownType,
  withDims,
  type BaseType,
  type TypeInfo,
} from './types';

export type SyntaxNode = Parser.SyntaxNode;

const SIGNATURES_BY_NAME = new Map(
  SIGNATURES.map((signature) => [signature.name, signature]),
);

const TYPE_SPECIFIER_TYPES = new Set([
  'primitive_type',
  'sized_type_specifier',
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'type_identifier',
]);

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const LOGICAL_OPERATORS = new Set(['&&', '||']);
const SHIFT_OPERATORS = new Set(['<<', '>>']);
const BITWISE_OPERATORS = new Set(['&', '|', '^']);
const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%']);

/**
 * Infers the C type of an expression. Anything outside the deliberately small model
 * returns `unknown`, so downstream rules stay silent instead of guessing.
 */
export function inferType(node: SyntaxNode, table: SymbolTable): TypeInfo {
  switch (node.type) {
    case 'identifier': {
      const symbol = table.resolve(node.text, node);
      return symbol ? copyType(symbol.type) : unknownType();
    }

    case 'number_literal':
      return isFloatingLiteral(node.text)
        ? { base: 'double', ptr: 0 }
        : { base: 'int', ptr: 0 };

    case 'char_literal':
      return { base: 'char', ptr: 0 };

    case 'string_literal':
      return withDims(
        { base: 'char', ptr: 1 },
        [decodedStringLength(node.text) + 1],
      );

    case 'concatenated_string': {
      let length = 0;
      for (const child of node.namedChildren) {
        if (child.type === 'string_literal') {
          length += decodedStringLength(child.text);
        }
      }
      return withDims({ base: 'char', ptr: 1 }, [length + 1]);
    }

    case 'pointer_expression': {
      const argument = expressionChild(node);
      if (!argument) {
        return unknownType();
      }
      const operand = inferType(argument, table);
      if (operand.base === 'unknown') {
        return unknownType();
      }

      if (node.text.trimStart().startsWith('&')) {
        return withDims({ ...operand, ptr: operand.ptr + 1 }, undefined);
      }
      if (operand.ptr > 0) {
        return withDims({ ...operand, ptr: operand.ptr - 1 }, undefined);
      }
      return unknownType();
    }

    case 'unary_expression': {
      const argument = expressionChild(node);
      if (!argument) {
        return unknownType();
      }
      const operator =
        node.childForFieldName('operator')?.text ?? node.text.trimStart()[0] ?? '';
      if (operator === '+' || operator === '-') {
        const operand = inferType(argument, table);
        return operand.base === 'unknown' ? unknownType() : copyType(operand);
      }
      if (operator === '!' || operator === '~') {
        return { base: 'int', ptr: 0 };
      }
      return unknownType();
    }

    case 'update_expression': {
      const argument = expressionChild(node);
      if (!argument) {
        return unknownType();
      }
      const operand = inferType(argument, table);
      return operand.base === 'unknown' ? unknownType() : copyType(operand);
    }

    case 'subscript_expression': {
      const argument =
        node.childForFieldName('argument') ?? node.namedChild(0) ?? null;
      if (!argument) {
        return unknownType();
      }
      const operand = inferType(argument, table);

      // Peel one array dimension per subscript: `m[i]` -> int[4], `m[i][j]` -> int.
      if (operand.dims !== undefined && operand.dims.length > 0) {
        return withDims(operand, operand.dims.slice(1));
      }
      if (operand.ptr > 0) {
        return withDims({ ...operand, ptr: operand.ptr - 1 }, undefined);
      }
      return unknownType();
    }

    case 'binary_expression': {
      const leftNode = node.childForFieldName('left') ?? node.namedChild(0) ?? null;
      const rightNode =
        node.childForFieldName('right') ?? node.namedChild(1) ?? null;
      if (!leftNode || !rightNode) {
        return unknownType();
      }
      const operator =
        node.childForFieldName('operator')?.text ??
        operatorBetween(node.text, leftNode.text, rightNode.text);
      return binaryResult(
        inferType(leftNode, table),
        inferType(rightNode, table),
        operator,
      );
    }

    case 'parenthesized_expression': {
      const inner = node.namedChild(0);
      return inner ? inferType(inner, table) : unknownType();
    }

    case 'cast_expression':
      return castType(node.childForFieldName('type'));

    case 'call_expression': {
      const callee = node.childForFieldName('function');
      if (!callee || callee.type !== 'identifier') {
        return unknownType();
      }
      const signature = SIGNATURES_BY_NAME.get(callee.text);
      return signature ? copyType(signature.retType) : unknownType();
    }

    case 'sizeof_expression':
      return { base: 'ulong', ptr: 0 };

    default:
      return unknownType();
  }
}

/** Renders a type as the signature used by `typeFingerprint`. */
export function formatType(type: TypeInfo): string {
  const prefix = type.const ? 'const ' : '';
  const pointers = '*'.repeat(Math.max(0, type.ptr));
  const dims = (type.dims ?? []).map((size) => `[${size}]`).join('');
  return `${prefix}${BASE_LABELS[type.base]}${pointers}${dims}`;
}

/**
 * Stable fingerprint of the types of `names`: sorted, missing symbols become `name:?`.
 * A declaration changing type changes the fingerprint, which re-arms suppression.
 */
export function typeFingerprint(table: SymbolTable, names: string[]): string {
  const sorted = Array.from(new Set(names)).sort();
  return sorted
    .map((name) => {
      const symbol = table.lookup(name);
      return `${name}:${symbol ? formatType(symbol.type) : '?'}`;
    })
    .join(',');
}

const BASE_LABELS: Record<BaseType, string> = {
  int: 'int',
  char: 'char',
  float: 'float',
  double: 'double',
  short: 'short',
  long: 'long',
  longlong: 'long long',
  ulong: 'unsigned long',
  ulonglong: 'unsigned long long',
  unsigned: 'unsigned int',
  signed: 'signed int',
  void: 'void',
  struct: 'struct',
  unknown: 'unknown',
};

function expressionChild(node: SyntaxNode): SyntaxNode | null {
  return (
    node.childForFieldName('argument') ??
    node.childForFieldName('value') ??
    node.namedChild(0) ??
    null
  );
}

function isFloatingLiteral(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.startsWith('0x')) {
    // Hex floats are vanishingly rare in student code; treat hex as integer.
    return false;
  }
  return normalized.includes('.') || normalized.includes('e');
}

function decodedStringLength(text: string): number {
  let content = text;
  if (content.startsWith('"')) {
    content = content.slice(1);
  }
  if (content.endsWith('"')) {
    content = content.slice(0, -1);
  }

  let length = 0;
  let index = 0;

  while (index < content.length) {
    const character = content[index];
    if (character !== '\\') {
      length++;
      index++;
      continue;
    }

    length++;
    const next = content[index + 1];
    if (next === undefined) {
      index++;
      continue;
    }

    if (next === 'x' || next === 'X') {
      index += 2;
      while (index < content.length && /[0-9a-fA-F]/.test(content[index] ?? '')) {
        index++;
      }
    } else if (/[0-7]/.test(next)) {
      index++;
      let digits = 0;
      while (
        digits < 3 &&
        index < content.length &&
        /[0-7]/.test(content[index] ?? '')
      ) {
        index++;
        digits++;
      }
    } else {
      index += 2;
    }
  }

  return length;
}

function operatorBetween(text: string, left: string, right: string): string {
  const start = left.length;
  const end = text.length - right.length;
  return end > start ? text.slice(start, end).trim() : '';
}

function castType(typeNode: SyntaxNode | null): TypeInfo {
  if (!typeNode) {
    return unknownType();
  }

  if (typeNode.type !== 'type_descriptor') {
    return typeFromSpecifierNode(typeNode);
  }

  const specifier =
    typeNode.namedChildren.find((child) => TYPE_SPECIFIER_TYPES.has(child.type)) ??
    null;
  const base = typeFromSpecifierNode(specifier);
  const pointers = (typeNode.text.match(/\*/g) ?? []).length;
  const isConst = /\bconst\b/.test(typeNode.text);

  return {
    ...base,
    ptr: base.ptr + pointers,
    ...(isConst ? { const: true } : {}),
  };
}

function binaryResult(left: TypeInfo, right: TypeInfo, operator: string): TypeInfo {
  if (COMPARISON_OPERATORS.has(operator) || LOGICAL_OPERATORS.has(operator)) {
    return { base: 'int', ptr: 0 };
  }

  if (left.base === 'unknown' || right.base === 'unknown') {
    return unknownType();
  }

  if (SHIFT_OPERATORS.has(operator)) {
    if (!isIntegerScalar(left) || !isIntegerScalar(right)) {
      return unknownType();
    }
    return promotedInteger(left);
  }

  if (left.ptr > 0 || right.ptr > 0) {
    // Pointer arithmetic is intentionally outside the model.
    return unknownType();
  }
  if (left.dims !== undefined || right.dims !== undefined) {
    return unknownType();
  }

  if (BITWISE_OPERATORS.has(operator)) {
    if (!isIntegerScalar(left) || !isIntegerScalar(right)) {
      return unknownType();
    }
    return usualArithmetic(left, right);
  }

  if (ARITHMETIC_OPERATORS.has(operator)) {
    if (operator === '%' && (!isIntegerScalar(left) || !isIntegerScalar(right))) {
      return unknownType();
    }
    return usualArithmetic(left, right);
  }

  return unknownType();
}

function isIntegerScalar(type: TypeInfo): boolean {
  if (type.ptr !== 0) {
    return false;
  }
  switch (type.base) {
    case 'char':
    case 'short':
    case 'int':
    case 'signed':
    case 'unsigned':
    case 'long':
    case 'ulong':
    case 'longlong':
    case 'ulonglong':
      return true;
    default:
      return false;
  }
}

interface IntegerClass {
  rank: number;
  unsigned: boolean;
  base: BaseType;
}

function integerClass(type: TypeInfo): IntegerClass | undefined {
  if (type.ptr !== 0) {
    return undefined;
  }
  switch (type.base) {
    case 'char':
    case 'short':
      return { rank: 1, unsigned: false, base: type.base };
    case 'int':
    case 'signed':
      return { rank: 2, unsigned: false, base: 'int' };
    case 'unsigned':
      return { rank: 2, unsigned: true, base: 'unsigned' };
    case 'long':
      return { rank: 3, unsigned: false, base: 'long' };
    case 'ulong':
      return { rank: 3, unsigned: true, base: 'ulong' };
    case 'longlong':
      return { rank: 4, unsigned: false, base: 'longlong' };
    case 'ulonglong':
      return { rank: 4, unsigned: true, base: 'ulonglong' };
    default:
      return undefined;
  }
}

function promotedInteger(type: TypeInfo): TypeInfo {
  const cls = integerClass(type);
  if (!cls) {
    return unknownType();
  }
  return { base: promotedClass(cls).base, ptr: 0 };
}

function promotedClass(cls: IntegerClass): IntegerClass {
  return cls.rank === 1 ? { rank: 2, unsigned: false, base: 'int' } : cls;
}

function usualArithmetic(left: TypeInfo, right: TypeInfo): TypeInfo {
  if (left.base === 'double' || right.base === 'double') {
    return { base: 'double', ptr: 0 };
  }
  if (left.base === 'float' || right.base === 'float') {
    return { base: 'float', ptr: 0 };
  }

  const leftClass = integerClass(left);
  const rightClass = integerClass(right);
  if (!leftClass || !rightClass) {
    return unknownType();
  }

  const promotedLeft = promotedClass(leftClass);
  const promotedRight = promotedClass(rightClass);

  if (promotedLeft.rank === promotedRight.rank) {
    if (promotedLeft.unsigned || promotedRight.unsigned) {
      return { base: unsignedBase(promotedLeft.rank), ptr: 0 };
    }
    return { base: signedBase(promotedLeft.rank), ptr: 0 };
  }

  const higher =
    promotedLeft.rank > promotedRight.rank ? promotedLeft : promotedRight;
  return { base: higher.base, ptr: 0 };
}

function unsignedBase(rank: number): BaseType {
  switch (rank) {
    case 3:
      return 'ulong';
    case 4:
      return 'ulonglong';
    default:
      return 'unsigned';
  }
}

function signedBase(rank: number): BaseType {
  switch (rank) {
    case 3:
      return 'long';
    case 4:
      return 'longlong';
    default:
      return 'int';
  }
}
