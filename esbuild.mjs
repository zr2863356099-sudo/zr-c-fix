import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const vendorWasm = path.join(root, 'vendor', 'tree-sitter-c.wasm');
const packagedWasm = path.join(
  root,
  'node_modules',
  'tree-sitter-wasms',
  'out',
  'tree-sitter-c.wasm',
);
const runtimeWasmSource = path.join(root, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
const distGrammarWasm = path.join(dist, 'tree-sitter-c.wasm');
const distRuntimeWasm = path.join(dist, 'tree-sitter.wasm');

async function copyParserWasm() {
  await mkdir(dist, { recursive: true });
  await mkdir(path.dirname(vendorWasm), { recursive: true });

  if (!existsSync(vendorWasm)) {
    if (!existsSync(packagedWasm)) {
      throw new Error(
        'tree-sitter-c.wasm is missing. Install dev dependencies or add it to vendor/.',
      );
    }
    await copyFile(packagedWasm, vendorWasm);
  }

  if (!existsSync(runtimeWasmSource)) {
    throw new Error(
      'tree-sitter.wasm is missing from node_modules/web-tree-sitter. Run pnpm install.',
    );
  }

  await copyFile(vendorWasm, distGrammarWasm);
  await copyFile(runtimeWasmSource, distRuntimeWasm);

  for (const wasm of [distGrammarWasm, distRuntimeWasm]) {
    if (!existsSync(wasm)) {
      throw new Error(`Required wasm was not copied to dist: ${wasm}`);
    }
  }
}

await copyParserWasm();

const buildOptions = {
  entryPoints: {
    extension: path.join(root, 'src', 'vscode', 'extension.ts'),
    'parse-probe': path.join(root, 'scripts', 'parse-probe.ts'),
  },
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outdir: dist,
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
} else {
  await esbuild.build(buildOptions);
}
