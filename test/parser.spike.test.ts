import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCParser, type CParser } from '../src/core/parser';

const wasmPath = path.resolve(process.cwd(), 'vendor', 'tree-sitter-c.wasm');
const runtimeWasmDir = path.resolve(process.cwd(), 'node_modules', 'web-tree-sitter');

let parser: CParser | undefined;

beforeAll(async () => {
  parser = await createCParser({ wasmPath, runtimeWasmDir });
});

afterAll(() => {
  parser?.dispose();
});

describe('tree-sitter C WASM spike', () => {
  it('parses printf without ERROR and exposes the call_expression', () => {
    if (!parser) {
      throw new Error('C parser was not initialized');
    }

    const tree = parser.parse('int main(){ printf("%d", 1); }');

    try {
      expect(tree.rootNode.hasError()).toBe(false);

      const calls = tree.rootNode.descendantsOfType('call_expression');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.childForFieldName('function')?.text).toBe('printf');
    } finally {
      tree.delete();
    }
  });
});
