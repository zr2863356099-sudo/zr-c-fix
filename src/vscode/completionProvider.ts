import * as vscode from 'vscode';
import { getCompletions } from '../core/completion';

const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/;

export function registerCompletionProvider(
  isEnabled: () => boolean = () => true,
): vscode.Disposable {
  return vscode.languages.registerInlineCompletionItemProvider(
    { language: 'c' },
    {
      provideInlineCompletionItems(document, position) {
        if (!isEnabled()) {
          return [];
        }

        const candidates = getCompletions(document.getText(), position.line, position.character, {
          loaded: true,
        });

        return candidates.map((candidate) => {
          const wordRange = document.getWordRangeAtPosition(position, IDENTIFIER_PATTERN);
          const range =
            wordRange ??
            new vscode.Range(
              candidate.range.line,
              candidate.range.startChar,
              candidate.range.line,
              candidate.range.endChar,
            );
          const item = new vscode.InlineCompletionItem(
            new vscode.SnippetString(candidate.insertText),
            range,
          );
          item.filterText = candidate.filterText;
          return item;
        });
      },
    },
  );
}
