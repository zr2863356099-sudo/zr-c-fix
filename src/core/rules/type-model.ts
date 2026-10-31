import { inferType } from '../infer';
import type { SymbolTable } from '../symbols';
import { withDims, type BaseType, type TypeInfo } from '../types';
import type { SyntaxNode } from './utils';

/** Integer rank used for printf/scanf width checks; undefined for non-integers. */
export function integerRank(type: TypeInfo): number | undefined {
  if (type.ptr !== 0 || (type.dims?.length ?? 0) > 0) {
    return undefined;
  }
  switch (type.base) {
    case 'char':
    case 'short':
      return 1;
    case 'int':
    case 'signed':
    case 'unsigned':
      return 2;
    case 'long':
    case 'ulong':
      return 3;
    case 'longlong':
    case 'ulonglong':
      return 4;
    default:
      return undefined;
  }
}

export function isUnsignedBase(base: BaseType): boolean {
  return base === 'unsigned' || base === 'ulong' || base === 'ulonglong';
}

export function isFloatType(type: TypeInfo): boolean {
  return (
    type.ptr === 0 &&
    (type.dims?.length ?? 0) === 0 &&
    (type.base === 'float' || type.base === 'double')
  );
}

/** Arrays decay to a pointer to their element type. */
export function decayArray(type: TypeInfo): TypeInfo {
  if ((type.dims?.length ?? 0) === 0) {
    return type;
  }
  return { ...type, ptr: type.ptr + 1, dims: undefined, array: undefined };
}

/**
 * Default argument promotions for printf varargs: float -> double, char/short -> int.
 * Note `printf("%f", f)` with a float variable is therefore correct.
 */
export function promotedPrintfType(type: TypeInfo): TypeInfo {
  if (type.base === 'unknown') {
    return type;
  }
  if (type.base === 'float') {
    return { base: 'double', ptr: 0 };
  }
  if (type.base === 'char' || type.base === 'short') {
    return { base: 'int', ptr: 0 };
  }
  return type;
}

/** Type of the object a scanf argument points at; undefined when it is not a pointer. */
export function scanfTargetType(
  argument: SyntaxNode,
  table: SymbolTable,
): TypeInfo | undefined {
  const type = inferType(argument, table);
  if (type.base === 'unknown') {
    return undefined;
  }

  if ((type.dims?.length ?? 0) > 0) {
    // Array argument decays to a pointer; the target is its element type.
    const inner = type.dims?.slice(1) ?? [];
    return withDims(type, inner);
  }
  if (type.ptr > 0) {
    return { ...type, ptr: type.ptr - 1, dims: undefined, array: undefined };
  }
  return undefined;
}

/** Array element size in bytes, or undefined for unknown bases. */
export function elementSizeOf(type: TypeInfo): number | undefined {
  if (type.ptr > 0) {
    return 8;
  }
  switch (type.base) {
    case 'char':
      return 1;
    case 'short':
      return 2;
    case 'int':
    case 'unsigned':
    case 'signed':
    case 'long':
    case 'ulong':
    case 'float':
      return 4;
    case 'longlong':
    case 'ulonglong':
    case 'double':
      return 8;
    default:
      return undefined;
  }
}
