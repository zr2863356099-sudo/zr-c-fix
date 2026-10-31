import path from 'node:path';
import { createCParser, type CParser } from '../../src/core/parser';

export async function createTestParser(): Promise<CParser> {
  return createCParser({
    wasmPath: path.resolve(process.cwd(), 'vendor', 'tree-sitter-c.wasm'),
    runtimeWasmDir: path.resolve(process.cwd(), 'node_modules', 'web-tree-sitter'),
  });
}
