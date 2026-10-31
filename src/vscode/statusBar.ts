import * as vscode from 'vscode';
import { findUnclosedOpens } from '../core/rules/unbalanced-braces';
import { readCfixSettings } from './config';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';
const CHECK_FILE_COMMAND = 'cfix.checkFile';
const BASE_TOOLTIP = 'cfix: 检查整个文件';
const BRACE_FIX_TOOLTIP = `${BASE_TOOLTIP}\n可用 cfix: 补上缺失的 } 自动修复`;
const SYNTAX_ERROR_TOOLTIP =
  '文件存在语法错误，语义类提示已暂停；可用 cfix: 检查整个文件 查看全部问题。';
const SYNTAX_ERROR_SUFFIX = ' (语法未完成)';

export interface StatusBarOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

export function registerStatusBar(
  options: StatusBarOptions,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.name = 'cfix';
  item.command = CHECK_FILE_COMMAND;
  item.tooltip = BASE_TOOLTIP;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const update = (document: vscode.TextDocument | undefined): void => {
    const settings = readCfixSettings();
    if (
      !document ||
      document.isClosed ||
      document.languageId !== C_LANGUAGE_ID ||
      !settings.enabled ||
      !settings.correctionEnabled
    ) {
      item.hide();
      return;
    }

    try {
      const analysis = options.analysis.get(document);
      const count = analysis.getAllIssues().length;
      if (count === 0) {
        item.hide();
        return;
      }
      const tooltip =
        findUnclosedOpens(analysis.rootNode).length === 1
          ? BRACE_FIX_TOOLTIP
          : BASE_TOOLTIP;
      item.tooltip = analysis.hasError
        ? `${tooltip}\n${SYNTAX_ERROR_TOOLTIP}`
        : tooltip;
      item.text = analysis.hasError
        ? `$(warning) cfix ${count}${SYNTAX_ERROR_SUFFIX}`
        : `$(warning) cfix ${count}`;
      item.show();
    } catch (error) {
      item.hide();
      options.output.appendLine(
        `[D] status bar failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const schedule = (): void => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      update(vscode.window.activeTextEditor?.document);
    }, readCfixSettings().debounceMs);
  };

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (
      event.document.uri.toString() ===
      vscode.window.activeTextEditor?.document.uri.toString()
    ) {
      schedule();
    }
  });
  const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
      schedule();
    }
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (
      document.uri.toString() ===
      vscode.window.activeTextEditor?.document.uri.toString()
    ) {
      cancel();
      update(undefined);
    }
  });
  const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    cancel();
    update(editor?.document);
  });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('cfix')) {
      schedule();
    }
  });

  update(vscode.window.activeTextEditor?.document);

  const cleanup = {
    dispose: () => {
      cancel();
      item.dispose();
    },
  };

  return vscode.Disposable.from(
    changeListener,
    openListener,
    closeListener,
    editorListener,
    configListener,
    cleanup,
  );
}
