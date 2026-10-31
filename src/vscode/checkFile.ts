import * as vscode from 'vscode';
import type { Issue } from '../core/rules/types';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';

export interface CheckFileOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

interface CheckItem extends vscode.QuickPickItem {
  issue: Issue;
}

export function registerCheckFile(
  options: CheckFileOptions,
): vscode.Disposable {
  return vscode.commands.registerCommand('cfix.checkFile', () =>
    checkFile(options),
  );
}

/**
 * Lists every issue the full-file analysis can produce. Unlike the Problems panel this
 * deliberately ignores the syntax-error guard, so the user can still navigate findings.
 */
async function checkFile(options: CheckFileOptions): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== C_LANGUAGE_ID) {
    void vscode.window.showInformationMessage('cfix: 当前编辑器不是 C 文件');
    return;
  }

  const document = editor.document;
  let issues: readonly Issue[];
  let hasError: boolean;
  try {
    const analysis = options.analysis.get(document);
    issues = analysis.getAllIssues();
    hasError = analysis.hasError;
  } catch (error) {
    options.output.appendLine(
      `[D] checkFile failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    void vscode.window.showErrorMessage('cfix: 检查失败，请查看输出面板');
    return;
  }

  if (issues.length === 0) {
    void vscode.window.showInformationMessage('未发现问题');
    return;
  }

  const items: CheckItem[] = issues.map((issue) => ({
    label: `L${issue.range.startLine + 1}  ${issue.message}`,
    description: issue.ruleId,
    detail: issue.severity,
    issue,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: hasError
      ? `共 ${issues.length} 个问题（文件含语法错误，结果可能受影响）`
      : `共 ${issues.length} 个问题`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  revealIssue(document, picked.issue);
}

function revealIssue(document: vscode.TextDocument, issue: Issue): void {
  if (document.isClosed || document.lineCount === 0) {
    return;
  }

  const line = Math.min(
    Math.max(issue.range.startLine, 0),
    document.lineCount - 1,
  );
  const lineText = document.lineAt(line).text;
  const startChar = Math.min(Math.max(issue.range.startChar, 0), lineText.length);
  const rawEnd =
    issue.range.endLine === line ? issue.range.endChar : lineText.length;
  const endChar = Math.min(Math.max(rawEnd, startChar), lineText.length);
  const range = new vscode.Range(line, startChar, line, endChar);

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
    return;
  }

  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
