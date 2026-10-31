import path from 'node:path';
import { createCParser } from '../src/core/parser';

async function main(): Promise<void> {
  const wasmDir = path.resolve('dist');
  const parser = await createCParser({
    wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: wasmDir,
  });

  const samples: Array<[string, string]> = [
    ['我的构造用例', 'int main(){\n  printf("x");\n}\n2\n2\n1\n'],
    [
      'OJ 真实 8237927',
      'int main(){\n  printf("QAQ");\n}2\n2\n1\n  printf("\\n");\n  return 0;\n}\n',
    ],
    ['单行 }2', 'int main(){ printf("QAQ"); }2\n'],
    ['正常数字', 'int main(){ int a = 2; return a; }\n'],
  ];

  for (const [name, src] of samples) {
    const tree = parser.parse(src);
    console.log(`\n=== ${name} ===`);
    console.log('hasError:', tree.rootNode.hasError());
    const walk = (n: any, depth: number): void => {
      if (n.type === 'ERROR' || n.isMissing) {
        console.log(
          '  '.repeat(depth) +
            `[${n.type}${n.isMissing ? ' MISSING' : ''}] text=${JSON.stringify(n.text)} ` +
            `lines=${n.startPosition.row}-${n.endPosition.row} cols=${n.startPosition.column}-${n.endPosition.column}`,
        );
      }
      for (const c of n.children) walk(c, depth + 1);
    };
    walk(tree.rootNode, 0);
    tree.delete();
  }

  parser.dispose();
}

void main();
