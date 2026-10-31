import path from 'node:path';
import { createCParser, type CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { DEFAULT_RULE_CONFIG, getEnabledRuleIds, runRules } from '../src/core/rules';

const cases: Array<[string, string]> = [
  ['全角逗号', 'int a，b;'],
  ['全角字母', 'ｉｎｔ a;'],
  ['全角数字', 'int a = １２３;'],
  ['全角空格', 'int a　b;'],
  ['全角分号', 'int a；'],
  ['全角括号', 'int f（）{ return 0; }'],
  ['全角井号 include', '＃include <stdio.h>\nint main(){return 0;}'],
  ['全角百分号（代码区）', 'int a = 5 ％ 3;'],
  ['全角小于等于', 'int f(int a,int b){ return a ＜＝ b; }'],
  ['弯引号', 'char *s = “hi”;'],
  ['句号（无法映射）', 'int a; 。'],
  ['顿号（无法映射）', 'int a; 、'],
  ['字符串内中文不报', 'char *s = "中文，";'],
  ['注释内中文不报', '// 中文，注释\nint a;'],
  ['块的注释内中文不报', '/* 中文，*/ int a;'],
  ['纯 ASCII', 'int a = 1;'],
  ['nsigned 拼错', 'nsigned long long x;'],
  ['unsiged 拼错', 'unsiged int x;'],
  ['正常类型', 'int x;'],
  ['typedef 类型', 'typedef int myint; myint y;'],
  ['自定义类型太远', 'foobar_t z;'],
];

async function main(): Promise<void> {
  const dir = path.resolve('dist');
  const parser: CParser = await createCParser({
    wasmPath: path.join(dir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: dir,
  });
  const ids = getEnabledRuleIds('core');

  for (const [label, src] of cases) {
    const text = src + (src.includes('\n') ? '\n' : '');
    const tree = parser.parse(text);
    const table = buildSymbolTable(tree.rootNode, text);
    const issues = runRules({ text, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG }, ids)
      .filter((i) => i.ruleId === 'non-ascii-in-code' || i.ruleId === 'unknown-type');
    console.log(`\n${label}`);
    if (issues.length === 0) console.log('  (无)');
    for (const i of issues) {
      console.log(`  ${i.ruleId} [${i.channel}] ${i.message}` + (i.fix ? `  fix=${JSON.stringify(i.fix.newText)}` : '  (无 fix)'));
    }
    tree.delete();
  }
  parser.dispose();
}

void main();
