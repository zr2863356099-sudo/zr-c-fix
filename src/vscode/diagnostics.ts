import * as vscode from 'vscode';
import { diagnosticMessage, selectDiagnostics, type DiagnosticLocale } from '../core/diagnostics';
import type { Issue, Severity } from '../core/rules/types';
import { readCfixSettings } from './config';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';

export interface DiagnosticsOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

export function registerDiagnostics(
  options: DiagnosticsOptions,
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection('cfix');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancel = (uri: string): void => {
    const timer = timers.get(uri);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(uri);
    }
  };

  const refresh = (document: vscode.TextDocument): void => {
    const settings = readCfixSettings();
    if (
      document.languageId !== C_LANGUAGE_ID ||
      !settings.enabled ||
      !settings.correctionEnabled
    ) {
      collection.delete(document.uri);
      return;
    }

    const analysis = options.analysis.get(document);
    const issues = selectDiagnostics({
      issues: analysis.getAllIssues(),
      hasError: analysis.hasError,
      errorLines: analysis.errorLines,
      includeFixable: settings.includeFixableDiagnostics,
    });
    collection.set(
      document.uri,
      issues.map((issue) => toDiagnostic(document, issue, settings.locale)),
    );
  };

  const schedule = (document: vscode.TextDocument): void => {
    const uri = document.uri.toString();
    cancel(uri);

    if (document.languageId !== C_LANGUAGE_ID) {
      collection.delete(document.uri);
      return;
    }

    const settings = readCfixSettings();
    if (!settings.enabled || !settings.correctionEnabled) {
      collection.delete(document.uri);
      return;
    }

    const timer = setTimeout(() => {
      timers.delete(uri);
      try {
        refresh(document);
      } catch (error) {
        collection.delete(document.uri);
        options.output.appendLine(
          `[D] diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, settings.debounceMs);
    timers.set(uri, timer);
  };

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    schedule(event.document);
  });
  const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
    schedule(document);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    cancel(document.uri.toString());
    collection.delete(document.uri);
  });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('cfix')) {
      return;
    }
    for (const uri of timers.keys()) {
      cancel(uri);
    }
    collection.clear();
    for (const document of vscode.workspace.textDocuments) {
      schedule(document);
    }
  });

  for (const document of vscode.workspace.textDocuments) {
    schedule(document);
  }

  const cleanup = {
    dispose: () => {
      for (const uri of [...timers.keys()]) {
        cancel(uri);
      }
      collection.clear();
    },
  };

  return vscode.Disposable.from(
    collection,
    changeListener,
    openListener,
    closeListener,
    configListener,
    cleanup,
  );
}

export function toDiagnostic(
  document: vscode.TextDocument,
  issue: Issue,
  locale: DiagnosticLocale = 'zh',
): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.range.startLine,
    issue.range.startChar,
    issue.range.endLine,
    issue.range.endChar,
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    diagnosticMessage(issue, locale),
    severityOf(issue.severity),
  );
  diagnostic.source = 'cfix';
  diagnostic.code = issue.ruleId;

  if (issue.related && issue.related.length > 0) {
    diagnostic.relatedInformation = issue.related.map((related) => {
      return new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, range),
        `${related.message} (${related.ruleId})`,
      );
    });
  }

  return diagnostic;
}

function severityOf(severity: Severity): vscode.DiagnosticSeverity {
  return severity === 'error'
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
}
