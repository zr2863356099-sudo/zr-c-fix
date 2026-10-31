import * as vscode from 'vscode';
import {
  DocumentAnalysis,
  ruleConfigKey,
} from '../core/analysis';
import type { CParser } from '../core/parser';
import type { RuleConfig } from '../core/rules/types';

interface Entry {
  version: number;
  configKey: string;
  analysis: DocumentAnalysis;
}

/**
 * Caches one parse/symbol-table/rule pass per document version. A version bump or a
 * configuration change rebuilds from scratch, so retyped declarations cannot survive.
 */
export class DocumentAnalysisService implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly parser: CParser,
    private readonly getRuleConfig: () => RuleConfig,
  ) {}

  get(document: vscode.TextDocument): DocumentAnalysis {
    const uri = document.uri.toString();
    const config = this.getRuleConfig();
    const configKey = ruleConfigKey(config);
    const existing = this.entries.get(uri);

    if (
      existing &&
      existing.version === document.version &&
      existing.configKey === configKey
    ) {
      return existing.analysis;
    }

    existing?.analysis.dispose();
    const analysis = new DocumentAnalysis(
      this.parser,
      document.getText(),
      document.version,
      config,
    );
    this.entries.set(uri, {
      version: document.version,
      configKey,
      analysis,
    });
    return analysis;
  }

  release(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    const entry = this.entries.get(uri);
    if (!entry) {
      return;
    }
    entry.analysis.dispose();
    this.entries.delete(uri);
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.analysis.dispose();
    }
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
  }
}
