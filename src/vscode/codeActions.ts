import * as vscode from 'vscode';
import type { DocumentAnalysis } from '../core/analysis';
import {
  buildFormatArityEdits,
  specifierForArgument,
} from '../core/fixes/formatArity';
import { buildIncludeInsert } from '../core/fixes/includeInsert';
import { buildMissingBraceFix } from '../core/fixes/missingBrace';
import { buildStrayDelete } from '../core/fixes/strayDelete';
import {
  expectedArgumentCount,
  parseCallFormat,
} from '../core/rules/format-string';
import { strcmpComparisonFixes } from '../core/rules/char-string-literal';
import { incompleteExpressionSites } from '../core/rules/incomplete-expression';
import { callSites, familyInfo, familyOf } from '../core/rules/library';
import { strcmpFixFor } from '../core/rules/string-eq-literal';
import type { Issue, Range } from '../core/rules/types';
import { findUnclosedOpens } from '../core/rules/unbalanced-braces';
import type { SyntaxNode } from '../core/rules/utils';
import { readCfixSettings } from './config';
import { toDiagnostic } from './diagnostics';
import { DocumentAnalysisService } from './documentAnalysis';

const C_LANGUAGE_ID = 'c';
const BRACE_RULE_ID = 'unbalanced-braces';
const ARITY_RULE_ID = 'format-arg-count';
const INCOMPLETE_RULE_ID = 'incomplete-expression';
const UNINITIALIZED_RULE_ID = 'uninitialized-use';
const STRING_EQ_RULE_ID = 'string-eq-literal';
const CHAR_STRING_RULE_ID = 'char-string-literal';
const INCLUDE_RULE_ID = 'missing-include';
const STRAY_LITERAL_RULE_ID = 'stray-literal';
const DOUBLED_OPERATOR = /^[A-Za-z_]\w*([-+])$/;
const MISSING_INCLUDE_MESSAGE = /^Missing #include <([^>]+)>/;

export interface CodeActionsOptions {
  analysis: DocumentAnalysisService;
  output: vscode.OutputChannel;
}

export function registerCodeActions(
  options: CodeActionsOptions,
): vscode.Disposable {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, range, context) {
      if (document.languageId !== C_LANGUAGE_ID) {
        return [];
      }

      const settings = readCfixSettings();
      if (!settings.enabled || !settings.correctionEnabled) {
        return [];
      }

      try {
        return [
          ...buildBraceActions(options.analysis, document, range, context),
          ...buildFormatArityActions(options.analysis, document, range, context),
          ...buildIncompleteExpressionActions(
            options.analysis,
            document,
            range,
            context,
          ),
          ...buildStringComparisonActions(
            options.analysis,
            document,
            range,
            context,
          ),
          ...buildCharStringLiteralActions(
            options.analysis,
            document,
            range,
            context,
          ),
          ...buildUninitializedActions(
            options.analysis,
            document,
            range,
            context,
          ),
          ...buildIncludeActions(options.analysis, document, range, context),
          ...buildStrayLiteralActions(
            options.analysis,
            document,
            range,
            context,
          ),
        ];
      } catch (error) {
        options.output.appendLine(
          `[D] code actions failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    },
  };

  return vscode.languages.registerCodeActionsProvider(
    { language: C_LANGUAGE_ID },
    provider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  );
}

function buildBraceActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === BRACE_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const unclosedCount = findUnclosedOpens(analysis.rootNode).length;
  const fix = buildMissingBraceFix(analysis.text, unclosedCount);
  if (!fix) {
    return [];
  }

  const position = document.positionAt(fix.offset);
  return issues.map((issue) => {
    const action = new vscode.CodeAction(
      "补上缺失的 '}'",
      vscode.CodeActionKind.QuickFix,
    );

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, position, fix.insert);
    action.edit = edit;

    const diagnostic = matchingDiagnostic(context.diagnostics, issue);
    action.diagnostics = [diagnostic ?? toDiagnostic(document, issue)];
    action.isPreferred = true;
    return action;
  });
}

function buildFormatArityActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === ARITY_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const actions: vscode.CodeAction[] = [];
  for (const issue of issues) {
    const candidate = findExtraArgument(analysis, issue);
    if (!candidate) {
      continue;
    }

    const { call, formatLiteral, extra, mode } = candidate;
    const specifier = specifierForArgument(extra, analysis.table, mode);
    const edits = buildFormatArityEdits(
      call,
      formatLiteral,
      extra,
      specifier ?? '',
    );
    const diagnostic =
      matchingDiagnostic(context.diagnostics, issue) ??
      toDiagnostic(document, issue);

    if (specifier && edits.addSpecifier) {
      const action = new vscode.CodeAction(
        `补上缺失的格式符 '${specifier}'`,
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        toRange(edits.addSpecifier.range),
        edits.addSpecifier.newText,
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      actions.push(action);
    }

    if (edits.dropArgument) {
      const action = new vscode.CodeAction(
        '删除多余的实参',
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        toRange(edits.dropArgument.range),
        edits.dropArgument.newText,
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
  }

  return actions;
}

function buildIncompleteExpressionActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === INCOMPLETE_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const sites = incompleteExpressionSites(analysis.rootNode);
  const actions: vscode.CodeAction[] = [];
  for (const issue of issues) {
    const site = sites.find((candidate) =>
      sameRange(issueRange(issue), nodeRange(candidate.node)),
    );
    if (!site) {
      continue;
    }

    // Only `<identifier>-` / `<identifier>+` immediately before `)` is safe to double.
    const match = DOUBLED_OPERATOR.exec(site.node.text);
    const operator = match?.[1];
    const next = site.node.nextSibling;
    if (!operator || !next || next.type !== ')') {
      continue;
    }

    const action = new vscode.CodeAction(
      `补成 '${site.node.text}${operator}'`,
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      document.uri,
      new vscode.Position(
        site.node.endPosition.row,
        site.node.endPosition.column,
      ),
      operator,
    );
    action.edit = edit;
    const diagnostic =
      matchingDiagnostic(context.diagnostics, issue) ??
      toDiagnostic(document, issue);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    actions.push(action);
  }

  return actions;
}

/**
 * `score > "0"` is primarily fixed by comparing the first character; offer the
 * lexicographic `strcmp` rewrite as the alternative. Equality and multi-character
 * literals already use `strcmp` as the primary fix.
 */
function buildStringComparisonActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === STRING_EQ_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const alternatives = strcmpFixFor({
    text: analysis.text,
    root: analysis.rootNode,
    table: analysis.table,
  });
  const actions: vscode.CodeAction[] = [];

  for (const issue of issues) {
    const diagnostic =
      matchingDiagnostic(context.diagnostics, issue) ??
      toDiagnostic(document, issue);

    if (issue.fix) {
      const action = new vscode.CodeAction(
        actionTitle(issue.fix.newText),
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        toRange(issue.fix.range),
        issue.fix.newText,
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      actions.push(action);
    }

    const alternative = alternatives.find((candidate) =>
      sameRange(issueRange(issue), toRange(candidate.range)),
    );
    if (!alternative || alternative.newText === issue.fix?.newText) {
      continue;
    }

    const action = new vscode.CodeAction(
      `按字典序：${alternative.newText}`,
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      toRange(alternative.range),
      alternative.newText,
    );
    action.edit = edit;
    action.diagnostics = [diagnostic];
    action.isPreferred = false;
    actions.push(action);
  }

  return actions;
}

function actionTitle(newText: string): string {
  return newText.startsWith('strcmp(')
    ? `按字典序：${newText}`
    : `比较第一个字符：${newText}`;
}

/**
 * `score[0] == "NP"` has no safe inline fix: offer `strcmp(score, "NP") == 0` when the
 * other side is `array[constant]`, which makes the array a well-typed first argument.
 */
function buildCharStringLiteralActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === CHAR_STRING_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const alternatives = strcmpComparisonFixes({
    text: analysis.text,
    root: analysis.rootNode,
    table: analysis.table,
  });
  const actions: vscode.CodeAction[] = [];

  for (const issue of issues) {
    const alternative = alternatives.find((candidate) =>
      sameRange(issueRange(issue), toRange(candidate.issueRange)),
    );
    if (!alternative) {
      continue;
    }

    const action = new vscode.CodeAction(
      `改为 ${alternative.newText}`,
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, toRange(alternative.range), alternative.newText);
    action.edit = edit;
    action.diagnostics = [
      matchingDiagnostic(context.diagnostics, issue) ??
        toDiagnostic(document, issue),
    ];
    actions.push(action);
  }

  return actions;
}

/**
 * `uninitialized-use` anchors its fix at the declaration, which is usually another
 * line: inline ghost text cannot render it, so expose it as an explicit QuickFix.
 */
function buildUninitializedActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const actions: vscode.CodeAction[] = [];

  for (const issue of analysis.getAllIssues()) {
    const fix = issue.fix;
    if (
      issue.ruleId !== UNINITIALIZED_RULE_ID ||
      !fix ||
      fix.range.startLine === issue.range.startLine ||
      !(
        intersects(range, issueRange(issue)) ||
        range.start.line === issue.range.startLine
      )
    ) {
      continue;
    }

    const value = fix.newText.replace(/^\s*=\s*/, '').trim();
    const action = new vscode.CodeAction(
      `初始化为 ${value}`,
      vscode.CodeActionKind.QuickFix,
    );

    const edit = new vscode.WorkspaceEdit();
    const offset = document.offsetAt(
      new vscode.Position(fix.range.startLine, fix.range.startChar),
    );
    edit.insert(document.uri, document.positionAt(offset), fix.newText);
    action.edit = edit;
    action.diagnostics = [
      matchingDiagnostic(context.diagnostics, issue) ??
        toDiagnostic(document, issue),
    ];
    action.isPreferred = true;
    actions.push(action);
  }

  return actions;
}

/**
 * `missing-include` is anchored at the first call that needs the header, but the edit
 * lives at the top of the file: expose it as an explicit QuickFix.
 */
function buildIncludeActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === INCLUDE_RULE_ID &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const actions: vscode.CodeAction[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const header = MISSING_INCLUDE_MESSAGE.exec(issue.message)?.[1];
    if (!header || seen.has(header)) {
      continue;
    }

    const insert = buildIncludeInsert(analysis.text, header);
    if (!insert) {
      continue;
    }
    seen.add(header);

    const action = new vscode.CodeAction(
      `插入 #include <${header}>`,
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      document.uri,
      new vscode.Position(insert.line, insert.character),
      insert.text,
    );
    action.edit = edit;
    action.diagnostics = [
      matchingDiagnostic(context.diagnostics, issue) ??
        toDiagnostic(document, issue),
    ];
    action.isPreferred = true;
    actions.push(action);
  }

  return actions;
}

/**
 * Cross-line `stray-literal` issues carry no inline fix (the ghost invariant is
 * single-line), so deleting the whole ERROR node is offered as a lightbulb instead.
 */
function buildStrayLiteralActions(
  analysisService: DocumentAnalysisService,
  document: vscode.TextDocument,
  range: vscode.Range,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const analysis = analysisService.get(document);
  const issues = analysis
    .getAllIssues()
    .filter(
      (issue) =>
        issue.ruleId === STRAY_LITERAL_RULE_ID &&
        !issue.fix &&
        (intersects(range, issueRange(issue)) ||
          range.start.line === issue.range.startLine),
    );
  if (issues.length === 0) {
    return [];
  }

  const actions: vscode.CodeAction[] = [];
  for (const issue of issues) {
    const start = document.offsetAt(
      new vscode.Position(issue.range.startLine, issue.range.startChar),
    );
    const end = document.offsetAt(
      new vscode.Position(issue.range.endLine, issue.range.endChar),
    );
    const deletion = buildStrayDelete(analysis.text, start, end);
    if (!deletion) {
      continue;
    }

    const action = new vscode.CodeAction(
      '删除多余的数值',
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, toRange(deletion.range), deletion.newText);
    action.edit = edit;
    action.diagnostics = [
      matchingDiagnostic(context.diagnostics, issue) ??
        toDiagnostic(document, issue),
    ];
    action.isPreferred = true;
    actions.push(action);
  }

  return actions;
}

interface ExtraArgument {
  call: SyntaxNode;
  formatLiteral: SyntaxNode;
  extra: SyntaxNode;
  mode: 'printf' | 'scanf';
}

/** Re-locates the single surplus argument behind a `format-arg-count` issue. */
function findExtraArgument(
  analysis: DocumentAnalysis,
  issue: Issue,
): ExtraArgument | undefined {
  for (const site of callSites(analysis.rootNode)) {
    const family = familyOf(site.name);
    if (!family) {
      continue;
    }
    const info = familyInfo(family);
    const format = parseCallFormat(site.call, info.formatIndex, info.mode);
    if (!format || !format.supported) {
      continue;
    }

    const valueArguments = site.args.slice(info.formatIndex + 1);
    const expected = expectedArgumentCount(format, info.mode);
    if (valueArguments.length !== expected + 1) {
      continue;
    }
    const extra = valueArguments[expected];
    if (!extra) {
      continue;
    }
    if (!sameRange(issueRange(issue), nodeRange(extra))) {
      continue;
    }
    return {
      call: site.call,
      formatLiteral: format.literal,
      extra,
      mode: info.mode,
    };
  }
  return undefined;
}

function nodeRange(node: SyntaxNode): vscode.Range {
  return new vscode.Range(
    node.startPosition.row,
    node.startPosition.column,
    node.endPosition.row,
    node.endPosition.column,
  );
}

function toRange(range: Range): vscode.Range {
  return new vscode.Range(
    range.startLine,
    range.startChar,
    range.endLine,
    range.endChar,
  );
}

function issueRange(issue: Issue): vscode.Range {
  return new vscode.Range(
    issue.range.startLine,
    issue.range.startChar,
    issue.range.endLine,
    issue.range.endChar,
  );
}

function intersects(left: vscode.Range, right: vscode.Range): boolean {
  return (
    left.start.isBeforeOrEqual(right.end) &&
    right.start.isBeforeOrEqual(left.end)
  );
}

function matchingDiagnostic(
  diagnostics: readonly vscode.Diagnostic[],
  issue: Issue,
): vscode.Diagnostic | undefined {
  const range = issueRange(issue);
  return diagnostics.find(
    (diagnostic) =>
      diagnostic.code === issue.ruleId &&
      sameRange(diagnostic.range, range),
  );
}

function sameRange(left: vscode.Range, right: vscode.Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}
