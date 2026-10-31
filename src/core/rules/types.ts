import type Parser from 'web-tree-sitter';
import type { SymbolTable } from '../symbols';

export type Channel = 'ghost' | 'hint';
export type Severity = 'error' | 'warning';
export type PresetName = 'core' | 'standard' | 'all';
export type RuleOverride = 'off' | 'warning' | 'error';

export interface Range {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface Fix {
  /** Must start and end on the same line. */
  range: Range;
  newText: string;
}

export interface RelatedIssue {
  ruleId: string;
  severity: Severity;
  message: string;
}

export interface Issue {
  ruleId: string;
  channel: Channel;
  severity: Severity;
  range: Range;
  /** English, terse. Kept stable for tests and internal matching. */
  message: string;
  /** Chinese, user-facing. */
  messageZh: string;
  fix?: Fix;
  /** Other issues at the same position folded into this main diagnosis. */
  related?: RelatedIssue[];
}

export interface RuleConfig {
  preset: PresetName;
  /** Per-rule overrides from `cfix.rules.<id>`. */
  overrides: Readonly<Record<string, RuleOverride>>;
  /** Normal stack-frame threshold from `cfix.stackLimitKB`. */
  stackLimitKB?: number;
}

export interface RuleContext {
  text: string;
  root: Parser.SyntaxNode;
  table: SymbolTable;
  config: RuleConfig;
}

export interface Rule {
  id: string;
  channel: Channel;
  severity: Severity;
  check(ctx: RuleContext): Issue[];
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  preset: 'core',
  overrides: {},
  stackLimitKB: 1024,
};
