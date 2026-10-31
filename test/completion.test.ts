import { describe, expect, it } from 'vitest';
import { getCompletions, type CompletionCandidate } from '../src/core/completion';
import { SIGNATURES } from '../src/core/signatures';

const loadedContext = { loaded: true };

function at(marked: string): { text: string; line: number; character: number } {
  const index = marked.indexOf('|');
  if (index < 0) {
    throw new Error('Missing cursor marker "|" in test input');
  }

  const text = marked.slice(0, index) + marked.slice(index + 1);
  const before = marked.slice(0, index);
  const lines = before.split(/\r\n|\n|\r/);
  const last = lines[lines.length - 1] ?? '';

  return { text, line: lines.length - 1, character: last.length };
}

function complete(
  marked: string,
  ctx: { loaded: boolean } = loadedContext,
): CompletionCandidate[] {
  const { text, line, character } = at(marked);
  return getCompletions(text, line, character, ctx);
}

function labels(candidates: CompletionCandidate[]): string[] {
  return candidates.map((candidate) => candidate.label);
}

describe('getCompletions', () => {
  it('completes pr to printf with the snippet template', () => {
    const result = complete('pr|');

    expect(labels(result)).toEqual(['printf']);
    expect(result[0]?.insertText).toBe('printf("${1:%d}\\n", ${2:});');
    expect(result[0]?.filterText).toBe('printf');
    expect(result[0]?.range).toEqual({ line: 0, startChar: 0, endChar: 2 });
  });

  it('completes sca to scanf', () => {
    expect(labels(complete('sca|'))).toEqual(['scanf']);
  });

  it('returns at most 3 matches sorted by name', () => {
    const result = complete('str|');

    expect(labels(result)).toEqual(['strcat', 'strchr', 'strcmp']);
  });

  it('returns nothing for a single-character prefix', () => {
    expect(complete('x|')).toEqual([]);
  });

  it('returns nothing inside a line comment', () => {
    expect(complete('// pr|')).toEqual([]);
  });

  it('returns nothing inside a block comment', () => {
    expect(complete('/* pr| */')).toEqual([]);
  });

  it('returns nothing inside a multi-line block comment', () => {
    expect(complete('/*\npr|\n*/')).toEqual([]);
  });

  it('returns nothing inside a string literal', () => {
    expect(complete('char *s = "pr|";')).toEqual([]);
  });

  it('returns nothing inside a character literal', () => {
    expect(complete("char c = 'pr|';")).toEqual([]);
  });

  it('ignores comment markers that live inside a string literal', () => {
    expect(labels(complete('char *s = "// pr"; pr|'))).toEqual(['printf']);
  });

  it('respects escaped quotes inside string literals', () => {
    expect(complete('char *s = "a\\"pr|";')).toEqual([]);
  });

  it('returns nothing when the cursor is in the middle of an identifier', () => {
    expect(complete('pri|nt')).toEqual([]);
  });

  it('returns nothing when the prefix does not match any function', () => {
    expect(complete('zz|')).toEqual([]);
  });

  it('matches case-sensitively', () => {
    expect(complete('Pr|')).toEqual([]);
  });

  it('returns nothing when the signature table is not loaded', () => {
    expect(complete('pr|', { loaded: false })).toEqual([]);
  });

  it('returns nothing for an out-of-range line', () => {
    expect(getCompletions('pr', 1, 2, loadedContext)).toEqual([]);
  });

  it('returns nothing for an out-of-range character', () => {
    expect(getCompletions('pr', 0, 3, loadedContext)).toEqual([]);
  });

  it('returns nothing when the prefix starts with a digit', () => {
    expect(complete('123pr|')).toEqual([]);
  });

  it('finds the prefix on a later line and reports that line in the range', () => {
    const result = complete('int main() {\n  pr|\n}');

    expect(labels(result)).toEqual(['printf']);
    expect(result[0]?.range).toEqual({ line: 1, startChar: 2, endChar: 4 });
  });

  it('handles CRLF line endings', () => {
    const result = complete('int main(){\r\n  pr|\r\n}');

    expect(labels(result)).toEqual(['printf']);
    expect(result[0]?.range).toEqual({ line: 1, startChar: 2, endChar: 4 });
  });

  it('completes strn to the strn* functions', () => {
    expect(labels(complete('strn|'))).toEqual(['strncat', 'strncmp', 'strncpy']);
  });

  it('completes mem to the mem* functions', () => {
    expect(labels(complete('mem|'))).toEqual(['memcpy', 'memset']);
  });

  it('completes ge to getchar and gets in name order', () => {
    expect(labels(complete('ge|'))).toEqual(['getchar', 'gets']);
  });

  it('completes pu to putchar and puts in name order', () => {
    expect(labels(complete('pu|'))).toEqual(['putchar', 'puts']);
  });

  it('resumes completion after a closed block comment', () => {
    expect(labels(complete('/* pr */ pr|'))).toEqual(['printf']);
  });

  it('returns nothing for empty text', () => {
    expect(getCompletions('', 0, 0, loadedContext)).toEqual([]);
  });
});

describe('signature table', () => {
  const expectedNames = [
    'printf',
    'fprintf',
    'sprintf',
    'snprintf',
    'scanf',
    'fscanf',
    'sscanf',
    'gets',
    'fgets',
    'puts',
    'fputs',
    'putchar',
    'getchar',
    'strlen',
    'strcpy',
    'strncpy',
    'strcat',
    'strncat',
    'strcmp',
    'strncmp',
    'strchr',
    'strstr',
    'memset',
    'memcpy',
  ];

  it('contains exactly the stdio/string functions from the milestone list', () => {
    expect(SIGNATURES.map((signature) => signature.name).sort()).toEqual(
      [...expectedNames].sort(),
    );
  });

  it('keeps every snippet in VS Code placeholder syntax with no CJK text', () => {
    for (const signature of SIGNATURES) {
      expect(signature.snippet.startsWith(signature.name)).toBe(true);
      if (signature.minArgs > 0) {
        expect(signature.snippet).toContain('${1:');
      }
      expect(signature.snippet).not.toMatch(/[㐀-鿿]/);
    }
  });

  it('uses manifest argument counts consistent with the parameter list', () => {
    for (const signature of SIGNATURES) {
      if (signature.variadic) {
        expect(signature.minArgs).toBeGreaterThan(0);
        expect(signature.minArgs).toBeLessThanOrEqual(signature.params.length);
      } else {
        expect(signature.minArgs).toBe(signature.params.length);
      }
    }
  });
});
