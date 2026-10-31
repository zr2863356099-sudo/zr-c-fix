import path from 'node:path';
import { createCParser, type CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { DEFAULT_RULE_CONFIG, getEnabledRuleIds, runRules } from '../src/core/rules';

const lines: string[] = [];
let fails = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) lines.push(`OK   ${name}`);
  else {
    fails++;
    lines.push(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

async function main(): Promise<void> {
  const wasmDir = path.resolve('dist');
  const parser: CParser = await createCParser({
    wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: wasmDir,
  });
  const ids = getEnabledRuleIds('core');

  function analyze(src: string) {
    const tree = parser.parse(src);
    try {
      const table = buildSymbolTable(tree.rootNode, src);
      return runRules({ text: src, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG }, ids)
        .filter((i) => i.ruleId === 'undeclared-variable');
    } finally {
      tree.delete();
    }
  }

  const cases: Array<[string, string, boolean]> = [
    ['typo cnt -> count', 'int count;\nvoid f(){ cnt = 1; }\n', true],
    ['var 距离太远', 'int x;\nvoid f(){ var = 1; }\n', false],
    ['宏 N', '#define N 10\nint a[N];\nint main(){ return a[0]; }\n', false],
    ['struct 字段', 'struct S{int v;};\nvoid f(struct S s){ s.v = 1; }\n', false],
    ['函数名 printf', '#include <stdio.h>\nvoid f(){ printf("hi"); }\n', false],
    ['全大写 MAX', 'void f(){ MAX = 1; }\n', false],
    ['含 ERROR 未闭合', 'int count;\nvoid f(){ cnt = 1;\n', false],
    ['typo totl -> total', 'int total;\nvoid f(){ totl = 1; }\n', true],
  ];

  for (const [name, src, expectHit] of cases) {
    const hits = analyze(src);
    ok(name, (hits.length > 0) === expectHit, `hits=${hits.length} ${hits.map((h) => h.message).join('|')}`);
    if (expectHit && hits[0]) {
      lines.push(`     fix=${JSON.stringify(hits[0].fix?.newText ?? null)} msg=${hits[0].message}`);
    }
  }

  parser.dispose();
  console.log(lines.join('\n'));
  console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
