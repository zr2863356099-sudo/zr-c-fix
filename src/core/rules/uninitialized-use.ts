import type { SymbolTable } from '../symbols';
import type { Issue, Range, Rule } from './types';
import {
  collectNodes,
  declaratorIdentifier,
  makeIssue,
  rangeFromNode,
  unwrapParentheses,
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

const STATEMENT_TYPES = new Set([
  'compound_statement',
  'declaration',
  'if_statement',
  'while_statement',
  'do_statement',
  'for_statement',
  'expression_statement',
  'return_statement',
  'switch_statement',
  'labeled_statement',
  'break_statement',
  'continue_statement',
  'goto_statement',
]);

const COMPARISON_OPERATORS = new Set(['<', '>', '<=', '>=']);

type UsageKind = 'comparison' | 'multiplicative' | 'additive' | 'other';

const USAGE_PRIORITY: Record<UsageKind, number> = {
  comparison: 3,
  multiplicative: 2,
  additive: 1,
  other: 0,
};

interface DeclInfo {
  nameNode: SyntaxNode;
  name: string;
  tracked: boolean;
  isPointer: boolean;
  suggestion?: string;
}

interface WalkContext {
  text: string;
  table: SymbolTable;
  infos: Map<number, DeclInfo>;
  issues: Issue[];
  reported: Set<number>;
}

export const rule: Rule = {
  id: 'uninitialized-use',
  channel: 'hint',
  severity: 'warning',

  check(ctx) {
    const issues: Issue[] = [];

    for (const definition of collectNodes(ctx.root, 'function_definition')) {
      const body = definition.childForFieldName('body');
      if (!body || body.hasError()) {
        continue;
      }

      const infos = collectDeclarations(body, ctx.table, ctx.text);
      const context: WalkContext = {
        text: ctx.text,
        table: ctx.table,
        infos,
        issues,
        reported: new Set(),
      };
      processStatements(body.namedChildren, new Set(), context);
    }

    return issues;
  },
};

function collectDeclarations(
  body: SyntaxNode,
  table: SymbolTable,
  text: string,
): Map<number, DeclInfo> {
  const infos = new Map<number, DeclInfo>();

  for (const declaration of collectNodes(body, 'declaration')) {
    const storage = storageClass(declaration);
    for (const child of declaration.namedChildren) {
      if (
        !DECLARATOR_TYPES.has(child.type) ||
        isFunctionDeclaration(child) ||
        isArrayDeclarator(child)
      ) {
        continue;
      }
      const nameNode = declaratorIdentifier(child);
      if (!nameNode) {
        continue;
      }

      const symbol = table.symbols.find(
        (entry) => entry.declNodeId === nameNode.id,
      );
      const type = symbol?.type;
      const tracked =
        storage === undefined &&
        type !== undefined &&
        type.base !== 'unknown' &&
        type.base !== 'void' &&
        type.base !== 'struct' &&
        (type.dims?.length ?? 0) === 0;

      infos.set(nameNode.id, {
        nameNode,
        name: nameNode.text,
        tracked,
        isPointer: (type?.ptr ?? 0) > 0,
      });
    }
  }

  const kinds = new Map<number, UsageKind>();
  for (const identifier of collectNodes(body, 'identifier')) {
    const symbol = table.resolve(identifier.text, identifier);
    if (!symbol || !infos.has(symbol.declNodeId)) {
      continue;
    }
    const kind = classifyUsage(
      identifier,
      symbol.name,
      symbol.declNodeId,
      table,
      text,
    );
    const previous = kinds.get(symbol.declNodeId) ?? 'other';
    kinds.set(symbol.declNodeId, mergeUsageKinds(previous, kind));
  }

  for (const [id, info] of infos) {
    if (!info.tracked) {
      continue;
    }
    info.suggestion = suggestionFor(info, kinds.get(id) ?? 'other');
  }

  return infos;
}

/** Classifies one occurrence of a declared variable by how it is read. */
function classifyUsage(
  node: SyntaxNode,
  name: string,
  declNodeId: number,
  table: SymbolTable,
  text: string,
): UsageKind {
  let current = node;
  while (current.parent?.type === 'parenthesized_expression') {
    current = current.parent;
  }

  const parent = current.parent;
  if (parent?.type === 'binary_expression') {
    const left = parent.childForFieldName('left');
    const right = parent.childForFieldName('right');
    const isLeft = left?.id === current.id;
    const isRight = right?.id === current.id;
    if (isLeft || isRight) {
      const other = isLeft ? right : left;
      const operator = operatorBetween(text, parent);
      if (operator && COMPARISON_OPERATORS.has(operator)) {
        return other && containsIdentifier(other, name, declNodeId, table)
          ? 'other'
          : 'comparison';
      }
      if (operator === '*') {
        return 'multiplicative';
      }
      if (operator === '+') {
        return 'additive';
      }
    }
  }

  if (parent?.type === 'assignment_expression') {
    const left = parent.childForFieldName('left');
    if (left?.id === current.id) {
      const operator = operatorBetween(text, parent);
      if (operator === '*=') {
        return 'multiplicative';
      }
      if (operator === '+=') {
        return 'additive';
      }
    }
  }

  return 'other';
}

function containsIdentifier(
  node: SyntaxNode,
  name: string,
  declNodeId: number,
  table: SymbolTable,
): boolean {
  return collectNodes(node, 'identifier').some(
    (identifier) =>
      identifier.text === name &&
      table.resolve(name, identifier)?.declNodeId === declNodeId,
  );
}

function mergeUsageKinds(left: UsageKind, right: UsageKind): UsageKind {
  return USAGE_PRIORITY[right] > USAGE_PRIORITY[left] ? right : left;
}

function suggestionFor(info: DeclInfo, kind: UsageKind): string | undefined {
  if (kind === 'comparison') {
    return undefined;
  }
  if (info.isPointer) {
    return ' = NULL';
  }
  return kind === 'multiplicative' ? ' = 1' : ' = 0';
}

function insertionAfter(node: SyntaxNode): Range {
  const line = node.endPosition.row;
  const char = node.endPosition.column;
  return { startLine: line, startChar: char, endLine: line, endChar: char };
}

function processStatements(
  statements: readonly SyntaxNode[],
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  let next = state;
  for (const statement of statements) {
    next = processNode(statement, next, context);
  }
  return next;
}

function processNode(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  if (!STATEMENT_TYPES.has(node.type)) {
    return processExpression(node, state, context);
  }
  return processStatement(node, state, context);
}

function processStatement(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  switch (node.type) {
    case 'compound_statement':
      return processStatements(node.namedChildren, state, context);

    case 'declaration':
      return processDeclaration(node, state, context);

    case 'if_statement':
      return processIf(node, state, context);

    case 'while_statement': {
      const condition = node.childForFieldName('condition');
      const afterCondition = condition
        ? processExpression(condition, state, context)
        : state;
      const body = node.childForFieldName('body');
      const afterBody = body
        ? processStatement(body, cloneState(afterCondition), context)
        : cloneState(afterCondition);
      return unionState(afterCondition, afterBody);
    }

    case 'do_statement': {
      const body = node.childForFieldName('body');
      const afterBody = body
        ? processStatement(body, state, context)
        : state;
      const condition = node.childForFieldName('condition');
      return condition
        ? processExpression(condition, afterBody, context)
        : afterBody;
    }

    case 'for_statement': {
      const initializer = node.childForFieldName('initializer');
      let afterInit = initializer
        ? processNode(initializer, state, context)
        : state;
      const condition = node.childForFieldName('condition');
      if (condition) {
        afterInit = processExpression(condition, afterInit, context);
      }
      const body = node.childForFieldName('body');
      // Zero iterations are possible, so the entry state survives the loop.
      const entry = cloneState(afterInit);
      let afterBody = body
        ? processStatement(body, cloneState(afterInit), context)
        : cloneState(afterInit);
      const update = node.childForFieldName('update');
      if (update) {
        afterBody = processExpression(update, afterBody, context);
      }
      return unionState(entry, afterBody);
    }

    case 'expression_statement':
      return processChildren(node, state, context);

    case 'return_statement':
      return processChildren(node, state, context);

    case 'switch_statement': {
      const condition = node.childForFieldName('condition');
      const afterCondition = condition
        ? processExpression(condition, state, context)
        : state;
      const afterBody = processChildren(
        node,
        cloneState(afterCondition),
        context,
      );
      return unionState(afterCondition, afterBody);
    }

    case 'labeled_statement':
      return processChildren(node, state, context);

    default:
      return state;
  }
}

function processIf(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  const condition = node.childForFieldName('condition');
  const afterCondition = condition
    ? processExpression(condition, state, context)
    : state;

  const consequence = node.childForFieldName('consequence');
  const elseClause = node.childForFieldName('alternative');
  const alternate = elseClause?.namedChildren[0];

  const consequenceState = consequence
    ? processStatement(consequence, cloneState(afterCondition), context)
    : cloneState(afterCondition);
  const alternateState = alternate
    ? processStatement(alternate, cloneState(afterCondition), context)
    : cloneState(afterCondition);

  return unionState(consequenceState, alternateState);
}

function processChildren(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  let next = state;
  for (const child of node.namedChildren) {
    next = processNode(child, next, context);
  }
  return next;
}

function processDeclaration(
  declaration: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  let next = state;

  for (const child of declaration.namedChildren) {
    if (!DECLARATOR_TYPES.has(child.type) || isFunctionDeclaration(child)) {
      continue;
    }
    const nameNode = declaratorIdentifier(child);
    if (!nameNode) {
      continue;
    }

    const value = initializerValue(child);
    if (value) {
      reportSelfInitializer(value, nameNode, context);
      next = processExpression(value, next, context);
    }

    const info = context.infos.get(nameNode.id);
    if (!info?.tracked) {
      continue;
    }
    if (value) {
      next.delete(nameNode.id);
    } else {
      next.add(nameNode.id);
    }
  }

  return next;
}

function processExpression(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  let next = state;
  let current = node;

  switch (current.type) {
    case 'identifier':
      next = readSymbol(current, next, context);
      return next;

    case 'number_literal':
    case 'string_literal':
    case 'char_literal':
    case 'comment':
      return next;

    case 'sizeof_expression':
      // The operand of sizeof is not evaluated.
      return next;

    case 'cast_expression': {
      const value = current.childForFieldName('value');
      return value ? processExpression(value, next, context) : next;
    }

    case 'pointer_expression': {
      if (!isAddressOf(current)) {
        break;
      }
      const argument = current.childForFieldName('argument') ?? current.namedChild(0);
      const target = argument ? unwrapParentheses(argument) : undefined;
      if (target?.type === 'identifier') {
        const symbol = context.table.resolve(target.text, target);
        if (symbol) {
          next.delete(symbol.declNodeId);
        }
        return next;
      }
      return processExpression(argument ?? current, next, context);
    }

    case 'assignment_expression': {
      const left = current.childForFieldName('left');
      const right = current.childForFieldName('right');
      const operator = operatorBetween(context.text, current);
      if (right) {
        next = processExpression(right, next, context);
      }
      if (!left) {
        return next;
      }
      const target = unwrapParentheses(left);
      if (operator !== '=') {
        next = processExpression(left, next, context);
      }
      if (target.type === 'identifier') {
        const symbol = context.table.resolve(target.text, target);
        if (symbol) {
          next.delete(symbol.declNodeId);
        }
        return next;
      }
      if (operator === '=') {
        next = processExpression(left, next, context);
      }
      return next;
    }

    case 'update_expression': {
      const argument = current.childForFieldName('argument') ?? current.namedChild(0);
      const target = argument ? unwrapParentheses(argument) : undefined;
      if (target?.type === 'identifier') {
        next = readSymbol(target, next, context);
        const symbol = context.table.resolve(target.text, target);
        if (symbol) {
          next.delete(symbol.declNodeId);
        }
        return next;
      }
      return argument ? processExpression(argument, next, context) : next;
    }

    case 'call_expression': {
      const callee = current.childForFieldName('function') ?? current.namedChild(0);
      // A plain identifier callee is a function name, not a variable read.
      if (callee && callee.type !== 'identifier') {
        next = processExpression(callee, next, context);
      }
      const args = current.childForFieldName('arguments') ?? current.namedChild(1);
      if (args) {
        for (const argument of args.namedChildren) {
          next = processExpression(argument, next, context);
        }
      }
      return next;
    }

    default:
      break;
  }

  for (const child of current.namedChildren) {
    next = processExpression(child, next, context);
  }
  return next;
}

function readSymbol(
  node: SyntaxNode,
  state: Set<number>,
  context: WalkContext,
): Set<number> {
  const symbol = context.table.resolve(node.text, node);
  if (
    !symbol ||
    !state.has(symbol.declNodeId) ||
    context.reported.has(symbol.declNodeId)
  ) {
    return state;
  }

  context.reported.add(symbol.declNodeId);
  const info = context.infos.get(symbol.declNodeId);
  const fix =
    info && info.suggestion !== undefined
      ? { range: insertionAfter(info.nameNode), newText: info.suggestion }
      : undefined;
  context.issues.push(
    makeIssue(
      rule,
      rangeFromNode(node),
      `'${node.text}' may be used uninitialized`,
      `'${node.text}' 可能未初始化就被使用`,
      fix,
    ),
  );
  return state;
}

/**
 * `int x = x + 1;` reads the variable while its own initializer is being evaluated.
 * The initial value cannot be derived from the usage, so no fix is offered.
 */
function reportSelfInitializer(
  value: SyntaxNode,
  nameNode: SyntaxNode,
  context: WalkContext,
): void {
  if (context.reported.has(nameNode.id)) {
    return;
  }
  const reference = selfReference(value, nameNode, context.table);
  if (!reference) {
    return;
  }

  context.reported.add(nameNode.id);
  context.issues.push(
    makeIssue(
      rule,
      rangeFromNode(reference),
      `'${nameNode.text}' is used in its own initializer`,
      `'${nameNode.text}' 在自己的初始化表达式中被使用`,
    ),
  );
}

function selfReference(
  node: SyntaxNode,
  nameNode: SyntaxNode,
  table: SymbolTable,
): SyntaxNode | undefined {
  // sizeof does not evaluate its operand, so `sizeof(x)` is not a read of x.
  if (node.type === 'sizeof_expression') {
    return undefined;
  }
  if (node.type === 'identifier') {
    if (node.text !== nameNode.text) {
      return undefined;
    }
    return table.resolve(node.text, node)?.declNodeId === nameNode.id
      ? node
      : undefined;
  }

  for (const child of node.namedChildren) {
    const found = selfReference(child, nameNode, table);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function initializerValue(declarator: SyntaxNode): SyntaxNode | undefined {
  let current: SyntaxNode | null = declarator;
  while (current) {
    if (current.type === 'init_declarator') {
      return current.childForFieldName('value') ?? undefined;
    }
    current = current.childForFieldName('declarator');
  }
  return undefined;
}

function isFunctionDeclaration(declarator: SyntaxNode): boolean {  let current: SyntaxNode | null = declarator;
  let sawFunction = false;
  while (current) {
    if (current.type === 'parenthesized_declarator') {
      // `int (*p)(int);` declares a function-pointer variable.
      return false;
    }
    if (current.type === 'function_declarator') {
      sawFunction = true;
    }
    current = current.childForFieldName('declarator');
  }
  return sawFunction;
}

function isArrayDeclarator(declarator: SyntaxNode): boolean {
  let current: SyntaxNode | null = declarator;
  while (current) {
    if (current.type === 'array_declarator') {
      return true;
    }
    current =
      current.childForFieldName('declarator') ?? current.namedChild(0);
  }
  return false;
}

function storageClass(declaration: SyntaxNode): string | undefined {
  for (const child of declaration.namedChildren) {
    if (child.type === 'storage_class_specifier') {
      return child.text.trim();
    }
  }
  return undefined;
}

function isAddressOf(node: SyntaxNode): boolean {
  return node.text.trimStart().startsWith('&');
}

function operatorBetween(
  text: string,
  node: SyntaxNode,
): string | undefined {
  const left = node.childForFieldName('left') ?? node.namedChild(0);
  const right =
    node.childForFieldName('right') ??
    node.namedChild(node.namedChildCount - 1);
  if (!left || !right) {
    return undefined;
  }
  return text.slice(left.endIndex, right.startIndex).trim();
}

function cloneState(state: Set<number>): Set<number> {
  return new Set(state);
}

function unionState(left: Set<number>, right: Set<number>): Set<number> {
  const result = new Set(left);
  for (const value of right) {
    result.add(value);
  }
  return result;
}
