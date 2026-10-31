import type { Issue, Rule } from './types';
import {
  lineBounds,
  makeIssue,
  positionAt,
  type SyntaxNode,
} from './utils';

const STATEMENT_PARENTS = new Set(['declaration', 'expression_statement']);

const CONTROL_KEYWORDS = new Set([
  'if',
  'else',
  'while',
  'for',
  'switch',
  'case',
  'default',
  'do',
  'struct',
  'union',
  'enum',
  'typedef',
]);

const SENTENCE_END = /[A-Za-z0-9)\]'"]/;
const TERMINATOR = /[;{},:\\]/;

interface LineScan {
  /** Offset just past the last code character (exclusive); comments are ignored. */
  codeEnd: number;
  /** `(`/`)` and `[`/`]` are balanced within this line. */
  balanced: boolean;
  /** This line leaves an unclosed block comment open. */
  inBlockComment: boolean;
}

export const rule: Rule = {
  id: 'missing-semicolon',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    const issues: Issue[] = [];
    const seen = new Set<string>();

    const add = (issue: Issue): void => {
      const key = `${issue.range.startLine}:${issue.range.startChar}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(issue);
      }
    };

    const visit = (node: SyntaxNode): void => {
      if (node.isMissing() && node.type === ';') {
        const issue = checkMissing(ctx.text, node);
        if (issue) {
          add(issue);
        }
      }
      for (const child of node.children) {
        visit(child);
      }
    };

    visit(ctx.root);

    // A missing `;` can make the parser merge two lines into one statement, leaving no
    // missing-`;` node behind. Fall back to line scanning, but only for broken trees.
    if (ctx.root.hasError()) {
      for (const issue of scanLines(ctx.text)) {
        add(issue);
      }
    }

    return issues;
  },
};

function checkMissing(text: string, node: SyntaxNode): Issue | undefined {
  if (!nearestAncestorIn(node, STATEMENT_PARENTS)) {
    return undefined;
  }

  const insertOffset = node.startIndex;
  const position = node.startPosition;
  if (insertOffset <= 0) {
    return undefined;
  }

  // The guard looks at the last code character before the insertion point.
  let previous = insertOffset - 1;
  while (previous >= 0 && /\s/.test(text[previous] ?? '')) {
    previous--;
  }
  if (previous < 0) {
    return undefined;
  }

  const previousPosition = positionAt(text, previous);
  if (previousPosition.line !== position.row) {
    return undefined;
  }

  const previousChar = text[previous];
  if (previousChar === ';' || previousChar === '{' || previousChar === '}') {
    return undefined;
  }

  const line = lineBounds(text, position.row);
  if (line && /^\s*#/.test(line.text)) {
    return undefined;
  }

  const range = {
    startLine: position.row,
    startChar: position.column,
    endLine: position.row,
    endChar: position.column,
  };

  return makeIssue(rule, range, "Missing ';'", "缺少 ';'", {
    range,
    newText: ';',
  });
}

function scanLines(text: string): Issue[] {
  const lines = text.split(/\r\n|\r|\n/);
  const issues: Issue[] = [];
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    const scan = scanLine(raw, inBlockComment);
    inBlockComment = scan.inBlockComment;

    if (scan.codeEnd === 0) {
      continue;
    }

    const code = raw.slice(0, scan.codeEnd);
    const trailing = code.trimEnd();
    if (trailing.length === 0) {
      continue;
    }

    const last = trailing[trailing.length - 1] ?? '';
    if (!SENTENCE_END.test(last) || TERMINATOR.test(last)) {
      continue;
    }
    if (!scan.balanced) {
      continue;
    }

    const first = trailing.trimStart();
    if (first.startsWith('#')) {
      continue;
    }
    const keyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(first)?.[0];
    if (keyword !== undefined && CONTROL_KEYWORDS.has(keyword)) {
      continue;
    }

    const next = nextCodeStart(lines, index + 1);
    if (next === '{' || next === '}' || next === '#') {
      continue;
    }

    const range = {
      startLine: index,
      startChar: trailing.length,
      endLine: index,
      endChar: trailing.length,
    };
    issues.push(
      makeIssue(rule, range, "Missing ';'", "缺少 ';'", {
        range,
        newText: ';',
      }),
    );
  }

  return issues;
}

function nextCodeStart(lines: readonly string[], from: number): string | undefined {
  for (let index = from; index < lines.length; index++) {
    const trimmed = (lines[index] ?? '').trimStart();
    if (trimmed.length > 0) {
      return trimmed[0];
    }
  }
  return undefined;
}

function scanLine(line: string, startInComment: boolean): LineScan {
  let index = 0;
  let inBlockComment = startInComment;

  if (inBlockComment) {
    const close = line.indexOf('*/');
    if (close < 0) {
      return { codeEnd: 0, balanced: true, inBlockComment: true };
    }
    index = close + 2;
    inBlockComment = false;
  }

  let parens = 0;
  let brackets = 0;
  let codeEnd = 0;
  let state: 'code' | 'string' | 'char' = 'code';

  for (; index < line.length; index++) {
    const char = line[index] ?? '';

    if (state !== 'code') {
      const closing = state === 'string' ? '"' : "'";
      if (char === '\\') {
        index++;
        codeEnd = Math.min(index + 1, line.length);
      } else if (char === closing) {
        state = 'code';
        codeEnd = index + 1;
      } else if (!/\s/.test(char)) {
        codeEnd = index + 1;
      }
      continue;
    }

    if (char === '/' && line[index + 1] === '/') {
      break;
    }
    if (char === '/' && line[index + 1] === '*') {
      const close = line.indexOf('*/', index + 2);
      if (close < 0) {
        inBlockComment = true;
        break;
      }
      index = close + 1;
      continue;
    }

    if (char === '"' || char === "'") {
      state = char === '"' ? 'string' : 'char';
      codeEnd = index + 1;
      continue;
    }

    if (char === '(') {
      parens++;
    } else if (char === ')') {
      parens--;
    } else if (char === '[') {
      brackets++;
    } else if (char === ']') {
      brackets--;
    }

    if (!/\s/.test(char)) {
      codeEnd = index + 1;
    }
  }

  return {
    codeEnd,
    balanced: parens === 0 && brackets === 0,
    inBlockComment,
  };
}

function nearestAncestorIn(
  node: SyntaxNode,
  types: ReadonlySet<string>,
): SyntaxNode | undefined {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (types.has(current.type)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}
