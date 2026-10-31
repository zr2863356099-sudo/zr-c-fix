import { inferType } from '../infer';
import { callArguments } from '../rules/format-string';
import { decayArray } from '../rules/type-model';
import type { Range } from '../rules/types';
import type { SyntaxNode } from '../rules/utils';
import type { SymbolTable } from '../symbols';
import type { TypeInfo } from '../types';

export interface FormatArityEdit {
  range: Range;
  newText: string;
}

export interface FormatArityEdits {
  /** Zero-width insertion before the format string's closing quote. */
  addSpecifier?: FormatArityEdit;
  /** Deletion spanning the extra argument and its adjacent comma. */
  dropArgument?: FormatArityEdit;
}

/**
 * Builds the two alternative edits for a call with one surplus argument: append the
 * inferred specifier to the format string, or delete the argument. Missing pieces (no
 * closing quote, no adjacent comma, multi-line span) are omitted so callers can offer
 * whichever edit is safe.
 */
export function buildFormatArityEdits(
  call: SyntaxNode,
  formatLiteral: SyntaxNode,
  extraArg: SyntaxNode,
  specifier: string,
): FormatArityEdits {
  const edits: FormatArityEdits = {};

  const addSpecifier = buildAddSpecifier(formatLiteral, specifier);
  if (addSpecifier) {
    edits.addSpecifier = addSpecifier;
  }

  const dropArgument = buildDropArgument(call, extraArg);
  if (dropArgument) {
    edits.dropArgument = dropArgument;
  }

  return edits;
}

/**
 * Suggestions for an invalid specifier, keyed by the argument the specifier pairs with.
 * Returns undefined for types outside the documented table (fail-closed).
 */
export function specifierForArgument(
  argument: SyntaxNode,
  table: SymbolTable,
  mode: 'printf' | 'scanf',
): string | undefined {
  const type = inferType(argument, table);
  if (type.base === 'unknown') {
    return undefined;
  }
  return mode === 'printf'
    ? printfSpecifier(type)
    : scanfSpecifier(argument, type, table);
}

function buildAddSpecifier(
  formatLiteral: SyntaxNode,
  specifier: string,
): FormatArityEdit | undefined {
  if (specifier.length === 0) {
    return undefined;
  }

  const text = formatLiteral.text;
  const close = text.lastIndexOf('"');
  if (close < 0 || close === text.indexOf('"')) {
    return undefined;
  }

  const position = offsetToPosition(
    formatLiteral,
    formatLiteral.startIndex + close,
  );
  return {
    range: {
      startLine: position.line,
      startChar: position.char,
      endLine: position.line,
      endChar: position.char,
    },
    newText: specifier,
  };
}

function buildDropArgument(
  call: SyntaxNode,
  extraArg: SyntaxNode,
): FormatArityEdit | undefined {
  const args = callArguments(call);
  const index = args.findIndex(
    (argument) =>
      argument.startIndex === extraArg.startIndex &&
      argument.endIndex === extraArg.endIndex,
  );
  if (index < 0) {
    return undefined;
  }

  const callText = call.text;
  const charAt = (offset: number): string | undefined =>
    callText[offset - call.startIndex];
  const spaceAt = (offset: number): boolean => /\s/.test(charAt(offset) ?? '');

  let start: number;
  let end: number;

  if (index === 0) {
    // First argument: delete `arg, ` instead of relying on a leading comma.
    start = extraArg.startIndex;
    const next = args[1];
    if (!next) {
      end = extraArg.endIndex;
    } else {
      const comma = findComma(extraArg.endIndex, next.startIndex, charAt);
      if (comma === undefined) {
        return undefined;
      }
      end = comma + 1;
      while (end < next.startIndex && spaceAt(end)) {
        end++;
      }
    }
  } else {
    const previous = args[index - 1];
    if (!previous) {
      return undefined;
    }
    const comma = findComma(previous.endIndex, extraArg.startIndex, charAt, true);
    if (comma === undefined) {
      return undefined;
    }
    start = comma;
    while (start > previous.endIndex && spaceAt(start - 1)) {
      start--;
    }
    end = extraArg.endIndex;
  }

  if (end <= start) {
    return undefined;
  }

  const from = offsetToPosition(call, start);
  const to = offsetToPosition(call, end);
  if (from.line !== to.line) {
    return undefined;
  }

  return {
    range: {
      startLine: from.line,
      startChar: from.char,
      endLine: to.line,
      endChar: to.char,
    },
    newText: '',
  };
}

/** Finds a comma in `[from, to)`, scanning backwards when `reverse` is set. */
function findComma(
  from: number,
  to: number,
  charAt: (offset: number) => string | undefined,
  reverse = false,
): number | undefined {
  if (reverse) {
    for (let offset = to - 1; offset >= from; offset--) {
      if (charAt(offset) === ',') {
        return offset;
      }
    }
    return undefined;
  }

  for (let offset = from; offset < to; offset++) {
    if (charAt(offset) === ',') {
      return offset;
    }
  }
  return undefined;
}

function printfSpecifier(type: TypeInfo): string | undefined {
  const decayed = decayArray(type);
  if (decayed.ptr > 0) {
    return decayed.base === 'char' && decayed.ptr === 1 ? '%s' : undefined;
  }
  return scalarSpecifier(decayed, 'printf');
}

function scanfSpecifier(
  argument: SyntaxNode,
  type: TypeInfo,
  table: SymbolTable,
): string | undefined {
  if ((type.dims?.length ?? 0) > 0) {
    const decayed = decayArray(type);
    if (decayed.ptr !== 1) {
      return undefined;
    }
    return decayed.base === 'char'
      ? '%s'
      : scalarSpecifier({ base: decayed.base, ptr: 0 }, 'scanf');
  }

  if (type.ptr !== 1) {
    return undefined;
  }
  if (type.base === 'char') {
    return isAddressOfScalarChar(argument, table) ? '%c' : '%s';
  }
  return scalarSpecifier({ base: type.base, ptr: 0 }, 'scanf');
}

function scalarSpecifier(
  type: TypeInfo,
  mode: 'printf' | 'scanf',
): string | undefined {
  if (type.ptr > 0 || (type.dims?.length ?? 0) > 0) {
    return undefined;
  }

  switch (type.base) {
    case 'char':
      return '%c';
    case 'int':
    case 'signed':
      return '%d';
    case 'unsigned':
      return '%u';
    case 'long':
      return '%ld';
    case 'ulong':
      return '%lu';
    case 'longlong':
      return '%lld';
    case 'ulonglong':
      return '%llu';
    case 'float':
    case 'double':
      return mode === 'scanf' ? '%lf' : '%f';
    default:
      return undefined;
  }
}

const ADDRESS_OF_NAME = /^&[ \t]*[A-Za-z_]\w*$/;

function isAddressOfScalarChar(
  argument: SyntaxNode,
  table: SymbolTable,
): boolean {
  if (
    argument.type !== 'pointer_expression' ||
    !ADDRESS_OF_NAME.test(argument.text.trim())
  ) {
    return false;
  }

  const operand =
    argument.childForFieldName('argument') ?? argument.namedChild(0) ?? null;
  if (!operand || operand.type !== 'identifier') {
    return false;
  }

  const symbol = table.resolve(operand.text, operand);
  return (
    symbol !== undefined &&
    symbol.type.base === 'char' &&
    symbol.type.ptr === 0 &&
    (symbol.type.dims?.length ?? 0) === 0
  );
}

function offsetToPosition(
  node: SyntaxNode,
  offset: number,
): { line: number; char: number } {
  const text = node.text;
  const local = Math.max(0, Math.min(offset - node.startIndex, text.length));
  let line = node.startPosition.row;
  let lineStart = -node.startPosition.column;

  for (let index = 0; index < local; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      line++;
      lineStart = index + 1;
    } else if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        index++;
      }
      line++;
      lineStart = index + 1;
    }
  }

  return { line, char: local - lineStart };
}
