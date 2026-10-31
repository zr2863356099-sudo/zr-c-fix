import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createCParser, type CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { DEFAULT_RULE_CONFIG, getEnabledRuleIds, runRules, type Issue } from '../src/core/rules';

const out: string[] = [];
let fails = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) out.push(`OK   ${name}`);
  else {
    fails++;
    out.push(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

async function main(): Promise<void> {
  const wasmDir = path.resolve('dist');
  const parser: CParser = await createCParser({
    wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: wasmDir,
  });

  const coreIds = getEnabledRuleIds('core');

  function analyze(src: string): Issue[] {
    const tree = parser.parse(src);
    try {
      const table = buildSymbolTable(tree.rootNode, src);
      return runRules({ text: src, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG }, coreIds);
    } finally {
      tree.delete();
    }
  }

  // ---------- 1. 真实语料：命中符合 M3+M4 预期 ----------
  out.push('=== corpus (core preset) ===');
  const dir = path.resolve('test/corpus');
  const files = readdirSync(dir).filter((f) => f.endsWith('.c')).sort();
  // 04-sieve.c 原文件缺最后一个 `}`，unbalanced-braces 是真阳性。
  const expectedCorpus: Readonly<Record<string, readonly string[]>> = {
    '04-sieve.c': ['unbalanced-braces'],
    '06-score-buckets.c': ['stack-large-local'],
    '07-bubble.c': ['assignment-in-condition', 'shadowing', 'stack-vla'],
    '08-gcd.c': ['nonvoid-missing-return'],
    '09-ackermann.c': ['format-type-mismatch'],
    '10-vertical-add.c': ['missing-include', 'sprintf-unsafe'],
    '12-maze.c': ['stack-vla', 'stack-vla'],
  };

  for (const file of files) {
    const src = readFileSync(path.join(dir, file), 'utf8');
    const issues = analyze(src);
    const tags = issues.map((i) => `${i.ruleId}@${i.range.startLine + 1}`);
    out.push(`${file}: ${tags.length ? tags.join(', ') : '(none)'}`);

    const expected = [...(expectedCorpus[file] ?? [])].sort();
    const actual = issues.map((issue) => issue.ruleId).sort();
    ok(
      `${file} 命中符合预期`,
      JSON.stringify(actual) === JSON.stringify(expected),
      tags.join(', '),
    );
  }
  ok('07-bubble 命中 assignment-in-condition', analyze(readFileSync(path.join(dir, '07-bubble.c'), 'utf8')).some((i) => i.ruleId === 'assignment-in-condition'));

  // ---------- 2. 构造用例 ----------
  out.push('');
  out.push('=== crafted cases ===');
  const cases: Array<{ name: string; code: string; rule: string; hit: boolean }> = [
    {
      name: 'unbalanced-braces 缺右括号',
      code: 'int main(){\n  int a = 1;\n',
      rule: 'unbalanced-braces',
      hit: true,
    },
    {
      name: 'unbalanced-braces 完整',
      code: 'int main(){\n  return 0;\n}\n',
      rule: 'unbalanced-braces',
      hit: false,
    },
    {
      name: 'missing-include-hash',
      code: 'include <stdio.h>\nint main(){ return 0; }\n',
      rule: 'missing-include-hash',
      hit: true,
    },
    {
      name: 'missing-include-hash 正确写法',
      code: '#include <stdio.h>\nint main(){ return 0; }\n',
      rule: 'missing-include-hash',
      hit: false,
    },
    {
      name: 'stray-literal 误粘贴',
      code: 'int main(){\n  printf("x");\n}\n2\n2\n1\n',
      rule: 'stray-literal',
      hit: true,
    },
    {
      name: 'stray-literal 正常数字',
      code: 'int main(){\n  int a = 2;\n  return a;\n}\n',
      rule: 'stray-literal',
      hit: false,
    },
    {
      name: 'assignment-in-condition',
      code: 'int main(){ int flag; if (flag=0) return 1; return 0; }\n',
      rule: 'assignment-in-condition',
      hit: true,
    },
    {
      name: 'assignment-in-condition ==',
      code: 'int main(){ int flag; if (flag==0) return 1; return 0; }\n',
      rule: 'assignment-in-condition',
      hit: false,
    },
    {
      name: 'assignment-in-condition 合法嵌套赋值',
      code: 'int main(){ int a, b; if ((a = b) == 0) return 1; return 0; }\n',
      rule: 'assignment-in-condition',
      hit: false,
    },
    {
      name: 'missing-semicolon',
      code: "int main(){\n  char b[4];\n  b[0]='\\0'\n  return 0;\n}\n",
      rule: 'missing-semicolon',
      hit: true,
    },
    {
      name: 'missing-semicolon 正常',
      code: "int main(){\n  char b[4];\n  b[0]='\\0';\n  return 0;\n}\n",
      rule: 'missing-semicolon',
      hit: false,
    },
    {
      name: 'for-cond-var-never-updated',
      code: 'int main(){ int i,j,n=10; for(i=0;i<n;j++){ } return 0; }\n',
      rule: 'for-cond-var-never-updated',
      hit: true,
    },
    {
      name: 'for-cond-var 正常',
      code: 'int main(){ int i,n=10; for(i=0;i<n;i++){ } return 0; }\n',
      rule: 'for-cond-var-never-updated',
      hit: false,
    },
    {
      name: 'nested-loop-counter-clobber',
      code: 'int main(){ for(int i=0;i<3;i++) for(int j=0;j<3;i++){ } return 0; }\n',
      rule: 'nested-loop-counter-clobber',
      hit: true,
    },
    {
      name: 'nested-loop 正常',
      code: 'int main(){ for(int i=0;i<3;i++) for(int j=0;j<3;j++){ } return 0; }\n',
      rule: 'nested-loop-counter-clobber',
      hit: false,
    },
    {
      name: 'empty-statement-body while',
      code: 'int main(){ int i=0; while(i<10); { i++; } return 0; }\n',
      rule: 'empty-statement-body',
      hit: true,
    },
    {
      name: 'empty-statement-body getchar 惯用法',
      code: "int main(){ int c; while((c=getchar())!='\\n'); return 0; }\n",
      rule: 'empty-statement-body',
      hit: false,
    },
    {
      name: 'int-literal-overflow 超范围',
      code: 'int main(){ int x = 2147483648; return x; }\n',
      rule: 'int-literal-overflow',
      hit: true,
    },
    {
      name: 'int-literal-overflow 边界内',
      code: 'int main(){ int x = 2147483647; return x; }\n',
      rule: 'int-literal-overflow',
      hit: false,
    },
  ];

  const allIssues: Issue[] = [];
  for (const c of cases) {
    const issues = analyze(c.code);
    allIssues.push(...issues);
    const found = issues.some((i) => i.ruleId === c.rule);
    ok(c.name, found === c.hit, found === c.hit ? '' : `expected ${c.hit ? 'hit' : 'no hit'}, got ${issues.map((i) => i.ruleId).join(',') || 'none'}`);
  }

  // ---------- 3. 单行铁律 ----------
  out.push('');
  out.push('=== invariant: 所有 fix 必须单行 ===');
  const multiline = allIssues.filter((i) => i.fix && i.fix.range.startLine !== i.fix.range.endLine);
  ok('所有 fix 的 range 单行', multiline.length === 0, `${multiline.length} 个跨行`);

  parser.dispose();
  console.log(out.join('\n'));
  console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
