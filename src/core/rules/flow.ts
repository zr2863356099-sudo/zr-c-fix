import { typeFromSpecifierNode } from '../symbols';
import type { TypeInfo } from '../types';
import { collectNodes, type SyntaxNode } from './utils';

export interface FunctionDefinitionInfo {
  node: SyntaxNode;
  nameNode: SyntaxNode;
  name: string;
  returnType: TypeInfo;
  body: SyntaxNode | undefined;
}

export function functionDefinitions(root: SyntaxNode): FunctionDefinitionInfo[] {
  const definitions: FunctionDefinitionInfo[] = [];

  for (const node of collectNodes(root, 'function_definition')) {
    const declarator = node.childForFieldName('declarator');
    const nameNode = findDeclaratorName(declarator);
    if (!nameNode) {
      continue;
    }
    const typeNode = node.childForFieldName('type');
    definitions.push({
      node,
      nameNode,
      name: nameNode.text,
      returnType: typeFromSpecifierNode(typeNode),
      body: node.childForFieldName('body') ?? undefined,
    });
  }

  return definitions;
}

/** True when every control-flow path through `statement` exits with a value. */
export function alwaysReturnsValue(statement: SyntaxNode): boolean {
  switch (statement.type) {
    case 'return_statement':
      return statement.namedChildren.length > 0;

    case 'compound_statement':
      return sequenceReturnsValue(statement.namedChildren);

    case 'if_statement': {
      const consequence = statement.childForFieldName('consequence');
      const elseClause = statement.childForFieldName('alternative');
      const alternate = elseClause?.namedChildren[0];
      return (
        consequence !== null &&
        alternate !== undefined &&
        alwaysReturnsValue(consequence) &&
        alwaysReturnsValue(alternate)
      );
    }

    case 'else_clause': {
      const alternate = statement.namedChildren[0];
      return alternate !== undefined && alwaysReturnsValue(alternate);
    }

    case 'do_statement': {
      const body = statement.childForFieldName('body');
      return body !== null && alwaysReturnsValue(body);
    }

    case 'while_statement':
    case 'for_statement':
      return loopNeverFallsThrough(statement);

    case 'labeled_statement': {
      const inner = statement.namedChildren[0];
      return inner !== undefined && alwaysReturnsValue(inner);
    }

    default:
      return false;
  }
}

export function sequenceReturnsValue(statements: readonly SyntaxNode[]): boolean {
  for (const statement of statements) {
    if (alwaysReturnsValue(statement)) {
      return true;
    }
  }
  return false;
}

/** Bare `return;` inside a non-void function. */
export function bareReturns(body: SyntaxNode): SyntaxNode[] {
  return collectNodes(body, 'return_statement').filter(
    (node) => node.namedChildren.length === 0,
  );
}

/**
 * Control flow the small model cannot reason about. Functions containing these are
 * skipped by `nonvoid-missing-return` instead of guessed.
 */
export function hasUnsupportedFlow(body: SyntaxNode): boolean {
  return (
    collectNodes(body, 'switch_statement').length > 0 ||
    collectNodes(body, 'goto_statement').length > 0
  );
}

export function isRecursive(info: FunctionDefinitionInfo): boolean {
  if (!info.body) {
    return false;
  }
  return collectNodes(info.body, 'call_expression').some((call) => {
    const callee = call.childForFieldName('function') ?? call.namedChild(0);
    return callee?.type === 'identifier' && callee.text === info.name;
  });
}

function loopNeverFallsThrough(loop: SyntaxNode): boolean {
  const body = loop.childForFieldName('body');
  if (!body) {
    return false;
  }
  if (collectNodes(body, 'break_statement').length > 0) {
    return false;
  }

  if (loop.type === 'for_statement') {
    const condition = loop.childForFieldName('condition');
    if (condition && !isAlwaysTrue(condition)) {
      return false;
    }
    return true;
  }

  const condition = loop.childForFieldName('condition');
  return condition !== null && isAlwaysTrue(condition);
}

function isAlwaysTrue(condition: SyntaxNode): boolean {
  const text = condition.text.trim();
  return /^(?:1|0[xX]0*1|0[0-7]*[1-7][0-7]*)$/.test(text) ||
    (condition.type === 'parenthesized_expression' &&
      condition.namedChild(0) !== null &&
      isAlwaysTrue(condition.namedChild(0)!));
}

function findDeclaratorName(
  declarator: SyntaxNode | null,
): SyntaxNode | undefined {
  let current = declarator;
  while (current) {
    if (current.type === 'identifier') {
      return current;
    }
    const next: SyntaxNode | null =
      current.childForFieldName('declarator') ?? null;
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return undefined;
}
