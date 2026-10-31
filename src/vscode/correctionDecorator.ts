import * as vscode from 'vscode';
import { buildInlineCorrection } from '../core/correction';
import { trimCommon } from '../core/diff';
import { isIssueVisible } from '../core/issueVisibility';
import { acceptedLineFixes, type AcceptedLineFix } from '../core/merge';
import type { Issue } from '../core/rules/types';
import { SYNTAX_REPAIR_RULES } from '../core/rules/syntaxRepair';
import {
  collectLineHashes,
  hashLine,
  SuppressionTable,
  type SuppressionKey,
} from '../core/suppression';
import { readCfixSettings } from './config';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';
const SUGGESTION_CONTEXT_KEY = 'cfix.suggestionVisible';
const GHOST_COLOR = new vscode.ThemeColor('editorGhostText.foreground');

interface PendingCorrection {
  uri: string;
  version: number;
  line: number;
  lineHash: string;
  range: vscode.Range;
  newText: string;
  key: SuppressionKey;
  editor: vscode.TextEditor;
}

interface Session {
  suppression: SuppressionTable;
}

/** Non-interactive annotation for a hint that offers no fix. */
interface HintAnnotation {
  uri: string;
  line: number;
  editor: vscode.TextEditor;
}

/**
 * Minimal visual difference. Striking out and inserting are independent: an insertion-only
 * fix has no strike range, a deletion-only fix has no after text.
 */
interface CorrectionDisplay {
  strikeRange: vscode.Range | undefined;
  afterPosition: vscode.Position | undefined;
  afterText: string;
}

export interface CorrectionDecoratorOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

export function registerCorrectionDecorator(
  options: CorrectionDecoratorOptions,
): vscode.Disposable {
  const decorator = new CorrectionDecorator(options);
  return decorator.register();
}

/**
 * Draws corrections as a diff: the original span is struck through and the replacement
 * follows in ghost-text gray. VS Code's inline suggestion cannot render replacements
 * before the cursor, so the whole correction layer is decoration based.
 */
class CorrectionDecorator {
  private readonly sessions = new Map<string, Session>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastCursorLine = new Map<string, number>();
  private readonly removedDecoration = vscode.window.createTextEditorDecorationType({
    textDecoration: 'line-through',
    color: GHOST_COLOR,
  });
  private readonly insertedDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: GHOST_COLOR,
    },
  });
  private readonly hintDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: GHOST_COLOR,
      fontStyle: 'italic',
    },
  });
  private pending: PendingCorrection | undefined;
  private hint: HintAnnotation | undefined;

  constructor(private readonly options: CorrectionDecoratorOptions) {}

  register(): vscode.Disposable {
    const acceptCommand = vscode.commands.registerCommand(
      'cfix.acceptCorrection',
      () => this.accept(),
    );
    const dismissCommand = vscode.commands.registerCommand(
      'cfix.dismissCorrection',
      () => this.dismiss(),
    );
    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      this.onDocumentChange(event.document);
    });
    const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      this.onDocumentClose(document);
    });
    const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.onActiveEditorChange(editor);
    });
    const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
      this.onSelectionChange(event.textEditor);
    });
    const windowStateListener = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        this.clear('window lost focus');
      }
    });
    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('cfix')) {
        this.onConfigurationChange();
      }
    });

    const cleanup = {
      dispose: () => {
        for (const uri of [...this.timers.keys()]) {
          this.cancelTimer(uri);
        }
        this.sessions.clear();
        this.lastCursorLine.clear();
        this.pending = undefined;
        if (this.hint) {
          this.clearHintDecorations(this.hint.editor);
          this.hint = undefined;
        }
        this.clearAllDecorations();
        this.removedDecoration.dispose();
        this.insertedDecoration.dispose();
        this.hintDecoration.dispose();
        this.setContext(false);
      },
    };

    return vscode.Disposable.from(
      acceptCommand,
      dismissCommand,
      changeListener,
      closeListener,
      editorListener,
      selectionListener,
      windowStateListener,
      configListener,
      cleanup,
    );
  }

  private log(message: string): void {
    this.options.output.appendLine(`[C] ${message}`);
  }

  private onDocumentChange(document: vscode.TextDocument): void {
    if (document.languageId !== C_LANGUAGE_ID) {
      return;
    }

    if (this.hint?.uri === document.uri.toString()) {
      this.clearHint('document changed');
    }

    if (this.pending?.uri === document.uri.toString()) {
      this.clear('document changed');
    }

    this.scheduleCheck(document);
  }

  /**
   * Single entry point for "run a check after the debounce". Every trigger cancels the
   * previous timer so rapid edits or cursor moves coalesce into one analysis.
   */
  private scheduleCheck(document: vscode.TextDocument): void {
    if (document.languageId !== C_LANGUAGE_ID) {
      return;
    }

    const uri = document.uri.toString();
    this.cancelTimer(uri);

    const settings = readCfixSettings();
    if (!settings.enabled || !settings.correctionEnabled) {
      return;
    }

    this.getSession(uri).suppression.pruneToLineHashes(
      collectLineHashes(document.getText()),
    );

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(uri);
      void this.runCorrection(document).catch((error) => {
        this.options.output.appendLine(
          `[C] correction failed: ${formatError(error)}`,
        );
      });
    }, settings.debounceMs);
    this.timers.set(uri, timer);
  }

  private onDocumentClose(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    this.cancelTimer(uri);
    this.sessions.delete(uri);
    this.lastCursorLine.delete(uri);
    if (this.hint?.uri === uri) {
      this.clearHint('document closed');
    }
    if (this.pending?.uri === uri) {
      this.clear('document closed');
    }
  }

  private onActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    const hint = this.hint;
    if (hint && (!editor || editor.document.uri.toString() !== hint.uri)) {
      this.clearHint('active editor changed');
    }

    const pending = this.pending;
    if (pending && (!editor || editor.document.uri.toString() !== pending.uri)) {
      this.clear('active editor changed');
    }

    if (
      !editor ||
      editor.document.languageId !== C_LANGUAGE_ID ||
      !editor.selection.isEmpty
    ) {
      return;
    }

    this.lastCursorLine.set(
      editor.document.uri.toString(),
      editor.selection.active.line,
    );
    this.scheduleCheck(editor.document);
  }

  private onSelectionChange(editor: vscode.TextEditor): void {
    this.clearOnSelectionMove(editor);
    this.scheduleOnCursorLineChange(editor);
  }

  private clearOnSelectionMove(editor: vscode.TextEditor): void {
    const hint = this.hint;
    if (hint && editor === hint.editor) {
      const selection = editor.selection;
      if (!selection.isEmpty || selection.active.line !== hint.line) {
        this.clearHint('selection moved');
      }
    }

    const pending = this.pending;
    if (!pending) {
      return;
    }
    // 其他编辑器的选区变化与我们无关：VS Code 对后台编辑器恢复/刷新也会发这个事件，
    // 不过滤会把刚画上的建议误杀。
    if (editor !== pending.editor) {
      return;
    }
    const selection = editor.selection;
    if (!selection.isEmpty || selection.active.line !== pending.line) {
      this.clear('selection moved');
    }
  }

  private scheduleOnCursorLineChange(editor: vscode.TextEditor): void {
    // Only the active editor drives checks; background editors also emit selection
    // events when VS Code restores or refreshes them.
    if (editor !== vscode.window.activeTextEditor) {
      return;
    }

    const document = editor.document;
    if (document.languageId !== C_LANGUAGE_ID) {
      return;
    }

    const selection = editor.selection;
    if (!selection.isEmpty) {
      return;
    }

    const uri = document.uri.toString();
    const line = selection.active.line;
    const previousLine = this.lastCursorLine.get(uri);
    this.lastCursorLine.set(uri, line);
    if (previousLine === line) {
      return;
    }

    this.clear('cursor moved');
    this.scheduleCheck(document);
  }

  private onConfigurationChange(): void {
    for (const uri of [...this.timers.keys()]) {
      this.cancelTimer(uri);
    }
    this.sessions.clear();
    this.clear('configuration changed');
  }

  private async runCorrection(document: vscode.TextDocument): Promise<void> {
    const settings = readCfixSettings();
    if (!settings.enabled || !settings.correctionEnabled) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      editor.document.uri.toString() !== document.uri.toString() ||
      document.languageId !== C_LANGUAGE_ID ||
      !editor.selection.isEmpty
    ) {
      this.log(`run skipped (editor/selection) line=${editor?.selection.active.line}`);
      return;
    }

    const line = editor.selection.active.line;
    const lineText = document.lineAt(line).text;
    const uri = document.uri.toString();
    const analysis = this.options.analysis.get(document);
    const issues = analysis.getLineIssues(line);

    this.log(
      `run line=${line} v=${document.version} text=${JSON.stringify(lineText)} issues=${issues.map((i) => i.ruleId).join(',') || 'none'}`,
    );

    if (issues.length === 0) {
      this.clearHint('no issues');
      return;
    }

    const visibility = {
      hasError: analysis.hasError,
      errorLines: analysis.errorLines,
      syntaxRepairRules: SYNTAX_REPAIR_RULES,
    };
    // Any issue without a fix has nothing to accept, regardless of its channel.
    const hintIssue = issues.find(
      (issue) =>
        issue.fix === undefined && isIssueVisible(issue, visibility),
    );
    if (hintIssue) {
      this.showHint(editor, hintIssue);
    } else {
      this.clearHint('no hint issue');
    }

    const correctable = issues.filter((issue) =>
      isIssueVisible(issue, visibility),
    );
    const correction = buildInlineCorrection(
      correctable,
      line,
      analysis.text,
      'whole-line',
    );
    if (!correction) {
      this.log(
        `no correction built (correctable=${correctable.length} hasError=${String(analysis.hasError)})`,
      );
      return;
    }

    const { startChar, endChar } = correction.range;
    if (
      correction.range.startLine !== line ||
      correction.range.endLine !== line ||
      startChar < 0 ||
      endChar < startChar ||
      endChar > lineText.length ||
      /[\r\n]/.test(correction.newText) ||
      (startChar === endChar && correction.newText.length === 0)
    ) {
      this.log(
        `correction rejected: range=${correction.range.startLine}:${startChar}-${correction.range.endLine}:${endChar} lineLength=${lineText.length}`,
      );
      return;
    }

    const accepted = acceptedLineFixes(correctable, line, analysis.text);
    const display = buildCorrectionDisplay(
      accepted,
      line,
      lineText,
      correction.newText,
    );
    if (!display) {
      this.log('no minimal diff to display');
      return;
    }

    const lineHash = hashLine(lineText);
    const key: SuppressionKey = {
      lineHash,
      ruleId: correction.ruleId,
      typeFingerprint: analysis.getTypeFingerprint(),
    };
    const suppression = this.getSession(uri).suppression;
    if (suppression.isSuppressed(key)) {
      this.log('suppressed');
      return;
    }

    const range = new vscode.Range(line, startChar, line, endChar);
    this.pending = {
      uri,
      version: document.version,
      line,
      lineHash,
      range,
      newText: correction.newText,
      key,
      editor,
    };

    this.showDecorations(editor, display);
    this.setContext(true);
    this.log(
      `pending set rule=${correction.ruleId} accept=${startChar}-${endChar} strike=${formatRange(display.strikeRange)} after=${formatPosition(display.afterPosition)} newText=${JSON.stringify(display.afterText)}`,
    );
  }

  private showDecorations(
    editor: vscode.TextEditor,
    display: CorrectionDisplay,
  ): void {
    editor.setDecorations(
      this.removedDecoration,
      display.strikeRange ? [{ range: display.strikeRange }] : [],
    );

    if (display.afterPosition) {
      editor.setDecorations(this.insertedDecoration, [
        {
          range: new vscode.Range(display.afterPosition, display.afterPosition),
          renderOptions: {
            after: {
              contentText: display.afterText,
              color: GHOST_COLOR,
            },
          },
        },
      ]);
    } else {
      editor.setDecorations(this.insertedDecoration, []);
    }
  }

  /**
   * An issue without a fix has nothing to accept, so it is rendered as a plain italic
   * annotation and never sets `cfix.suggestionVisible`, regardless of its channel.
   */
  private showHint(editor: vscode.TextEditor, issue: Issue): void {
    const position = new vscode.Position(issue.range.endLine, issue.range.endChar);
    editor.setDecorations(this.hintDecoration, [
      {
        range: new vscode.Range(position, position),
        renderOptions: {
          after: {
            contentText: `  ⚠ ${issue.messageZh}`,
            color: GHOST_COLOR,
            fontStyle: 'italic',
          },
        },
      },
    ]);
    this.hint = {
      uri: editor.document.uri.toString(),
      line: issue.range.endLine,
      editor,
    };
    this.log(`hint shown rule=${issue.ruleId} line=${issue.range.endLine}`);
  }

  private clearHint(reason: string): void {
    const hint = this.hint;
    if (!hint) {
      return;
    }
    this.hint = undefined;
    this.log(`hint cleared (${reason})`);
    this.clearHintDecorations(hint.editor);
  }

  private clearHintDecorations(editor: vscode.TextEditor): void {
    if (editor.document.isClosed) {
      return;
    }
    try {
      editor.setDecorations(this.hintDecoration, []);
    } catch {
      /* the editor may be disposed between the visible list and this call */
    }
  }

  private async accept(): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      this.log('accept ignored: no pending correction');
      return;
    }

    const document = pending.editor.document;
    const lineText =
      pending.line < document.lineCount
        ? document.lineAt(pending.line).text
        : '';

    if (
      document.uri.toString() !== pending.uri ||
      document.isClosed ||
      document.version !== pending.version ||
      pending.line >= document.lineCount ||
      pending.range.end.character > lineText.length ||
      hashLine(lineText) !== pending.lineHash
    ) {
      this.log(
        `accept rejected: v=${pending.version}/${document.version} line=${pending.line} length=${lineText.length}`,
      );
      this.clear('stale correction');
      return;
    }

    this.clear('accepted');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, pending.range, pending.newText);
    const applied = await vscode.workspace.applyEdit(edit);
    this.log(`accepted applied=${String(applied)} rule=${pending.key.ruleId}`);
  }

  private dismiss(): void {
    const pending = this.pending;
    if (!pending) {
      this.log('dismiss ignored: no pending correction');
      return;
    }

    this.getSession(pending.uri).suppression.consume(pending.key);
    this.clear('dismissed');
  }

  private clear(reason: string): void {
    const pending = this.pending;
    if (pending) {
      this.log(`clear (${reason})`);
      this.pending = undefined;
      this.clearDecorations(pending.editor);
      this.setContext(false);
    }
    if (this.hint) {
      const hint = this.hint;
      this.log(`hint cleared (${reason})`);
      this.hint = undefined;
      this.clearHintDecorations(hint.editor);
    }
    this.clearAllDecorations();
  }

  private clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    if (editor.document.isClosed) {
      return;
    }
    try {
      editor.setDecorations(this.removedDecoration, []);
      editor.setDecorations(this.insertedDecoration, []);
      editor.setDecorations(this.hintDecoration, []);
    } catch {
      /* the editor may be disposed between the visible list and this call */
    }
  }

  private setContext(visible: boolean): void {
    void Promise.resolve(
      vscode.commands.executeCommand(
        'setContext',
        SUGGESTION_CONTEXT_KEY,
        visible,
      ),
    ).then(undefined, (error) => {
      this.options.output.appendLine(
        `[C] setContext failed: ${formatError(error)}`,
      );
    });
  }

  private getSession(uri: string): Session {
    let session = this.sessions.get(uri);
    if (!session) {
      session = { suppression: new SuppressionTable() };
      this.sessions.set(uri, session);
    }
    return session;
  }

  private cancelTimer(uri: string): void {
    const timer = this.timers.get(uri);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(uri);
    }
  }
}

/**
 * A single accepted fix knows exactly which characters it touches; multiple fixes are
 * merged into a whole-line rewrite, so only a character-level trim can recover the
 * minimal region.
 */
function buildCorrectionDisplay(
  accepted: readonly AcceptedLineFix[],
  line: number,
  lineText: string,
  correctedText: string,
): CorrectionDisplay | undefined {
  if (accepted.length === 1) {
    const fix = accepted[0]!.fix;
    const { startChar, endChar } = fix.range;
    if (startChar < 0 || endChar < startChar || endChar > lineText.length) {
      return undefined;
    }
    const oldText = lineText.slice(startChar, endChar);
    if (oldText === fix.newText) {
      return undefined;
    }
    return makeDisplay(line, startChar, oldText.length, fix.newText);
  }

  const trimmed = trimCommon(lineText, correctedText);
  if (!trimmed) {
    return undefined;
  }

  return makeDisplay(
    line,
    trimmed.prefixLength,
    trimmed.oldMiddle.length,
    trimmed.newMiddle,
  );
}

function makeDisplay(
  line: number,
  startChar: number,
  oldLength: number,
  newText: string,
): CorrectionDisplay | undefined {
  const strikeRange =
    oldLength > 0
      ? new vscode.Range(line, startChar, line, startChar + oldLength)
      : undefined;
  const afterPosition =
    newText.length > 0
      ? new vscode.Position(line, startChar + oldLength)
      : undefined;

  if (!strikeRange && !afterPosition) {
    return undefined;
  }

  return { strikeRange, afterPosition, afterText: newText };
}

function formatRange(range: vscode.Range | undefined): string {
  return range ? `${range.start.character}-${range.end.character}` : 'none';
}

function formatPosition(position: vscode.Position | undefined): string {
  return position ? String(position.character) : 'none';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
