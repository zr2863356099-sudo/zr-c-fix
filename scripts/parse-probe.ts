import path from 'node:path';
import { createCParser } from '../src/core/parser';

const SOURCE = 'int main(){ printf("x"); return 0; }';

async function main(): Promise<void> {
  const wasmPath = path.resolve(process.argv[2] ?? path.join('dist', 'tree-sitter-c.wasm'));
  const parser = await createCParser({
    wasmPath,
    runtimeWasmDir: path.dirname(wasmPath),
  });

  try {
    const tree = parser.parse(SOURCE);
    try {
      console.log(`PARSED_OK ${tree.rootNode.hasError()}`);
    } finally {
      tree.delete();
    }
  } finally {
    parser.dispose();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`PARSED_FAIL ${message}`);
  process.exitCode = 1;
});
