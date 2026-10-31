import path from 'node:path';
import * as vscode from 'vscode';
import { createCParser, type CParser } from '../core/parser';
import { registerCheckFile } from './checkFile';
import { registerCodeActions } from './codeActions';
import { readCfixSettings } from './config';
import { registerCompletionProvider } from './completionProvider';
import { registerCorrectionDecorator } from './correctionDecorator';
import { registerDiagnostics } from './diagnostics';
import { DocumentAnalysisService } from './documentAnalysis';
import { registerDumpAnalysis } from './dumpAnalysis';
import { registerFixMissingBrace } from './fixMissingBrace';
import { registerStatusBar } from './statusBar';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('cfix');
  context.subscriptions.push(output);

  context.subscriptions.push(
    registerCompletionProvider(() => {
      const settings = readCfixSettings();
      return settings.enabled && settings.completionEnabled;
    }),
  );

  const distDir = path.join(context.extensionPath, 'dist');
  const wasmPath = path.join(distDir, 'tree-sitter-c.wasm');
  let parser: CParser | undefined;

  try {
    parser = await createCParser({ wasmPath, runtimeWasmDir: distDir });
    output.appendLine(`[P] parser ready: ${wasmPath}`);
  } catch (error) {
    output.appendLine(`[P] parser init failed: ${formatError(error)}`);
  }

  if (parser) {
    const analysis = new DocumentAnalysisService(
      parser,
      () => readCfixSettings().ruleConfig,
    );
    context.subscriptions.push(
      analysis,
      parser,
      registerCorrectionDecorator({ analysis, output }),
      registerDiagnostics({ analysis, output }),
      registerCodeActions({ analysis, output }),
      registerCheckFile({ analysis, output }),
      registerDumpAnalysis({ analysis, output }),
      registerFixMissingBrace({ analysis, output }),
      registerStatusBar({ analysis, output }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        analysis.release(document);
      }),
    );
  }
}

export function deactivate(): void {}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
