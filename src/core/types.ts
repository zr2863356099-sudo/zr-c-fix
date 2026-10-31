export type BaseType =
  | 'int'
  | 'char'
  | 'float'
  | 'double'
  | 'short'
  | 'long'
  | 'longlong'
  | 'ulong'
  | 'ulonglong'
  | 'unsigned'
  | 'signed'
  | 'void'
  | 'struct'
  | 'unknown';

export interface TypeInfo {
  base: BaseType;
  /** Pointer depth: char* = 1, char** = 2. */
  ptr: number;
  /** Array dimensions, outermost first: int m[3][4] -> [3, 4]. */
  dims?: number[];
  /** Read-only view of dims[0], kept for callers that only need the outer length. */
  array?: number;
  const?: boolean;
}

export function unknownType(): TypeInfo {
  return { base: 'unknown', ptr: 0 };
}

export function copyType(type: TypeInfo): TypeInfo {
  const copy: TypeInfo = { base: type.base, ptr: type.ptr };
  if (type.dims !== undefined && type.dims.length > 0) {
    copy.dims = [...type.dims];
    copy.array = type.dims[0];
  }
  if (type.const !== undefined) {
    copy.const = type.const;
  }
  return copy;
}

/**
 * Replaces the array dimensions of `type`. `dims` is outermost-first; an empty or
 * undefined list removes the array layer. `array` is kept in sync with `dims[0]`.
 */
export function withDims(
  type: TypeInfo,
  dims: readonly number[] | undefined,
): TypeInfo {
  const next: TypeInfo = { base: type.base, ptr: type.ptr };
  if (type.const !== undefined) {
    next.const = type.const;
  }
  if (dims !== undefined && dims.length > 0) {
    next.dims = [...dims];
    next.array = dims[0];
  }
  return next;
}
