import { inferType } from '../infer';
import type { SymbolTable } from '../symbols';
import type { BaseType, TypeInfo } from '../types';
import {
  conversionRange,
  pairArguments,
  parseCallFormat,
  rebuildConversion,
  type FormatConversion,
} from './format-string';
import { callSites, familyInfo, familyOf } from './library';
import {
  decayArray,
  integerRank,
  isFloatType,
  isUnsignedBase,
  promotedPrintfType,
  scanfTargetType,
} from './type-model';
import type { Range, Rule } from './types';
import {
  makeIssue,
  rangeFromOffsets,
  unwrapParentheses,
  type SyntaxNode,
} from './utils';

interface FormatSuggestion {
  /** Replacement for the conversion specifier. Empty means delete `fixRange`. */
  newText: string;
  /** Set when the fix edits the argument instead of the conversion specifier. */
  fixRange?: Range;
  /** Overrides the default "use '<specifier>'" message. */
  message?: string;
  /** Chinese counterpart of `message`. */
  messageZh?: string;
}

const ADDRESS_OF_NAME = /^&[ \t]*[A-Za-z_]\w*$/;
const SIGNED_INTEGER_CONVERSIONS = new Set(['d', 'i']);
const UNSIGNED_INTEGER_CONVERSIONS = new Set(['u', 'o', 'x', 'X']);

/**
 * printf / scanf type judgement table.
 *
 * printf (default argument promotions apply):
 *   float -> double, char/short -> int. `printf("%f", f)` with a float `f` is
 *   CORRECT because the value is promoted, so it must never be reported.
 *
 * scanf (no promotions, exact pointer type expected):
 *   `%f` -> float*, `%lf` -> double*, `%d` -> int*, `%ld` -> long*,
 *   `%lld` -> long long*, `%zu` -> size_t* (size_t = unsigned long in this model).
 *   `%d` against a `long long` is a width error and becomes `%lld`.
 *
 * Any type that cannot be inferred is skipped (fail-closed).
 */
export const rule: Rule = {
  id: 'format-type-mismatch',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const issues = [];

    for (const site of callSites(ctx.root)) {
      const family = familyOf(site.name);
      if (!family) {
        continue;
      }
      const info = familyInfo(family);
      const format = parseCallFormat(site.call, info.formatIndex, info.mode);
      if (!format || !format.supported) {
        continue;
      }

      const valueArguments = site.args.slice(info.formatIndex + 1);
      for (const pair of pairArguments(format, valueArguments, info.mode)) {
        const { conversion, argument } = pair;
        if (!argument || conversion.conversion === '%') {
          continue;
        }

        const suggestion =
          info.mode === 'printf'
            ? printfSuggestion(conversion, argument, ctx.table, ctx.text)
            : scanfSuggestion(conversion, argument, ctx.table);
        if (!suggestion) {
          continue;
        }

        const range = conversionRange(ctx.text, format.literal, conversion);
        if (range.startLine !== range.endLine) {
          continue;
        }
        const fixRange = suggestion.fixRange ?? range;
        if (fixRange.startLine !== fixRange.endLine) {
          continue;
        }

        const message =
          suggestion.message ??
          `Format '${conversion.raw}' does not match '${argument.text}'; use '${suggestion.newText}'`;
        const messageZh =
          suggestion.messageZh ??
          `格式符 '${conversion.raw}' 与 '${argument.text}' 不匹配，应改为 '${suggestion.newText}'`;
        issues.push(
          makeIssue(rule, range, message, messageZh, {
            range: fixRange,
            newText: suggestion.newText,
          }),
        );
      }
    }

    return issues;
  },
};

function printfSuggestion(
  conversion: FormatConversion,
  argument: SyntaxNode,
  table: SymbolTable,
  text: string,
): FormatSuggestion | undefined {
  const raw = inferType(argument, table);
  if (raw.base === 'unknown') {
    return undefined;
  }

  const decayed = decayArray(raw);
  const promoted = promotedPrintfType(decayed);

  switch (conversion.conversion) {
    case 'd':
    case 'i':
    case 'u':
    case 'o':
    case 'x':
    case 'X':
      if (decayed.ptr > 0) {
        return printfPointerArgument(conversion, argument, text);
      }
      return replacement(printfIntegerSuggestion(conversion, promoted));

    case 'f':
    case 'F':
    case 'e':
    case 'E':
    case 'g':
    case 'G':
    case 'a':
    case 'A': {
      if (decayed.ptr > 0) {
        return undefined;
      }
      const rank = integerRank(promoted);
      if (rank === undefined) {
        // float and double both match after promotion.
        return undefined;
      }
      return replacement(
        rebuildConversion(conversion, '', unsignedConversion(promoted)),
      );
    }

    case 'c':
      return printfCharSuggestion(conversion, decayed, promoted);

    case 's':
      return printfStringSuggestion(conversion, argument, raw, decayed);

    case 'p':
      return printfPointerSuggestion(conversion, argument, raw);

    default:
      // `%n` and anything else are left alone.
      return undefined;
  }
}

function printfPointerArgument(
  conversion: FormatConversion,
  argument: SyntaxNode,
  text: string,
): FormatSuggestion {
  const address = isAddressOfName(argument);
  if (address) {
    const ampersand = argument.startIndex + argument.text.indexOf('&');
    return {
      newText: '',
      fixRange: rangeFromOffsets(text, ampersand, ampersand + 1),
      message: `Format '${conversion.raw}' does not match '${argument.text}'; drop the '&'`,
      messageZh: `格式符 '${conversion.raw}' 与 '${argument.text}' 不匹配，去掉 '&'`,
    };
  }

  return { newText: rebuildConversion(conversion, '', 'p') };
}

function printfCharSuggestion(
  conversion: FormatConversion,
  decayed: TypeInfo,
  promoted: TypeInfo,
): FormatSuggestion | undefined {
  if (decayed.base === 'char' && decayed.ptr > 0) {
    return replacement(rebuildConversion(conversion, '', 's'));
  }
  if (integerRank(promoted) !== undefined) {
    return undefined;
  }
  if (isFloatType(promoted)) {
    return replacement(rebuildConversion(conversion, '', 'f'));
  }
  return undefined;
}

function printfStringSuggestion(
  conversion: FormatConversion,
  argument: SyntaxNode,
  raw: TypeInfo,
  decayed: TypeInfo,
): FormatSuggestion | undefined {
  if (conversion.length !== '') {
    return undefined;
  }
  if (decayed.base === 'char' && decayed.ptr > 0) {
    return undefined;
  }
  if (raw.base === 'char' && raw.ptr === 0) {
    return replacement(rebuildConversion(conversion, '', 'c'));
  }

  if (integerRank(raw) !== undefined) {
    const newText = rebuildConversion(conversion, '', 'd');
    return typedReplacement(conversion, argument, raw, newText);
  }
  if (isFloatType(raw)) {
    const newText = rebuildConversion(conversion, '', 'f');
    return typedReplacement(conversion, argument, raw, newText);
  }
  return undefined;
}

function printfPointerSuggestion(
  conversion: FormatConversion,
  argument: SyntaxNode,
  raw: TypeInfo,
): FormatSuggestion | undefined {
  // Arrays decay to a pointer, so printing an array with `%p` is valid.
  if (raw.ptr > 0 || (raw.dims?.length ?? 0) > 0) {
    return undefined;
  }

  if (integerRank(raw) !== undefined) {
    const newText = rebuildConversion(conversion, '', 'd');
    return typedReplacement(conversion, argument, raw, newText);
  }
  if (isFloatType(raw)) {
    const newText = rebuildConversion(conversion, '', 'f');
    return typedReplacement(conversion, argument, raw, newText);
  }
  return undefined;
}

function replacement(text: string | undefined): FormatSuggestion | undefined {
  return text === undefined ? undefined : { newText: text };
}

function typedReplacement(
  conversion: FormatConversion,
  argument: SyntaxNode,
  type: TypeInfo,
  newText: string,
): FormatSuggestion {
  return {
    newText,
    message: `Format '${conversion.raw}' does not match '${argument.text}' (${baseLabel(type.base)}); use '${newText}'`,
    messageZh: `格式符 '${conversion.raw}' 与 '${argument.text}' 不匹配（${baseLabel(type.base)}），应改为 '${newText}'`,
  };
}

function isAddressOfName(argument: SyntaxNode): boolean {
  return (
    argument.type === 'pointer_expression' &&
    ADDRESS_OF_NAME.test(argument.text.trim())
  );
}

function baseLabel(base: BaseType): string {
  switch (base) {
    case 'longlong':
      return 'long long';
    case 'ulong':
      return 'unsigned long';
    case 'ulonglong':
      return 'unsigned long long';
    case 'unsigned':
      return 'unsigned int';
    case 'signed':
      return 'signed int';
    default:
      return base;
  }
}

function printfIntegerSuggestion(
  conversion: FormatConversion,
  type: TypeInfo,
): string | undefined {
  if (type.ptr > 0) {
    return undefined;
  }

  const rank = integerRank(type);
  if (rank === undefined) {
    if (isFloatType(type)) {
      return rebuildConversion(conversion, '', 'f');
    }
    return undefined;
  }

  const expected = printfExpectedRank(conversion.length);
  if (expected === undefined || rank === expected) {
    return undefined;
  }

  return rebuildConversion(
    conversion,
    printfLengthForRank(rank),
    integerConversionFor(conversion, type),
  );
}

function scanfSuggestion(
  conversion: FormatConversion,
  argument: SyntaxNode,
  table: SymbolTable,
): FormatSuggestion | undefined {
  const scoped = unwrapParentheses(argument);
  if (
    conversion.conversion === 's' &&
    isAddressOfScalarChar(scoped, table)
  ) {
    return { newText: rebuildConversion(conversion, '', 'c') };
  }

  return replacement(scanfSuggestionCore(conversion, argument, table));
}

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
  return symbol !== undefined && isScalarChar(symbol.type);
}

function isScalarChar(type: TypeInfo): boolean {
  return (
    type.base === 'char' &&
    type.ptr === 0 &&
    (type.dims?.length ?? 0) === 0
  );
}

function scanfSuggestionCore(
  conversion: FormatConversion,
  argument: SyntaxNode,
  table: SymbolTable,
): string | undefined {
  const target = scanfTargetType(argument, table);
  if (!target) {
    return undefined;
  }

  switch (conversion.conversion) {
    case 'd':
    case 'i':
    case 'u':
    case 'o':
    case 'x':
    case 'X':
      return scanfIntegerSuggestion(conversion, target);

    case 'f':
    case 'F':
    case 'e':
    case 'E':
    case 'g':
    case 'G':
    case 'a':
    case 'A': {
      if (target.ptr > 0) {
        return undefined;
      }
      const rank = integerRank(target);
      if (rank !== undefined) {
        return rebuildConversion(
          conversion,
          scanfLengthFor(target),
          unsignedConversion(target),
        );
      }
      if (!isFloatType(target)) {
        return undefined;
      }
      const length = target.base === 'double' ? 'l' : '';
      if (conversion.length === length) {
        return undefined;
      }
      // long double collapses to double in the type model; accept `%Lf`.
      if (target.base === 'double' && conversion.length === 'L') {
        return undefined;
      }
      return rebuildConversion(conversion, length, conversion.conversion);
    }

    case 'c':
    case 's':
    case '[': {
      if (conversion.length !== '') {
        return undefined;
      }
      if (
        target.base === 'char' &&
        target.ptr === 0 &&
        (target.dims?.length ?? 0) === 0
      ) {
        return undefined;
      }
      if (integerRank(target) !== undefined) {
        return rebuildConversion(
          conversion,
          scanfLengthFor(target),
          unsignedConversion(target),
        );
      }
      if (isFloatType(target)) {
        return rebuildConversion(
          conversion,
          target.base === 'double' ? 'l' : '',
          'f',
        );
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

function scanfIntegerSuggestion(
  conversion: FormatConversion,
  target: TypeInfo,
): string | undefined {
  if (target.ptr > 0) {
    return undefined;
  }

  if (isFloatType(target)) {
    return rebuildConversion(
      conversion,
      target.base === 'double' ? 'l' : '',
      'f',
    );
  }

  const rank = integerRank(target);
  const expected = scanfExpected(conversion.length);
  if (rank === undefined || !expected) {
    return undefined;
  }

  const baseMatches = expected.base === undefined || expected.base === target.base;
  if (rank === expected.rank && baseMatches) {
    return undefined;
  }

  return rebuildConversion(
    conversion,
    scanfLengthFor(target),
    integerConversionFor(conversion, target),
  );
}

interface ScanfExpectation {
  rank: number;
  base?: BaseType;
}

function scanfExpected(length: string): ScanfExpectation | undefined {
  switch (length) {
    case '':
      return { rank: 2 };
    case 'hh':
      return { rank: 1, base: 'char' };
    case 'h':
      return { rank: 1, base: 'short' };
    case 'l':
      return { rank: 3 };
    case 'll':
      return { rank: 4 };
    case 'z':
      return { rank: 3 };
    case 'j':
      return { rank: 4 };
    case 't':
      return { rank: 3 };
    default:
      return undefined;
  }
}

function printfExpectedRank(length: string): number | undefined {
  switch (length) {
    case '':
    case 'h':
    case 'hh':
      // char/short are promoted to int before printf sees them.
      return 2;
    case 'l':
    case 'z':
    case 't':
      return 3;
    case 'll':
    case 'j':
      return 4;
    default:
      return undefined;
  }
}

function printfLengthForRank(rank: number): string {
  switch (rank) {
    case 3:
      return 'l';
    case 4:
      return 'll';
    default:
      return '';
  }
}

function scanfLengthFor(type: TypeInfo): string {
  switch (type.base) {
    case 'char':
      return 'hh';
    case 'short':
      return 'h';
    case 'long':
    case 'ulong':
      return 'l';
    case 'longlong':
    case 'ulonglong':
      return 'll';
    default:
      return '';
  }
}

function unsignedConversion(type: TypeInfo): string {
  return isUnsignedBase(type.base) ? 'u' : 'd';
}

/**
 * Keeps the original conversion letter when its signedness already matches the target,
 * so a pure length fix turns `%x` into `%llx` rather than changing the semantics to
 * `%llu`. Only a signedness mismatch rewrites the letter.
 */
function integerConversionFor(
  conversion: FormatConversion,
  type: TypeInfo,
): string {
  if (isUnsignedBase(type.base)) {
    return UNSIGNED_INTEGER_CONVERSIONS.has(conversion.conversion)
      ? conversion.conversion
      : 'u';
  }
  return SIGNED_INTEGER_CONVERSIONS.has(conversion.conversion)
    ? conversion.conversion
    : 'd';
}
