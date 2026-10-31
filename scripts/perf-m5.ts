import path from 'node:path';
import { createCParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { DEFAULT_RULE_CONFIG, getEnabledRuleIds, runRules } from '../src/core/rules';

function makeSource(functions: number): string {
  const parts: string[] = ['#include <stdio.h>', '#include <string.h>', ''];
  for (let i = 0; i < functions; i++) {
    parts.push(`int f${i}(int n, char *s) {`);
    parts.push(`  int a${i} = n + ${i};`);
    parts.push(`  double b${i} = a${i} * 1.5;`);
    parts.push(`  char buf${i}[64];`);
    parts.push(`  int arr${i}[16];`);
    parts.push(`  for (int k = 0; k < n; k++) {`);
    parts.push(`    arr${i}[k % 16] = k + a${i};`);
    parts.push(`  }`);
    parts.push(`  snprintf(buf${i}, sizeof buf${i}, "%d", a${i});`);
    parts.push(`  printf("%d %d\\n", arr${i}[0], arr${i}[1]);`);
    parts.push(`  scanf("%d", &a${i});`);
    parts.push(`  return a${i} + (int)b${i} + (int)strlen(s);`);
    parts.push('}');
    parts.push('');
  }
  parts.push('int main() {');
  parts.push('  char s[32] = "hi";');
  parts.push(`  return f0(1, s);`);
  parts.push('}');
  return parts.join('\n');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

async function main(): Promise<void> {
  const wasmDir = path.resolve('dist');
  const parser = await createCParser({
    wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: wasmDir,
  });
  const coreIds = getEnabledRuleIds('core');

  for (const functions of [12, 50, 150, 400]) {
    const src = makeSource(functions);
    const lines = src.split('\n').length;

    const parseMs: number[] = [];
    const tableMs: number[] = [];
    const rulesMs: number[] = [];
    const totalMs: number[] = [];

    const iterations = 8;
    for (let i = 0; i < iterations; i++) {
      // 模拟"每次编辑后 version 变化"：文本相同但重新走完整链路
      const t0 = performance.now();
      const tree = parser.parse(src);
      const t1 = performance.now();
      const table = buildSymbolTable(tree.rootNode, src);
      const t2 = performance.now();
      runRules({ text: src, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG }, coreIds);
      const t3 = performance.now();
      tree.delete();

      parseMs.push(t1 - t0);
      tableMs.push(t2 - t1);
      rulesMs.push(t3 - t2);
      totalMs.push(t3 - t0);
    }

    console.log(
      `lines=${String(lines).padStart(5)}  parse=${median(parseMs).toFixed(1)}ms  table=${median(tableMs).toFixed(1)}ms  rules=${median(rulesMs).toFixed(1)}ms  total=${median(totalMs).toFixed(1)}ms`,
    );
  }

  parser.dispose();
}

void main();
