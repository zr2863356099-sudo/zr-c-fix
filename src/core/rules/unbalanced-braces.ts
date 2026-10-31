import type { Rule } from './types';
import {
  makeIssue,
  maskNonCode,
  positionAt,
  type SyntaxNode,
} from './utils';

/**
 * Opening braces left unmatched at the end of the tree, in document order. Braces in
 * comments, strings and character literals are ignored.
 */
export function findUnclosedOpens(root: SyntaxNode): SyntaxNode[] {
  const masked = maskNonCode(root.text);
  const stack: number[] = [];

  for (let index = 0; index < masked.length; index++) {
    const ch = masked[index];
    if (ch === '{') {
      stack.push(index);
    } else if (ch === '}') {
      stack.pop();
    }
  }

  return stack.map((offset) => {
    const start = root.startIndex + offset;
    return root.descendantForIndex(start, start + 1);
  });
}

export const rule: Rule = {
  id: 'unbalanced-braces',
  channel: 'hint',
  severity: 'error',

  check(ctx) {
    const masked = maskNonCode(ctx.text);
    const issues = [];

    for (const node of findUnclosedOpens(ctx.root)) {
      const offset = node.startIndex;
      // A block that was just opened and still has no body is the typing intermediate
      // state; wait for the student to keep writing before nagging.
      if (!/\S/.test(masked.slice(offset + 1))) {
        continue;
      }

      const position = positionAt(ctx.text, offset);
      issues.push(
        makeIssue(
          rule,
          {
            startLine: position.line,
            startChar: position.char,
            endLine: position.line,
            endChar: position.char + 1,
          },
          "Unclosed '{'",
          "未闭合的 '{'",
        ),
      );
    }
    return issues;
  },
};
