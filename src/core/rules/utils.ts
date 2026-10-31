import type Parser from 'web-tree-sitter';
import type { Channel, Fix, Issue, Range, Rule } from './types';

export type SyntaxNode = Parser.SyntaxNode;

export interface LineBounds {
  start: number;
  end: number;
  text: string;
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

export function makeIssue(
  rule: Rule,
  range: Range,
  message: string,
  messageZh: string,
  fix?: Fix,
  channel: Channel = rule.channel,
): Issue {
  const issue: Issue = {
    ruleId: rule.id,
    channel,
    severity: rule.severity,
    range,
    message,
    messageZh,
  };
  if (fix) {
    issue.fix = fix;
  }
  return issue;
}

export function rangeFromNode(node: SyntaxNode): Range {
  return {
    startLine: node.startPosition.row,
    startChar: node.startPosition.column,
    endLine: node.endPosition.row,
    endChar: node.endPosition.column,
  };
}

export function positionAt(
  text: string,
  offset: number,
): { line: number; char: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < clamped; index++) {
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

  return { line, char: clamped - lineStart };
}

export function rangeFromOffsets(text: string, start: number, end: number): Range {
  const from = positionAt(text, start);
  const to = positionAt(text, end);
  return {
    startLine: from.line,
    startChar: from.char,
    endLine: to.line,
    endChar: to.char,
  };
}

export function lineBounds(text: string, line: number): LineBounds | undefined {
  if (line < 0) {
    return undefined;
  }

  let currentLine = 0;
  let start = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code !== 10 && code !== 13) {
      continue;
    }

    if (currentLine === line) {
      return { start, end: index, text: text.slice(start, index) };
    }

    if (code === 13 && text.charCodeAt(index + 1) === 10) {
      index++;
    }

    currentLine++;
    start = index + 1;
  }

  return currentLine === line
    ? { start, end: text.length, text: text.slice(start) }
    : undefined;
}

export function isSingleLine(node: SyntaxNode): boolean {
  return node.startPosition.row === node.endPosition.row;
}

/** Depth-first collection that includes `node` itself when it matches. */
export function collectNodes(
  node: SyntaxNode,
  types: string | readonly string[],
): SyntaxNode[] {
  const wanted = new Set(typeof types === 'string' ? [types] : types);
  const found: SyntaxNode[] = [];

  const visit = (current: SyntaxNode): void => {
    if (wanted.has(current.type)) {
      found.push(current);
    }
    for (const child of current.namedChildren) {
      visit(child);
    }
  };

  visit(node);
  return found;
}

export function unwrapParentheses(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = current.namedChild(0);
    if (!inner) {
      break;
    }
    current = inner;
  }
  return current;
}

/**
 * Replaces comments and literal contents with spaces while preserving offsets and
 * newlines, so regex scans cannot match text that is not code.
 */
export function maskNonCode(text: string): string {
  const chars = text.split('');
  let state: 'code' | 'lineComment' | 'blockComment' | 'string' | 'char' = 'code';

  for (let index = 0; index < chars.length; index++) {
    const ch = chars[index];
    const next = chars[index + 1];

    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          chars[index] = ' ';
          chars[index + 1] = ' ';
          state = 'lineComment';
          index++;
        } else if (ch === '/' && next === '*') {
          chars[index] = ' ';
          chars[index + 1] = ' ';
          state = 'blockComment';
          index++;
        } else if (ch === '"') {
          chars[index] = ' ';
          state = 'string';
        } else if (ch === "'") {
          chars[index] = ' ';
          state = 'char';
        }
        break;

      case 'lineComment':
        if (ch === '\n' || ch === '\r') {
          state = 'code';
        } else {
          chars[index] = ' ';
        }
        break;

      case 'blockComment':
        if (ch === '*' && next === '/') {
          chars[index] = ' ';
          chars[index + 1] = ' ';
          state = 'code';
          index++;
        } else if (ch !== '\n' && ch !== '\r') {
          chars[index] = ' ';
        }
        break;

      case 'string':
      case 'char': {
        if (ch === '\\') {
          chars[index] = ' ';
          if (next !== undefined && next !== '\n' && next !== '\r') {
            chars[index + 1] = ' ';
            index++;
          }
        } else if (ch === '\n' || ch === '\r') {
          // Unterminated literal; treat the next line as code again.
          state = 'code';
        } else {
          const closing = state === 'string' ? '"' : "'";
          chars[index] = ' ';
          if (ch === closing) {
            state = 'code';
          }
        }
        break;
      }
    }
  }

  return chars.join('');
}

export interface WriteSite {
  name: string;
  node: SyntaxNode;
}

/**
 * Identifiers assigned directly (`i = ...`, `i++`). Array/field targets are ignored:
 * `a[i] = x` reads `i`, it does not update it.
 */
export function writeSites(node: SyntaxNode): WriteSite[] {
  const sites: WriteSite[] = [];

  const record = (target: SyntaxNode | null): void => {
    if (!target) {
      return;
    }
    const unwrapped = unwrapParentheses(target);
    if (unwrapped.type === 'identifier') {
      sites.push({ name: unwrapped.text, node: unwrapped });
    }
  };

  const visit = (current: SyntaxNode): void => {
    if (current.type === 'assignment_expression') {
      record(current.childForFieldName('left'));
    } else if (current.type === 'update_expression') {
      record(
        current.childForFieldName('argument') ?? current.namedChild(0) ?? null,
      );
    }
    for (const child of current.namedChildren) {
      visit(child);
    }
  };

  visit(node);
  return sites;
}

export function declaratorIdentifier(
  node: SyntaxNode | null,
): SyntaxNode | undefined {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === 'identifier') {
      return current;
    }
    const next: SyntaxNode | null =
      current.childForFieldName('declarator') ?? current.namedChild(0);
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return undefined;
}

/** Names introduced by a declaration node (`int i = 0, j;` -> i, j). */
export function declaredIdentifiers(node: SyntaxNode | null): SyntaxNode[] {
  if (!node || node.type !== 'declaration') {
    return [];
  }

  const names: SyntaxNode[] = [];
  for (const child of node.namedChildren) {
    if (!DECLARATOR_TYPES.has(child.type)) {
      continue;
    }
    const identifier = declaratorIdentifier(child);
    if (identifier) {
      names.push(identifier);
    }
  }
  return names;
}

export function nearestAncestor(
  node: SyntaxNode,
  type: string,
): SyntaxNode | undefined {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === type) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}
