import type { Range } from './types';
import { rangeFromOffsets, type SyntaxNode } from './utils';

export type FormatMode = 'printf' | 'scanf';

export interface FormatConversion {
  /** Raw specifier text, e.g. `%*lld`. */
  raw: string;
  /** Offset of `%` inside the literal node's text. */
  start: number;
  /** Offset just past the conversion character. */
  end: number;
  /** `%` plus flags, width and precision; excludes the length modifier. */
  prefix: string;
  /** Length modifier: '', 'hh', 'h', 'l', 'll', 'j', 'z', 't', 'L'. */
  length: string;
  /** Conversion character, or '[' for a scanf scanset. */
  conversion: string;
  /** Field width text when present (digits or '*'). */
  width: string | undefined;
  starWidth: boolean;
  starPrecision: boolean;
  /** scanf assignment suppression (`%*d`). */
  suppressed: boolean;
}

export interface InvalidFormatSpecifier {
  /** Offset of `%` inside the literal node's text. */
  start: number;
  /** Offset just past the flags/width/precision/length that were parsed. */
  end: number;
  /** Raw specifier text, e.g. `%l`. */
  raw: string;
  /** Conversion character, or '' when the specifier ends before one. */
  conversion: string;
}

export interface ParsedFormat {
  literal: SyntaxNode;
  conversions: FormatConversion[];
  /** Specifiers whose conversion character is missing or outside the legal set. */
  invalid: InvalidFormatSpecifier[];
  /** False when the specifier syntax is outside the small model. */
  supported: boolean;
}

export interface PairedArgument {
  conversion: FormatConversion;
  /** Missing when the call supplies fewer arguments than the format needs. */
  argument: SyntaxNode | undefined;
}

const PRINTF_FLAGS = new Set(['-', '+', ' ', '#', '0', "'"]);
const LENGTH_MODIFIERS = ['hh', 'll', 'h', 'l', 'j', 'z', 't', 'L'] as const;

/** Legal conversion characters shared by the printf and scanf families. */
export const LEGAL_CONVERSIONS = new Set([
  'd', 'i', 'o', 'u', 'x', 'X',
  'e', 'E', 'f', 'F', 'g', 'G', 'a', 'A',
  'c', 's', 'p', 'n', '%',
]);

/** Returns the call's argument expressions, or [] when there is no argument list. */
export function callArguments(call: SyntaxNode): SyntaxNode[] {
  const list =
    call.childForFieldName('arguments') ?? call.namedChild(1) ?? null;
  return list ? list.namedChildren : [];
}

export function callFunctionNode(call: SyntaxNode): SyntaxNode | undefined {
  return call.childForFieldName('function') ?? call.namedChild(0) ?? undefined;
}

/**
 * Parses the format string of a call. Only a single plain string literal is accepted;
 * concatenated literals and non-literals fail closed.
 */
export function parseCallFormat(
  call: SyntaxNode,
  formatIndex: number,
  mode: FormatMode,
): ParsedFormat | undefined {
  const literal = callArguments(call)[formatIndex];
  if (!literal || literal.type !== 'string_literal') {
    return undefined;
  }
  return parseFormatLiteral(literal, mode);
}

export function parseFormatLiteral(
  literal: SyntaxNode,
  mode: FormatMode,
): ParsedFormat {
  const text = literal.text;
  const open = text.indexOf('"');
  const close = text.lastIndexOf('"');
  if (open < 0 || close <= open) {
    return {
      literal,
      conversions: [],
      invalid: [],
      supported: false,
    };
  }

  const conversions: FormatConversion[] = [];
  const invalid: InvalidFormatSpecifier[] = [];
  let supported = true;
  let index = open + 1;

  while (index < close) {
    if (text[index] !== '%') {
      index++;
      continue;
    }

    const start = index;
    let cursor = index + 1;
    if (cursor >= close) {
      invalid.push({
        start,
        end: cursor,
        raw: text.slice(start, cursor),
        conversion: '',
      });
      supported = false;
      break;
    }
    if (text[cursor] === '%') {
      index = cursor + 1;
      continue;
    }

    let suppressed = false;
    let starWidth = false;
    let starPrecision = false;

    if (mode === 'scanf') {
      // In scanf a `*` directly after `%` suppresses assignment; it is not a width.
      if (text[cursor] === '*') {
        suppressed = true;
        cursor++;
      }
      while (cursor < close && isDigit(text[cursor])) {
        cursor++;
      }
    } else {
      while (cursor < close && PRINTF_FLAGS.has(text[cursor] ?? '')) {
        cursor++;
      }
      if (text[cursor] === '*') {
        starWidth = true;
        cursor++;
      } else {
        while (cursor < close && isDigit(text[cursor])) {
          cursor++;
        }
      }
      if (text[cursor] === '.') {
        cursor++;
        if (text[cursor] === '*') {
          starPrecision = true;
          cursor++;
        } else {
          while (cursor < close && isDigit(text[cursor])) {
            cursor++;
          }
        }
      }
    }

    const widthStart = start + 1;
    const lengthStart = cursor;
    let length = '';
    for (const modifier of LENGTH_MODIFIERS) {
      if (text.startsWith(modifier, cursor)) {
        length = modifier;
        cursor += modifier.length;
        break;
      }
    }

    if (cursor >= close) {
      invalid.push({
        start,
        end: cursor,
        raw: text.slice(start, cursor),
        conversion: '',
      });
      supported = false;
      break;
    }

    let conversion = text[cursor] ?? '';
    if (conversion === '[' && mode === 'scanf') {
      cursor++;
      if (text[cursor] === '^') {
        cursor++;
      }
      if (text[cursor] === ']') {
        cursor++;
      }
      while (cursor < close && text[cursor] !== ']') {
        cursor++;
      }
      if (cursor >= close) {
        supported = false;
        break;
      }
      cursor++;
      conversion = '[';
    } else {
      if (conversion === '$' || isDigit(conversion)) {
        // Positional parameters (`%2$d`) are outside the model.
        supported = false;
        break;
      }
      if (!LEGAL_CONVERSIONS.has(conversion)) {
        cursor++;
        invalid.push({
          start,
          end: cursor,
          raw: text.slice(start, cursor),
          conversion,
        });
        supported = false;
        break;
      }
      cursor++;
    }

    conversions.push({
      raw: text.slice(start, cursor),
      start,
      end: cursor,
      prefix: text.slice(start, lengthStart),
      length,
      conversion,
      width:
        mode === 'printf' || widthStart < lengthStart
          ? text.slice(widthStart, lengthStart) || undefined
          : undefined,
      starWidth,
      starPrecision,
      suppressed,
    });
    index = cursor;
  }

  return { literal, conversions, invalid, supported };
}

/**
 * Pairs conversions with value arguments. printf width/precision `*` consume an
 * argument of their own; scanf `%*d` consumes none.
 */
export function pairArguments(
  format: ParsedFormat,
  valueArguments: readonly SyntaxNode[],
  mode: FormatMode,
): PairedArgument[] {
  const pairs: PairedArgument[] = [];
  let cursor = 0;

  for (const conversion of format.conversions) {
    if (mode === 'printf') {
      const stars =
        (conversion.starWidth ? 1 : 0) + (conversion.starPrecision ? 1 : 0);
      cursor += stars;
    } else if (conversion.suppressed) {
      continue;
    }

    pairs.push({ conversion, argument: valueArguments[cursor] });
    cursor++;
  }

  return pairs;
}

export function expectedArgumentCount(
  format: ParsedFormat,
  mode: FormatMode,
): number {
  let count = 0;
  for (const conversion of format.conversions) {
    if (mode === 'printf') {
      count += 1;
      if (conversion.starWidth) {
        count++;
      }
      if (conversion.starPrecision) {
        count++;
      }
    } else if (!conversion.suppressed) {
      count++;
    }
  }
  return count;
}

export function rebuildConversion(
  conversion: FormatConversion,
  length: string,
  conversionChar: string,
): string {
  return `${conversion.prefix}${length}${conversionChar}`;
}

/** Absolute source range of a conversion specifier. */
export function conversionRange(
  text: string,
  literal: SyntaxNode,
  conversion: FormatConversion,
): Range {
  return rangeFromOffsets(
    text,
    literal.startIndex + conversion.start,
    literal.startIndex + conversion.end,
  );
}

/** Range of the comma and whitespace preceding `node`. */
export function precedingCommaOffset(
  text: string,
  node: SyntaxNode,
): number | undefined {
  let index = node.startIndex - 1;
  while (index >= 0 && /\s/.test(text[index] ?? '')) {
    index--;
  }
  return text[index] === ',' ? index : undefined;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}
