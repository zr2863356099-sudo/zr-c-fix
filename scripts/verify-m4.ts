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
  const allIssues: Issue[] = [];

  function analyze(src: string): Issue[] {
    const tree = parser.parse(src);
    try {
      const table = buildSymbolTable(tree.rootNode, src);
      const issues = runRules({ text: src, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG }, coreIds);
      allIssues.push(...issues);
      return issues;
    } finally {
      tree.delete();
    }
  }

  // ================= 1. 格式串四条分水岭 =================
  out.push('=== format 语义分水岭 ===');

  {
    const src = '#include <stdio.h>\nint main(){ float f = 1.0f; printf("%f", f); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId.startsWith('format'));
    ok('printf("%f", float) 不报（float 提升为 double）', hits.length === 0, hits.map((h) => h.message).join('|'));
  }
  {
    const src = '#include <stdio.h>\nint main(){ double d; scanf("%f", &d); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'format-type-mismatch');
    ok('scanf("%f", double*) 必报', hits.length === 1, hits.map((h) => h.message).join('|'));
    ok('scanf %f->double* 修复为 %lf', hits[0]?.fix?.newText?.includes('%lf') === true, JSON.stringify(hits[0]?.fix));
  }
  {
    const src = '#include <stdio.h>\nint main(){ char c = 65; printf("%d", c); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId.startsWith('format'));
    ok('printf("%d", char) 不报（char 提升为 int）', hits.length === 0, hits.map((h) => h.message).join('|'));
  }
  {
    const src = '#include <stdio.h>\nint main(){ long long r = 5; printf("%d", r); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'format-type-mismatch');
    ok('printf("%d", long long) 必报', hits.length === 1, hits.map((h) => h.message).join('|'));
    ok('long long 修复为 %lld', hits[0]?.fix?.newText?.includes('%lld') === true, JSON.stringify(hits[0]?.fix));
  }
  {
    const src = '#include <stdio.h>\nint main(){ int x; scanf("%d", &x); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId.startsWith('format') || i.ruleId === 'scanf-missing-amp');
    ok('scanf("%d", &int) 不报', hits.length === 0, hits.map((h) => h.message).join('|'));
  }

  // ================= 2. 其他关键规则 =================
  out.push('');
  out.push('=== 关键规则 ===');
  {
    const src = '#include <stdio.h>\nint main(){ int x; scanf("%d", x); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'scanf-missing-amp');
    ok('scanf 缺 & 命中', hits.length === 1, hits.map((h) => h.message).join('|'));
    const f = hits[0]?.fix;
    ok(
      '缺 & 修复为零宽插入 "&"',
      f !== undefined && f.range.startChar === f.range.endChar && f.newText === '&',
      JSON.stringify(f),
    );
  }
  {
    const src = '#include <stdio.h>\nvoid f(){ puchar(65); }\nint main(){ f(); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'implicit-declaration');
    ok('puchar 拼错命中', hits.length === 1, hits.map((h) => h.message).join('|'));
    ok('拼错建议 putchar', (hits[0]?.fix?.newText ?? '').includes('putchar'), JSON.stringify(hits[0]?.fix));
  }
  {
    const src = '#include <stdio.h>\nint main(){ char b[10]; b[0]="0"; return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'char-string-literal');
    ok('char 用双引号命中', hits.length === 1, hits.map((h) => h.message).join('|'));
  }
  {
    const src = '#include <stdio.h>\nint main(){ char s[100005]; scanf("%s", s); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'scanf-string-width');
    out.push(`INFO 大缓冲区 %s 命中 ${hits.length} 条（应为 0，>256 只提示或跳过）`);
    ok('>256 字节缓冲区不自动补宽度', hits.length === 0, hits.map((h) => i.ruleId).join(','));
  }
  {
    const src = '#include <stdio.h>\nint main(){ char s[10]; scanf("%s", s); return 0; }\n';
    const hits = analyze(src).filter((i) => i.ruleId === 'scanf-string-width');
    out.push(`INFO 小缓冲区 hits=${JSON.stringify(hits.map((h) => ({ f: h.fix, m: h.message, c: h.channel })))}`);
    ok('小缓冲区 %s 补宽度为 %9s', (hits[0]?.fix?.newText ?? '').includes('%9s'), JSON.stringify(hits[0]?.fix));
  }

  // ================= 3. 真实语料期望表 =================
  out.push('');
  out.push('=== corpus (允许的规则集合) ===');
  const expected: Record<string, string[]> = {
    '01-hello.c': [],
    '02-scanf-sum.c': [],
    // char s[100005] 超过 256 字节阈值，按 RULES.md 设计不报
    '03-scanf-string.c': [],
    '04-sieve.c': ['unbalanced-braces'],
    '05-gpa.c': [],
    '06-score-buckets.c': ['stack-large-local'],
    // int arr[n] 是 VLA，真阳性
    '07-bubble.c': ['assignment-in-condition', 'shadowing', 'stack-vla'],
    '08-gcd.c': ['nonvoid-missing-return'],
    '09-ackermann.c': ['format-type-mismatch'],
    '10-vertical-add.c': ['sprintf-unsafe', 'missing-include'],
    '11-palindrome.c': [],
    // mi 与 bian 两个 VLA
    '12-maze.c': ['stack-vla', 'stack-vla'],
  };
  const dir = path.resolve('test/corpus');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.c')).sort()) {
    const src = readFileSync(path.join(dir, file), 'utf8');
    const issues = analyze(src);
    const got = issues.map((i) => i.ruleId).sort();
    const want = [...(expected[file] ?? [])].sort();
    out.push(`${file}: [${got.join(', ')}]`);
    for (const i of issues) out.push(`     ${i.ruleId}@${i.range.startLine + 1}: ${i.message}`);
    ok(`${file} 命中集合符合预期`, JSON.stringify(got) === JSON.stringify(want), `got=[${got}] want=[${want}]`);
  }

  // ================= 4. 单行铁律 =================
  out.push('');
  const multiline = allIssues.filter((i) => i.fix && i.fix.range.startLine !== i.fix.range.endLine);
  ok('所有 fix 单行', multiline.length === 0, `${multiline.length} 个跨行: ${multiline.map((m) => m.ruleId).join(',')}`);

  // ================= 5. stray-literal 跨行修复为 hint =================
  const strayMulti = analyze('int main(){ printf("x"); }\n2\n2\n1\n').filter((i) => i.ruleId === 'stray-literal');
  ok('跨行误粘贴命中且为 hint 无 fix', strayMulti.length === 1 && strayMulti[0]?.channel === 'hint' && strayMulti[0]?.fix === undefined, JSON.stringify(strayMulti.map((s) => ({ c: s.channel, f: !!s.fix }))));

  parser.dispose();
  console.log(out.join('\n'));
  console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
