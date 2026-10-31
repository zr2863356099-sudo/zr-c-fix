import type Parser from 'web-tree-sitter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CParser } from '../src/core/parser';
import { buildSymbolTable, type SymbolTable } from '../src/core/symbols';
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

function build(source: string): SymbolTable {
  return buildSymbolTable(parse(source).rootNode, source);
}

function identifiers(root: Parser.SyntaxNode, name: string): Parser.SyntaxNode[] {
  return root
    .descendantsOfType('identifier')
    .filter((node) => node.text === name)
    .sort((left, right) => left.startIndex - right.startIndex);
}

function typeOf(table: SymbolTable, name: string): TypeInfo {
  const symbol = table.lookup(name);
  if (!symbol) {
    throw new Error(`Missing symbol: ${name}`);
  }
  return symbol.type;
}

describe('buildSymbolTable declarations', () => {
  it('collects both names from int a, b;', () => {
    const table = build('int a, b;');

    expect(table.symbols.map((symbol) => symbol.name)).toEqual(['a', 'b']);
    expect(typeOf(table, 'a')).toMatchObject({ base: 'int', ptr: 0 });
    expect(typeOf(table, 'b')).toMatchObject({ base: 'int', ptr: 0 });
    expect(table.symbols.every((symbol) => symbol.scope === 'file')).toBe(true);
    expect(table.symbols.every((symbol) => !symbol.isParam)).toBe(true);
    expect(table.symbols.every((symbol) => symbol.declLine === 0)).toBe(true);
  });

  it('counts pointer depth for char *p;', () => {
    const table = build('char *p;');

    expect(typeOf(table, 'p')).toMatchObject({ base: 'char', ptr: 1 });
  });

  it('records the array length for char buf[10];', () => {
    const table = build('char buf[10];');

    expect(typeOf(table, 'buf')).toMatchObject({
      base: 'char',
      ptr: 0,
      dims: [10],
    });
    expect(typeOf(table, 'buf').array).toBe(10);
  });

  it('keeps both pointer and array for double *q[5];', () => {
    const table = build('double *q[5];');

    expect(typeOf(table, 'q').ptr).toBe(1);
    expect(typeOf(table, 'q').dims).toEqual([5]);
    expect(typeOf(table, 'q').base).toBe('double');
  });

  it('leaves the array length undefined when it is not a literal', () => {
    const table = build('int arr[]; int vla[n];');

    expect(table.lookup('arr')?.type.dims).toBeUndefined();
    expect(table.lookup('vla')?.type.dims).toBeUndefined();
  });

  it('records every dimension for int m[3][4];', () => {
    const table = build('int m[3][4];');

    expect(typeOf(table, 'm')).toMatchObject({
      base: 'int',
      ptr: 0,
      dims: [3, 4],
    });
    expect(typeOf(table, 'm').array).toBe(3);
  });

  it('clears all dimensions when one inner dimension is not a literal', () => {
    const table = build('int m[3][n];');

    expect(typeOf(table, 'm').dims).toBeUndefined();
  });

  it('maps signed and unsigned long spellings to distinct bases', () => {
    const table = build(
      'unsigned long n; long long y; unsigned long long z; size_t t; unsigned int u; long l;',
    );

    expect(typeOf(table, 'n').base).toBe('ulong');
    expect(typeOf(table, 'y').base).toBe('longlong');
    expect(typeOf(table, 'z').base).toBe('ulonglong');
    expect(typeOf(table, 't').base).toBe('ulong');
    expect(typeOf(table, 'u').base).toBe('unsigned');
    expect(typeOf(table, 'l').base).toBe('long');
  });

  it('marks const declarations', () => {
    const table = build('const int c; static int s;');

    expect(typeOf(table, 'c').const).toBe(true);
    expect(table.lookup('s')?.type.const).toBeUndefined();
  });

  it('records zero-based declaration lines', () => {
    const table = build('int a;\nint b;\n');

    expect(table.lookup('a')?.declLine).toBe(0);
    expect(table.lookup('b')?.declLine).toBe(1);
  });

  it('records distinct declarator node ids for shadowed names', () => {
    const table = build('int x; void f() { double x; }');
    const ids = table.symbols
      .filter((symbol) => symbol.name === 'x')
      .map((symbol) => symbol.declNodeId);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('buildSymbolTable scopes', () => {
  it('collects parameters as function-scope symbols', () => {
    const table = build('int f(int a, char *b) { return a; }');

    const a = table.lookup('a');
    expect(a).toMatchObject({
      scope: 'function',
      isParam: true,
    });
    expect(a?.type).toMatchObject({ base: 'int', ptr: 0 });
    expect(table.lookup('b')?.type).toMatchObject({ base: 'char', ptr: 1 });
    expect(table.lookup('b')?.isParam).toBe(true);
  });

  it('decays array parameters to pointers', () => {
    const table = build('void f(double c[], int d[10], char *argv[]) { }');

    expect(table.lookup('c')?.type).toMatchObject({ ptr: 1 });
    expect(table.lookup('c')?.type.dims).toBeUndefined();
    expect(table.lookup('d')?.type).toMatchObject({ ptr: 1 });
    expect(table.lookup('d')?.type.dims).toBeUndefined();
    expect(table.lookup('argv')?.type).toMatchObject({ base: 'char', ptr: 2 });
  });

  it('distinguishes function-body declarations from nested block declarations', () => {
    const table = build('void f() { int a; { int b; } }');

    expect(table.lookup('a')?.scope).toBe('function');
    expect(table.lookup('b')?.scope).toBe('block');
  });

  it('scopes for-loop declarations to the loop', () => {
    const source =
      'int main() { for (int i = 0; i < 3; i++) { i = 1; } int j = i; return 0; }';
    const tree = parse(source);
    const table = buildSymbolTable(tree.rootNode, source);
    const uses = identifiers(tree.rootNode, 'i');

    expect(uses.length).toBeGreaterThanOrEqual(5);
    expect(table.resolve('i', uses[3]!)).toMatchObject({
      scope: 'block',
      type: { base: 'int' },
    });
    expect(table.resolve('i', uses[uses.length - 1]!)).toBeUndefined();
  });

  it('resolves the inner declaration for shadowed names', () => {
    const source =
      'int f() { int x = 1; { double x = 2; x = 3; } x = 4; return 0; }';
    const tree = parse(source);
    const table = buildSymbolTable(tree.rootNode, source);
    const uses = identifiers(tree.rootNode, 'x');

    expect(uses).toHaveLength(4);
    expect(table.resolve('x', uses[2]!)).toMatchObject({ type: { base: 'double' } });
    expect(table.resolve('x', uses[3]!)).toMatchObject({ type: { base: 'int' } });
    expect(table.lookup('x')?.type.base).toBe('double');
  });

  it('does not resolve a use that precedes its declaration', () => {
    const source = 'int f() { x = 1; int x; return 0; }';
    const tree = parse(source);
    const table = buildSymbolTable(tree.rootNode, source);
    const uses = identifiers(tree.rootNode, 'x');

    expect(table.resolve('x', uses[0]!)).toBeUndefined();
  });

  it('resolves file-scope declarations from inside a function', () => {
    const source = 'int g; int f() { int local = g; return local; }';
    const tree = parse(source);
    const table = buildSymbolTable(tree.rootNode, source);
    const uses = identifiers(tree.rootNode, 'g');

    expect(table.resolve('g', uses[uses.length - 1]!)).toMatchObject({
      scope: 'file',
      type: { base: 'int' },
    });
  });

  it('does not invent symbols for function prototypes', () => {
    const table = build('int f(int a); int g();');

    expect(table.lookup('f')).toBeUndefined();
    expect(table.lookup('g')).toBeUndefined();
    expect(table.lookup('a')).toBeUndefined();
  });

  it('ignores struct members and keeps struct variables', () => {
    const table = build('struct S { int field; }; struct S s;');

    expect(table.lookup('field')).toBeUndefined();
    expect(table.lookup('s')?.type.base).toBe('struct');
  });
});

describe('buildSymbolTable coverage semantics', () => {
  it('replaces a retyped declaration on rebuild', () => {
    const before = build('int x;');
    const after = build('double x;');

    expect(before.lookup('x')?.type.base).toBe('int');
    expect(after.lookup('x')?.type.base).toBe('double');
  });

  it('drops declarations removed from the text', () => {
    const before = build('int x; int y;');
    const after = build('int y;');

    expect(before.lookup('x')).toBeDefined();
    expect(after.lookup('x')).toBeUndefined();
    expect(after.lookup('y')).toBeDefined();
  });

  it('uses the latest same-name declaration', () => {
    const table = build('int x; double x;');

    expect(table.symbols.filter((symbol) => symbol.name === 'x')).toHaveLength(2);
    expect(table.lookup('x')?.type.base).toBe('double');
  });

  it('marks declarations with an unknown type identifier as unknown', () => {
    const table = build('dou x;');

    expect(table.lookup('x')?.type.base).toBe('unknown');
  });

  it('does not throw or invent a symbol for a bare incomplete declaration', () => {
    const table = build('dou');

    expect(table.symbols).toEqual([]);
  });
});
