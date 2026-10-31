import type Parser from 'web-tree-sitter';
import { typeFingerprint } from './infer';
import type { CParser } from './parser';
import { lineBounds } from './rules/utils';
import { runRules } from './rules';
import type { Issue, RuleConfig } from './rules/types';
import { buildSymbolTable, type SymbolTable } from './symbols';
import { hashLine } from './suppression';

/**
 * One immutable document version: parse tree, symbol table and lazily computed rule
 * results. Create a new instance when the version changes; `dispose` releases the tree.
 */
export class DocumentAnalysis {
  private readonly tree: Parser.Tree;
  private readonly config: RuleConfig;
  private rulesResult: Issue[] | undefined;
  private readonly lineCache = new Map<string, Issue[]>();
  private typeFingerprintValue: string | undefined;

  readonly version: number;
  readonly text: string;
  readonly hasError: boolean;
  /** Lines covered by an ERROR or missing node; empty when `hasError` is false. */
  readonly errorLines: ReadonlySet<number>;
  readonly table: SymbolTable;

  get rootNode(): Parser.SyntaxNode {
    return this.tree.rootNode;
  }

  constructor(parser: CParser, text: string, version: number, config: RuleConfig) {
    this.text = text;
    this.version = version;
    this.config = config;
    this.tree = parser.parse(text);
    this.hasError = this.tree.rootNode.hasError();
    this.errorLines = this.hasError
      ? collectErrorLines(this.tree.rootNode)
      : new Set();
    this.table = buildSymbolTable(this.tree.rootNode, text);
  }

  getAllIssues(): readonly Issue[] {
    if (!this.rulesResult) {
      this.rulesResult = runRules({
        text: this.text,
        root: this.tree.rootNode,
        table: this.table,
        config: this.config,
      });
    }
    return this.rulesResult;
  }

  /** Rule results cached by `(version, line, line hash)`. */
  getLineIssues(line: number): Issue[] {
    const bounds = lineBounds(this.text, line);
    if (!bounds) {
      return [];
    }

    const key = `${this.version}:${line}:${hashLine(bounds.text)}`;
    const cached = this.lineCache.get(key);
    if (cached) {
      return cached;
    }

    const issues = this.getAllIssues().filter(
      (issue) => issue.range.startLine === line,
    );
    this.lineCache.set(key, issues);
    return issues;
  }

  getTypeFingerprint(): string {
    this.typeFingerprintValue ??= typeFingerprint(
      this.table,
      this.table.symbols.map((symbol) => symbol.name),
    );
    return this.typeFingerprintValue;
  }

  dispose(): void {
    this.tree.delete();
  }
}

/**
 * Expands every ERROR/missing node to the lines it spans. A missing node is zero-width,
 * so it only covers its insertion line.
 */
function collectErrorLines(root: Parser.SyntaxNode): ReadonlySet<number> {
  const lines = new Set<number>();

  const visit = (node: Parser.SyntaxNode): void => {
    if (node.type === 'ERROR' || node.isMissing()) {
      for (let line = node.startPosition.row; line <= node.endPosition.row; line++) {
        lines.add(line);
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
  return lines;
}

export function ruleConfigKey(config: RuleConfig): string {
  const overrides = Object.keys(config.overrides)
    .sort()
    .map((ruleId) => `${ruleId}:${config.overrides[ruleId]}`)
    .join(',');
  return `${config.preset}|${config.stackLimitKB ?? 1024}|${overrides}`;
}
