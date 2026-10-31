import * as vscode from 'vscode';
import { buildMissingBraceFix, type BraceFix } from '../core/fixes/missingBrace';
import { findUnclosedOpens } from '../core/rules/unbalanced-braces';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';

export interface FixMissingBraceOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

export function registerFixMissingBrace(
  options: FixMissingBraceOptions,
): vscode.Disposable {
  return vscode.commands.registerCommand('cfix.fixMissingBrace', () =>
    fixMissingBrace(options),
  );
}

async function fixMissingBrace(
  options: FixMissingBraceOptions,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== C_LANGUAGE_ID) {
    void vscode.window.showInformationMessage('cfix: 当前编辑器不是 C 文件');
    return;
  }

  const document = editor.document;
  let fix: BraceFix | undefined;
  try {
    const analysis = options.analysis.get(document);
    const unclosedCount = findUnclosedOpens(analysis.rootNode).length;
    fix = buildMissingBraceFix(analysis.text, unclosedCount);
  } catch (error) {
    options.output.appendLine(
      `[D] fixMissingBrace failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    void vscode.window.showErrorMessage('cfix: 补全失败，请查看输出面板');
    return;
  }

  if (!fix) {
    void vscode.window.showInformationMessage(
      '没有可自动补全的括号，或存在多个未闭合的 {',
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(fix.offset), fix.insert);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage('cfix: 补全失败，请查看输出面板');
    return;
  }

  void vscode.window.showInformationMessage("已补上缺失的 '}'");
}
