import path from 'node:path';
import { createCParser, type CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { formatType, inferType, typeFingerprint } from '../src/core/infer';

const lines: string[] = [];
let fails = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    lines.push(`OK   ${name}`);
  } else {
    fails++;
    lines.push(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

function info(name: string, value: string): void {
  lines.push(`INFO ${name} -> ${value}`);
}

async function main(): Promise<void> {
const wasmDir = path.resolve('dist');
const parser: CParser = await createCParser({
  wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
  runtimeWasmDir: wasmDir,
});

function build(src: string) {
  const tree = parser.parse(src);
  return { tree, table: buildSymbolTable(tree.rootNode, src) };
}

function typeOf(src: string, name: string): string {
  const { tree, table } = build(src);
  const sym = table.lookup(name);
  const out = sym ? formatType(sym.type) : '<missing>';
  tree.delete();
  return out;
}

// 1. 改类型必须覆盖
ok('改类型覆盖 int -> double', typeOf('int x;', 'x') !== 'double' && typeOf('double x;', 'x') === 'double', typeOf('double x;', 'x'));

// 2. 删声明必须消失
{
  const { tree, table } = build('double y;');
  ok('删声明后 x 消失', table.lookup('x') === undefined && table.lookup('y') !== undefined);
  tree.delete();
}

// 3. 指针层级也要跟着变
ok('char* -> int 指针层级归零', typeOf('char *s;\nint s2;', 's') !== 'int' && typeOf('char *s;', 's') === 'char*', typeOf('char *s;', 's'));

// 4. 遮蔽：内层 int x 盖住外层 double x
{
  const src = ['double x;', 'int main(){', '  {', '    int x;', '    x = 1;', '  }', '  x = 2.0;', '  return 0;', '}'].join('\n');
  const { tree, table } = build(src);
  const inner = tree.rootNode.descendantForPosition({ row: 4, column: 4 });
  const outer = tree.rootNode.descendantForPosition({ row: 6, column: 2 });
  const innerT = table.resolve('x', inner);
  const outerT = table.resolve('x', outer);
  ok(
    '遮蔽：块内 int、块外 double',
    innerT !== undefined && outerT !== undefined && formatType(innerT.type) === 'int' && formatType(outerT.type) === 'double',
    `inner=${innerT ? formatType(innerT.type) : '?'} outer=${outerT ? formatType(outerT.type) : '?'}`,
  );
  tree.delete();
}

// 5. 指针数组
{
  const { tree, table } = build('double *q[5];');
  const s = table.lookup('q');
  info('double *q[5]', s ? JSON.stringify(s.type) : 'missing');
  ok('指针数组 ptr=1 dims=[5]', !!s && s.type.ptr === 1 && s.type.dims?.[0] === 5, s ? JSON.stringify(s.type) : 'missing');
  tree.delete();
}

// 6. 残缺声明 fail-closed
ok('残缺声明 dou x -> unknown', typeOf('dou x;', 'x').startsWith('unknown'), typeOf('dou x;', 'x'));

// 7. 类型指纹：类型变了必须不同
{
  const a = build('int x;').table;
  const b = build('double x;').table;
  const c = build('int x;').table;
  ok('指纹随类型变化', typeFingerprint(a, ['x']) !== typeFingerprint(b, ['x']), `${typeFingerprint(a, ['x'])} vs ${typeFingerprint(b, ['x'])}`);
  ok('指纹同类型稳定', typeFingerprint(a, ['x']) === typeFingerprint(c, ['x']));
}

// 8. 多声明 + 参数
{
  const { tree, table } = build('void f(int x, char *s){ }\nint a, b;');
  ok('int a, b 两个都在', table.lookup('a') !== undefined && table.lookup('b') !== undefined);
  ok('函数参数入表', table.lookup('x') !== undefined && table.lookup('s') !== undefined);
  const s = table.lookup('s');
  ok('char *s 参数 ptr=1', !!s && s.type.ptr === 1, s ? JSON.stringify(s.type) : 'missing');
  tree.delete();
}

// 9. inferType：sizeof / strlen / & / * / 下标
{
  const src = ['#include <string.h>', 'char str[10];', 'int arr[10];', 'int *p;', 'int x;', 'void f(){', '  int a = sizeof(int);', '  int b = strlen(str);', '  int *q = &x;', '  int c = *p;', '  int d = arr[3];', '}'].join('\n');
  const { tree, table } = build(src);
  const calls = tree.rootNode.descendantsOfType('call_expression');
  const sizeExpr = tree.rootNode.descendantsOfType('sizeof_expression');
  const unary = tree.rootNode.descendantsOfType('pointer_expression');
  const sub = tree.rootNode.descendantsOfType('subscript_expression');

  info('sizeof 推导', sizeExpr[0] ? formatType(inferType(sizeExpr[0], table)) : 'none');
  const strlenCall = calls.find((c) => c.childForFieldName('function')?.text === 'strlen');
  info('strlen 推导', strlenCall ? formatType(inferType(strlenCall, table)) : 'none');
  const amp = unary.find((u) => u.text.startsWith('&'));
  info('&x 推导', amp ? formatType(inferType(amp, table)) : 'none');
  const star = unary.find((u) => u.text.startsWith('*'));
  info('*p 推导', star ? formatType(inferType(star, table)) : 'none');
  info('arr[3] 推导', sub[0] ? formatType(inferType(sub[0], table)) : 'none');

  ok('sizeof -> ulong', !!sizeExpr[0] && inferType(sizeExpr[0], table).base === 'ulong');
  ok('strlen -> ulong', !!strlenCall && inferType(strlenCall, table).base === 'ulong');
  ok('&x 指针 +1', !!amp && inferType(amp, table).ptr === 1);
  ok('arr[3] 为 int', !!sub[0] && inferType(sub[0], table).base === 'int');
  tree.delete();
}

// 10. 使用先于声明（记录行为即可，不判错）
{
  const src = ['void f(){', '  y = 1;', '}', 'int y;'].join('\n');
  const { tree, table } = build(src);
  const at = tree.rootNode.descendantForPosition({ row: 1, column: 2 });
  const r = table.resolve('y', at);
  info('先使用后声明 resolve', r ? formatType(r.type) : 'undefined');
  tree.delete();
}

// 11. 二维数组
{
  const { tree, table } = build('int m[3][4];');
  const s = table.lookup('m');
  info('int m[3][4]', s ? JSON.stringify(s.type) : 'missing');
  tree.delete();
}

parser.dispose();

console.log(lines.join('\n'));
console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
process.exit(fails === 0 ? 0 : 1);
}

void main();
