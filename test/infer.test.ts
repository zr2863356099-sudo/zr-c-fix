import type Parser from 'web-tree-sitter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatType, inferType, typeFingerprint } from '../src/core/infer';
import type { CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import type { TypeInfo } from '../src/core/types';
import { createTestParser } from './helpers/parser';

let parser: CParser | undefined;
const trees: Parser.Tree[] = [];

beforeAll(async () => {
  parser = await createTestParser();
});

afterAll(() => {
  for (const tree of trees) {
    tree.delete();
  }
  parser?.dispose();
});

function parse(source: string): Parser.Tree {
  if (!parser) {
    throw new Error('C parser was not initialized');
  }
  const tree = parser.parse(source);
  trees.push(tree);
  return tree;
}

function findProbeValue(root: Parser.SyntaxNode): Parser.SyntaxNode {
  for (const init of root.descendantsOfType('init_declarator')) {
    const declarator = init.childForFieldName('declarator');
    if (declarator?.text === '__probe') {
      const value = init.childForFieldName('value');
      if (value) {
        return value;
      }
    }
  }
  throw new Error('probe initializer not found');
}

function inferExpression(declarations: string, expression: string): TypeInfo {
  const source = `${declarations}\nint __probe = ${expression};`;
  const tree = parse(source);
  const table = buildSymbolTable(tree.rootNode, source);
  return inferType(findProbeValue(tree.rootNode), table);
}

function fingerprint(source: string, names: string[]): string {
  const tree = parse(source);
  return typeFingerprint(buildSymbolTable(tree.rootNode, source), names);
}

describe('inferType literals', () => {
  it('infers identifiers from the symbol table', () => {
    expect(inferExpression('int x;', 'x')).toMatchObject({ base: 'int', ptr: 0 });
  });

  it('returns unknown for identifiers missing from the table', () => {
    expect(inferExpression('', 'missing').base).toBe('unknown');
  });

  it('infers integer literals as int', () => {
    expect(inferExpression('', '42').base).toBe('int');
  });

  it('does not mistake hex integers for floats', () => {
    expect(inferExpression('', '0x1f').base).toBe('int');
  });

  it('infers floating literals as double', () => {
    expect(inferExpression('', '3.14').base).toBe('double');
    expect(inferExpression('', '1e3').base).toBe('double');
  });

  it('infers character literals as char', () => {
    expect(inferExpression('', "'x'").base).toBe('char');
  });

  it('infers string literals as char* with the array length kept', () => {
    expect(inferExpression('', '"abc"')).toMatchObject({
      base: 'char',
      ptr: 1,
      dims: [4],
    });
  });

  it('counts escape sequences as one character in string literals', () => {
    expect(inferExpression('', '"a\\nb"')).toMatchObject({
      base: 'char',
      ptr: 1,
      dims: [4],
    });
  });
});

describe('inferType operators', () => {
  it('adds one pointer level for address-of', () => {
    expect(inferExpression('int x;', '&x')).toMatchObject({
      base: 'int',
      ptr: 1,
    });
  });

  it('removes one pointer level for dereference', () => {
    expect(inferExpression('int *p;', '*p')).toMatchObject({
      base: 'int',
      ptr: 0,
    });
    expect(inferExpression('char **p;', '*p')).toMatchObject({
      base: 'char',
      ptr: 1,
    });
  });

  it('returns unknown when dereferencing a non-pointer', () => {
    expect(inferExpression('int x;', '*x').base).toBe('unknown');
  });

  it('indexes arrays down to the element type', () => {
    expect(inferExpression('int a[10];', 'a[0]')).toMatchObject({
      base: 'int',
      ptr: 0,
    });
  });

  it('indexes pointers down one level', () => {
    expect(inferExpression('char *p;', 'p[0]')).toMatchObject({
      base: 'char',
      ptr: 0,
    });
  });

  it('keeps the pointer level when indexing an array of pointers', () => {
    expect(inferExpression('double *q[5];', 'q[0]')).toMatchObject({
      base: 'double',
      ptr: 1,
    });
  });

  it('peels one dimension per subscript on a 2-D array', () => {
    expect(inferExpression('int m[3][4];', 'm[0]')).toMatchObject({
      base: 'int',
      ptr: 0,
      dims: [4],
    });
    expect(inferExpression('int m[3][4];', 'm[0][1]')).toMatchObject({
      base: 'int',
      ptr: 0,
    });
    expect(inferExpression('int m[3][4];', 'm[0][1]').dims).toBeUndefined();
  });

  it('promotes int arithmetic to int', () => {
    expect(inferExpression('int a; int b;', 'a + b')).toMatchObject({
      base: 'int',
      ptr: 0,
    });
  });

  it('promotes int with double to double', () => {
    expect(inferExpression('int a; double d;', 'a + d').base).toBe('double');
  });

  it('promotes int with float to float', () => {
    expect(inferExpression('float f;', 'f + 1').base).toBe('float');
  });

  it('promotes char arithmetic to int', () => {
    expect(inferExpression('char c;', 'c + c').base).toBe('int');
  });

  it('applies unsigned rank rules for size_t arithmetic', () => {
    expect(inferExpression('size_t n;', 'n + 1').base).toBe('ulong');
  });

  it('lets a higher-ranked operand win', () => {
    expect(inferExpression('unsigned u; long l;', 'u + l').base).toBe('long');
  });

  it('treats comparisons as int', () => {
    expect(inferExpression('int x; int y;', 'x < y').base).toBe('int');
  });

  it('fails closed on pointer arithmetic', () => {
    expect(inferExpression('int *p;', 'p + 1').base).toBe('unknown');
  });

  it('fails closed on array arithmetic', () => {
    expect(inferExpression('int a[10];', 'a + 1').base).toBe('unknown');
  });

  it('unwraps parenthesized expressions', () => {
    expect(inferExpression('int x;', '(x)').base).toBe('int');
  });

  it('uses the cast type', () => {
    expect(inferExpression('', '(double)1').base).toBe('double');
    expect(inferExpression('int *p;', '(char *)p')).toMatchObject({
      base: 'char',
      ptr: 1,
    });
  });
});

describe('inferType calls and sizeof', () => {
  it('uses the built-in return type for known calls', () => {
    expect(inferExpression('', 'printf("%d", 1)').base).toBe('int');
  });

  it('types strlen as unsigned long (size_t)', () => {
    expect(inferExpression('char *s;', 'strlen(s)').base).toBe('ulong');
  });

  it('returns unknown for functions outside the signature table', () => {
    expect(inferExpression('', 'mystery(1)').base).toBe('unknown');
  });

  it('types sizeof as unsigned long', () => {
    expect(inferExpression('', 'sizeof(int)').base).toBe('ulong');
  });
});

describe('typeFingerprint', () => {
  it('sorts names and deduplicates them', () => {
    expect(fingerprint('int a; double b;', ['b', 'a', 'b'])).toBe(
      'a:int,b:double',
    );
  });

  it('marks missing symbols with a question mark', () => {
    expect(fingerprint('int a;', ['zz'])).toBe('zz:?');
  });

  it('renders pointer and array signatures', () => {
    expect(fingerprint('char buf[10]; double *q;', ['q', 'buf'])).toBe(
      'buf:char[10],q:double*',
    );
  });

  it('renders every array dimension', () => {
    expect(fingerprint('int m[3][4];', ['m'])).toBe('m:int[3][4]');
    expect(formatType({ base: 'int', ptr: 0, dims: [3, 4] })).toBe('int[3][4]');
    expect(formatType({ base: 'char', ptr: 1, dims: [10] })).toBe('char*[10]');
  });

  it('changes the fingerprint when an inner dimension changes', () => {
    expect(fingerprint('int m[3][4];', ['m'])).not.toBe(
      fingerprint('int m[3][5];', ['m']),
    );
  });

  it('changes when a declaration changes type', () => {
    const before = fingerprint('int x;', ['x']);
    const after = fingerprint('double x;', ['x']);

    expect(before).toBe('x:int');
    expect(after).toBe('x:double');
    expect(after).not.toBe(before);
  });

  it('distinguishes unknown types from missing symbols', () => {
    expect(fingerprint('dou x;', ['x', 'y'])).toBe('x:unknown,y:?');
  });
});
