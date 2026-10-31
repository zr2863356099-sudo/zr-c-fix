import type { BaseType, TypeInfo } from '../types';
import { collectNodes, type SyntaxNode } from './utils';

export interface DefineTable {
  /** Object-like macro name -> replacement text. */
  values: Map<string, string>;
  /** Every macro name, including function-like macros. */
  names: Set<string>;
}

/** Sizeof table for the Windows x64 target described in the milestone. */
const BASE_SIZES: Readonly<Partial<Record<BaseType, number>>> = {
  char: 1,
  short: 2,
  int: 4,
  unsigned: 4,
  signed: 4,
  long: 4,
  ulong: 4,
  longlong: 8,
  ulonglong: 8,
  float: 4,
  double: 8,
};

const POINTER_SIZE = 8;

export function sizeofBase(base: BaseType): number | undefined {
  return BASE_SIZES[base];
}

export function sizeofType(type: TypeInfo): number | undefined {
  if (type.ptr > 0) {
    return POINTER_SIZE;
  }
  return sizeofBase(type.base);
}

export function collectDefines(root: SyntaxNode): DefineTable {
  const values = new Map<string, string>();
  const names = new Set<string>();

  for (const node of collectNodes(root, ['preproc_def', 'preproc_function_def'])) {
    const nameNode = node.namedChildren.find(
      (child) => child.type === 'identifier',
    );
    if (!nameNode) {
      continue;
    }
    names.add(nameNode.text);
    if (node.type !== 'preproc_def') {
      continue;
    }
    const valueNode = node.namedChildren.find(
      (child) => child.type === 'preproc_arg',
    );
    if (valueNode) {
      values.set(nameNode.text, valueNode.text.trim());
    }
  }

  return { values, names };
}

/**
 * Evaluates a C constant expression made of integer literals, same-file object-like
 * macros and the usual arithmetic/bitwise operators. Anything else returns undefined.
 */
export function evalConstExpression(
  node: SyntaxNode,
  defines: DefineTable,
): number | undefined {
  return evalConstText(node.text, defines.values);
}

export function evalConstText(
  source: string,
  defines: ReadonlyMap<string, string>,
): number | undefined {
  const tokens = tokenize(source);
  if (!tokens) {
    return undefined;
  }
  const parser = new ConstParser(tokens, defines, new Set());
  const value = parser.parse();
  return parser.atEnd() ? value : undefined;
}

interface Token {
  kind: 'number' | 'identifier' | 'operator';
  value: string;
}

function tokenize(source: string): Token[] | undefined {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index] ?? '';
    if (/\s/.test(character)) {
      index++;
      continue;
    }

    if (isDigit(character)) {
      const rest = source.slice(index);
      let match: RegExpExecArray | null;
      if (rest.startsWith('0x') || rest.startsWith('0X')) {
        match = /^0[xX][0-9a-fA-F]+[uUlL]*/.exec(rest);
      } else if (character === '0' && isDigit(source[index + 1])) {
        match = /^0[0-7]+[uUlL]*/.exec(rest);
        // `08` is not a valid C constant; the octal match stops at the 8.
        if (match && match[0].replace(/[uUlL]+$/, '').length < digitsEnd(rest)) {
          return undefined;
        }
      } else {
        match = /^[0-9]+[uUlL]*/.exec(rest);
      }
      if (!match) {
        return undefined;
      }
      tokens.push({ kind: 'number', value: match[0] });
      index += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
      if (!match) {
        return undefined;
      }
      tokens.push({ kind: 'identifier', value: match[0] });
      index += match[0].length;
      continue;
    }

    const two = source.slice(index, index + 2);
    if (two === '<<' || two === '>>') {
      tokens.push({ kind: 'operator', value: two });
      index += 2;
      continue;
    }
    if ('+-*/%&|^~!()'.includes(character)) {
      tokens.push({ kind: 'operator', value: character });
      index++;
      continue;
    }
    return undefined;
  }

  return tokens;
}

function digitsEnd(rest: string): number {
  let end = 0;
  while (end < rest.length && isDigit(rest[end])) {
    end++;
  }
  return end;
}

class ConstParser {
  private cursor = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly defines: ReadonlyMap<string, string>,
    private readonly resolving: Set<string>,
    private readonly depth = 0,
  ) {}

  parse(): number | undefined {
    return this.parseBitOr();
  }

  atEnd(): boolean {
    return this.cursor === this.tokens.length;
  }

  private parseBitOr(): number | undefined {
    return this.fold(this.parseBitXor(), ['|']);
  }

  private parseBitXor(): number | undefined {
    return this.fold(this.parseBitAnd(), ['^']);
  }

  private parseBitAnd(): number | undefined {
    return this.fold(this.parseShift(), ['&']);
  }

  private parseShift(): number | undefined {
    return this.fold(this.parseAdditive(), ['<<', '>>']);
  }

  private parseAdditive(): number | undefined {
    return this.fold(this.parseMultiplicative(), ['+', '-']);
  }

  private parseMultiplicative(): number | undefined {
    return this.fold(this.parseUnary(), ['*', '/', '%']);
  }

  private fold(
    first: number | undefined,
    operators: readonly string[],
  ): number | undefined {
    if (first === undefined) {
      return undefined;
    }
    let value: number | undefined = first;

    for (;;) {
      const operator = this.peek();
      if (!operator || operator.kind !== 'operator' || !operators.includes(operator.value)) {
        return value;
      }
      this.cursor++;
      const right = this.parseOperandFor(operators);
      if (right === undefined) {
        return undefined;
      }
      value = applyOperator(value, right, operator.value);
      if (value === undefined) {
        return undefined;
      }
    }
  }

  private parseOperandFor(operators: readonly string[]): number | undefined {
    // Precedence is encoded by the call sites above; this hook exists so fold() can
    // recurse at the right level.
    switch (operators[0]) {
      case '|':
        return this.parseBitXor();
      case '^':
        return this.parseBitAnd();
      case '&':
        return this.parseShift();
      case '<<':
      case '>>':
        return this.parseAdditive();
      case '+':
      case '-':
        return this.parseMultiplicative();
      default:
        return this.parseUnary();
    }
  }

  private parseUnary(): number | undefined {
    const token = this.peek();
    if (!token) {
      return undefined;
    }
    if (token.kind === 'operator') {
      if (token.value === '(') {
        this.cursor++;
        const value = this.parseBitOr();
        if (this.peek()?.value !== ')') {
          return undefined;
        }
        this.cursor++;
        return value;
      }
      if (token.value === '+' || token.value === '-' || token.value === '~' || token.value === '!') {
        this.cursor++;
        const operand = this.parseUnary();
        if (operand === undefined) {
          return undefined;
        }
        switch (token.value) {
          case '-':
            return -operand;
          case '~':
            return ~operand;
          case '!':
            return operand === 0 ? 1 : 0;
          default:
            return operand;
        }
      }
      return undefined;
    }

    if (token.kind === 'number') {
      this.cursor++;
      return parseIntegerToken(token.value);
    }

    if (token.kind === 'identifier') {
      this.cursor++;
      return this.resolveDefine(token.value);
    }

    return undefined;
  }

  private resolveDefine(name: string): number | undefined {
    if (this.resolving.has(name) || this.depth > 16) {
      return undefined;
    }
    const value = this.defines.get(name);
    if (value === undefined) {
      return undefined;
    }
    const tokens = tokenize(value);
    if (!tokens) {
      return undefined;
    }
    const nextResolving = new Set(this.resolving);
    nextResolving.add(name);
    const parser = new ConstParser(tokens, this.defines, nextResolving, this.depth + 1);
    const result = parser.parse();
    return parser.atEnd() ? result : undefined;
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }
}

function applyOperator(
  left: number,
  right: number,
  operator: string,
): number | undefined {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? undefined : Math.trunc(left / right);
    case '%':
      return right === 0 ? undefined : left % right;
    case '<<':
      return left << right;
    case '>>':
      return left >> right;
    case '&':
      return left & right;
    case '|':
      return left | right;
    case '^':
      return left ^ right;
    default:
      return undefined;
  }
}

function parseIntegerToken(text: string): number | undefined {
  const normalized = text.replace(/[uUlL]+$/, '');
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(normalized)) {
    value = Number.parseInt(normalized.slice(2), 16);
  } else if (/^0[0-7]+$/.test(normalized)) {
    value = Number.parseInt(normalized.slice(1), 8);
  } else if (/^[0-9]+$/.test(normalized)) {
    value = Number.parseInt(normalized, 10);
  } else {
    return undefined;
  }
  return Number.isSafeInteger(value) ? value : undefined;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}
