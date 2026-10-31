import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';
const DUMP_FILE_NAME = 'cfix-analysis.json';

export interface DumpAnalysisOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

interface DumpIssue {
  ruleId: string;
  channel: string;
  line: number;
  char: number;
  messageZh: string;
  hasFix: boolean;
  fixLine?: number;
}

export function registerDumpAnalysis(
  options: DumpAnalysisOptions,
): vscode.Disposable {
  return vscode.commands.registerCommand('cfix.dumpAnalysis', () =>
    dumpAnalysis(options),
  );
}

async function dumpAnalysis(options: DumpAnalysisOptions): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== C_LANGUAGE_ID) {
    void vscode.window.showInformationMessage('cfix: 当前编辑器不是 C 文件');
    return;
  }

  const document = editor.document;
  const target = path.join(os.tmpdir(), DUMP_FILE_NAME);

  try {
    const analysis = options.analysis.get(document);
    const issues: DumpIssue[] = analysis.getAllIssues().map((issue) => {
      const dump: DumpIssue = {
        ruleId: issue.ruleId,
        channel: issue.channel,
        line: issue.range.startLine,
        char: issue.range.startChar,
        messageZh: issue.messageZh,
        hasFix: issue.fix !== undefined,
      };
      if (issue.fix) {
        dump.fixLine = issue.fix.range.startLine;
      }
      return dump;
    });

    const payload = {
      uri: document.uri.toString(),
      version: document.version,
      hasError: analysis.hasError,
      errorLines: [...analysis.errorLines].sort((left, right) => left - right),
      text: analysis.text,
      issues,
      cursorLine: editor.selection.active.line,
    };

    await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    options.output.appendLine(`[D] analysis dumped to ${target}`);
    void vscode.window.showInformationMessage(`cfix: 分析结果已写入 ${target}`);
  } catch (error) {
    options.output.appendLine(
      `[D] dumpAnalysis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    void vscode.window.showErrorMessage('cfix: 导出分析结果失败，请查看输出面板');
  }
}
