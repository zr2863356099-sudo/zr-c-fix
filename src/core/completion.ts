import { SIGNATURES } from './signatures';

export interface CompletionRange {
  line: number;
  startChar: number;
  endChar: number;
}

export interface CompletionCandidate {
  label: string;
  insertText: string;
  filterText: string;
  range: CompletionRange;
}

const MIN_PREFIX_LENGTH = 2;
const MAX_RESULTS = 3;

type LexState = 'code' | 'lineComment' | 'blockComment' | 'string' | 'char';

interface LineBounds {
  start: number;
  end: number;
}

export function getCompletions(
  text: string,
  line: number,
  character: number,
  ctx: { loaded: boolean },
): CompletionCandidate[] {
  if (!ctx.loaded) {
    return [];
  }

  const bounds = getLineBounds(text, line);
  if (!bounds || character < 0 || character > bounds.end - bounds.start) {
    return [];
  }

  const lineText = text.slice(bounds.start, bounds.end);

  // Refuse mid-identifier cursors (`pri|nt`): replacing only the prefix would leave the
  // trailing characters behind, and guessing how much of the word to replace is unsafe.
  if (isIdentifierChar(lineText[character])) {
    return [];
  }

  const startChar = findIdentifierStart(lineText, character);
  if (startChar === undefined) {
    return [];
  }

  const prefix = lineText.slice(startChar, character);
  if (prefix.length < MIN_PREFIX_LENGTH) {
    return [];
  }

  if (!isInsideCode(text, bounds.start + character)) {
    return [];
  }

  return SIGNATURES.filter((signature) => signature.name.startsWith(prefix))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_RESULTS)
    .map((signature) => ({
      label: signature.name,
      insertText: signature.snippet,
      filterText: signature.name,
      range: { line, startChar, endChar: character },
    }));
}

function getLineBounds(text: string, line: number): LineBounds | undefined {
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
      return { start, end: index };
    }

    if (code === 13 && text.charCodeAt(index + 1) === 10) {
      index++;
    }

    currentLine++;
    start = index + 1;
  }

  return currentLine === line ? { start, end: text.length } : undefined;
}

function findIdentifierStart(lineText: string, character: number): number | undefined {
  let start = character;
  while (start > 0 && isIdentifierChar(lineText[start - 1])) {
    start--;
  }

  if (start === character) {
    return undefined;
  }

  const first = lineText[start];
  return first !== undefined && /[A-Za-z_]/.test(first) ? start : undefined;
}

function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Scans the document from the start up to the cursor and reports whether the cursor is in
 * plain code. Strings, character literals, line comments and block comments all disable
 * completion.
 */
function isInsideCode(text: string, offset: number): boolean {
  let state: LexState = 'code';

  for (let index = 0; index < offset; index++) {
    const ch = text[index];
    const next = text[index + 1];

    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          state = 'lineComment';
          index++;
        } else if (ch === '/' && next === '*') {
          state = 'blockComment';
          index++;
        } else if (ch === '"') {
          state = 'string';
        } else if (ch === "'") {
          state = 'char';
        }
        break;

      case 'lineComment':
        if (ch === '\n' || ch === '\r') {
          state = 'code';
        }
        break;

      case 'blockComment':
        if (ch === '*' && next === '/') {
          state = 'code';
          index++;
        }
        break;

      case 'string':
      case 'char':
        if (ch === '\\') {
          index++;
        } else if (ch === '\n' || ch === '\r') {
          // Unterminated literal at end of line; treat the next line as code.
          state = 'code';
        } else if (state === 'string' && ch === '"') {
          state = 'code';
        } else if (state === 'char' && ch === "'") {
          state = 'code';
        }
        break;
    }
  }

  return state === 'code';
}
