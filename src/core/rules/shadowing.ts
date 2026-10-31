import type { Issue, Rule } from './types';
import {
  declaratorIdentifier,
  makeIssue,
  rangeFromNode,
  type SyntaxNode,
} from './utils';

const DECLARATOR_TYPES = new Set([
  'identifier',
  'init_declarator',
  'pointer_declarator',
  'array_declarator',
  'function_declarator',
  'parenthesized_declarator',
  'attributed_declarator',
]);

export const rule: Rule = {
  id: 'shadowing',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues: Issue[] = [];
    /** File-scope names visible at the current top-level position. */
    const fileScope = new Set<string>();

    for (const child of ctx.root.namedChildren) {
      if (child.type === 'declaration') {
        for (const identifier of declaredNames(child)) {
          fileScope.add(identifier.text);
        }
        continue;
      }
      if (child.type !== 'function_definition') {
        continue;
      }
      walkFunction(child, fileScope, issues);
    }

    return issues;
  },
};

function walkFunction(
  definition: SyntaxNode,
  fileScope: ReadonlySet<string>,
  issues: Issue[],
): void {
  const parameters = new Set<string>();
  for (const name of parameterNames(definition)) {
    if (fileScope.has(name.text)) {
      issues.push(shadowIssue(name));
    }
    parameters.add(name.text);
  }

  const body = definition.childForFieldName('body');
  if (!body) {
    return;
  }

  const scopes: Set<string>[] = [new Set(fileScope), parameters];
  walkNode(body, scopes, issues);
}

function walkNode(
  node: SyntaxNode,
  scopes: Set<string>[],
  issues: Issue[],
): void {
  switch (node.type) {
    case 'compound_statement': {
      scopes.push(new Set());
      for (const child of node.namedChildren) {
        walkNode(child, scopes, issues);
      }
      scopes.pop();
      return;
    }

    case 'declaration':
      processDeclaration(node, scopes, issues);
      return;

    case 'for_statement': {
      const initializer = node.childForFieldName('initializer');
      scopes.push(new Set());
      if (initializer) {
        walkNode(initializer, scopes, issues);
      }
      for (const child of node.namedChildren) {
        if (child.id === initializer?.id) {
          continue;
        }
        walkNode(child, scopes, issues);
      }
      scopes.pop();
      return;
    }

    case 'function_definition':
      return;

    default:
      for (const child of node.namedChildren) {
        walkNode(child, scopes, issues);
      }
  }
}

function processDeclaration(
  declaration: SyntaxNode,
  scopes: Set<string>[],
  issues: Issue[],
): void {
  const current = scopes[scopes.length - 1];
  if (!current) {
    return;
  }

  for (const child of declaration.namedChildren) {
    if (!DECLARATOR_TYPES.has(child.type) || isFunctionDeclaration(child)) {
      continue;
    }
    const name = declaratorIdentifier(child);
    if (!name) {
      continue;
    }
    for (let index = 0; index < scopes.length - 1; index++) {
      if (scopes[index]?.has(name.text)) {
        issues.push(shadowIssue(name));
        break;
      }
    }
    current.add(name.text);
  }
}

function declaredNames(declaration: SyntaxNode): SyntaxNode[] {
  const names: SyntaxNode[] = [];
  for (const child of declaration.namedChildren) {
    if (!DECLARATOR_TYPES.has(child.type) || isFunctionDeclaration(child)) {
      continue;
    }
    const name = declaratorIdentifier(child);
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function parameterNames(definition: SyntaxNode): SyntaxNode[] {
  let current = definition.childForFieldName('declarator');
  while (current) {
    if (current.type === 'function_declarator') {
      const parameters = current.childForFieldName('parameters');
      if (!parameters) {
        return [];
      }
      const names: SyntaxNode[] = [];
      for (const parameter of parameters.namedChildren) {
        const name = declaratorIdentifier(
          parameter.childForFieldName('declarator'),
        );
        if (name) {
          names.push(name);
        }
      }
      return names;
    }
    current = current.childForFieldName('declarator');
  }
  return [];
}

/**
 * `int f(int);` declares a function, while `int (*p)(int);` declares a variable.
 * Parentheses around the declarator are what separate the two.
 */
function isFunctionDeclaration(declarator: SyntaxNode): boolean {
  let current: SyntaxNode | null = declarator;
  let sawFunction = false;
  while (current) {
    if (current.type === 'parenthesized_declarator') {
      return false;
    }
    if (current.type === 'function_declarator') {
      sawFunction = true;
    }
    current = current.childForFieldName('declarator');
  }
  return sawFunction;
}

function shadowIssue(name: SyntaxNode) {
  return makeIssue(
    rule,
    rangeFromNode(name),
    `'${name.text}' shadows an outer declaration`,
    `'${name.text}' 遮蔽了外层同名变量`,
  );
}
