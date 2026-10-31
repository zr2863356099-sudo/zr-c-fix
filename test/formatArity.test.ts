import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFormatArityEdits } from '../src/core/fixes/formatArity';
import type { CParser } from '../src/core/parser';
import { callArguments } from '../src/core/rules/format-string';
import { callSites } from '../src/core/rules/library';
import { createTestParser } from './helpers/parser';

let parser: CParser | undefined;

beforeAll(async () => {
  parser = await createTestParser();
});

afterAll(() => {
  parser?.dispose();
  parser = undefined;
});

describe('buildFormatArityEdits', () => {
  it('deletes a trailing argument with the preceding comma', () => {
    const source = 'int main(){ printf("%d", 1, 2); return 0; }\n';
    const tree = parser!.parse(source);

    try {
      const site = callSites(tree.rootNode)[0]!;
      const args = callArguments(site.call);
      const edits = buildFormatArityEdits(site.call, args[0]!, args[2]!, '%d');

      expect(edits.dropArgument).toEqual({
        range: {
          startLine: 0,
          startChar: source.indexOf(', 2'),
          endLine: 0,
          endChar: source.indexOf('2') + 1,
        },
        newText: '',
      });
    } finally {
      tree.delete();
    }
  });

  it('deletes a middle argument with the preceding comma', () => {
    const source = 'int main(){ printf("%d", 1, 2, 3); return 0; }\n';
    const tree = parser!.parse(source);

    try {
      const site = callSites(tree.rootNode)[0]!;
      const args = callArguments(site.call);
      // args = ["%d", 1, 2, 3]; the middle extra argument is `2`.
      const edits = buildFormatArityEdits(site.call, args[0]!, args[2]!, '%d');

      expect(edits.dropArgument).toEqual({
        range: {
          startLine: 0,
          startChar: source.indexOf(', 2'),
          endLine: 0,
          endChar: source.indexOf('2') + 1,
        },
        newText: '',
      });
    } finally {
      tree.delete();
    }
  });

  it('deletes the first of two arguments together with the following comma', () => {
    const source = 'int main(){ f(1, 2); return 0; }\n';
    const tree = parser!.parse(source);

    try {
      const site = callSites(tree.rootNode)[0]!;
      const args = callArguments(site.call);
      const edits = buildFormatArityEdits(site.call, args[0]!, args[0]!, '%d');

      expect(edits.dropArgument).toEqual({
        range: {
          startLine: 0,
          startChar: source.indexOf('1'),
          endLine: 0,
          endChar: source.indexOf('2'),
        },
        newText: '',
      });
    } finally {
      tree.delete();
    }
  });

  it('inserts the specifier before the closing quote', () => {
    const source = 'int main(){ printf("%d", x); return 0; }\n';
    const tree = parser!.parse(source);

    try {
      const site = callSites(tree.rootNode)[0]!;
      const args = callArguments(site.call);
      const edits = buildFormatArityEdits(site.call, args[0]!, args[1]!, '%c');
      const closeQuote = source.indexOf('"', source.indexOf('"') + 1);

      expect(edits.addSpecifier).toEqual({
        range: {
          startLine: 0,
          startChar: closeQuote,
          endLine: 0,
          endChar: closeQuote,
        },
        newText: '%c',
      });
    } finally {
      tree.delete();
    }
  });
});
