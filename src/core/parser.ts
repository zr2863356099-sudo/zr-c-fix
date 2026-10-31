import path from 'node:path';
import Parser from 'web-tree-sitter';

export interface CParserOptions {
  /** Path to the language grammar wasm (tree-sitter-c.wasm). */
  wasmPath: string;
  /** Directory holding the runtime wasm (tree-sitter.wasm). Defaults to dirname(wasmPath). */
  runtimeWasmDir?: string;
}

export interface CParser {
  parse(source: string): Parser.Tree;
  dispose(): void;
}

let runtimeReady: Promise<void> | undefined;

export async function createCParser(options: CParserOptions): Promise<CParser> {
  const runtimeWasmDir = options.runtimeWasmDir ?? path.dirname(options.wasmPath);

  runtimeReady ??= Parser.init({
    locateFile: (name: string) => path.join(runtimeWasmDir, name),
  });
  await runtimeReady;

  const language = await Parser.Language.load(options.wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);

  return {
    parse(source: string): Parser.Tree {
      return parser.parse(source);
    },
    dispose(): void {
      parser.delete();
    },
  };
}
