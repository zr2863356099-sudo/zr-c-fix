import { collectDefines } from './constants';
import { damerauLevenshtein } from './edit-distance';
import { knownHeadersOnly } from './headers';
import {
  fileFunctionNames,
  functionPointerNames,
  isKnownSignature,
} from './library';
import type { Issue, Rule } from './types';
import {
  collectNodes,
  makeIssue,
  rangeFromNode,
  type SyntaxNode,
} from './utils';

const MAX_DISTANCE = 2;
const MIN_CANDIDATE_LENGTH = 2;

/**
 * Names provided by the standard library or common headers. System headers are never
 * read, so these cannot appear in the symbol table but are still declared in C.
 */
const PREDEFINED_NAMES = new Set([
  'NULL',
  'EOF',
  'stdin',
  'stdout',
  'stderr',
  'EXIT_SUCCESS',
  'EXIT_FAILURE',
  'INT_MAX',
  'INT_MIN',
  'UINT_MAX',
  'LLONG_MAX',
  'LLONG_MIN',
  'RAND_MAX',
  'CHAR_BIT',
  'M_PI',
  'size_t',
  'ssize_t',
  'ptrdiff_t',
  'FILE',
  'true',
  'false',
  'bool',
  'errno',
]);

const DECLARATOR_TYPES = new Set([
  'identifier',
  'init_declarator',
  'pointer_declarator',
  'array_declarator',
  'function_declarator',
  'parenthesized_declarator',
  'attributed_declarator',
]);

/** Subtrees that never contain a variable read or write. */
const SKIPPED_NODE_TYPES = new Set([
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'field_declaration',
  'field_declaration_list',
  'type_definition',
  'parameter_declaration',
  'function_declarator',
  'attribute_specifier',
  'attribute_declaration',
]);

export const rule: Rule = {
  id: 'undeclared-variable',
  channel: 'ghost',
  severity: 'error',

  check(ctx) {
    // Unknown headers may declare globals and macros that are not in our table.
    const headersKnown = knownHeadersOnly(ctx.root);
    const declared = new Set(ctx.table.symbols.map((symbol) => symbol.name));
    for (const name of fileFunctionNames(ctx.root)) {
      declared.add(name);
    }
    for (const name of functionPointerNames(ctx.root)) {
      declared.add(name);
    }
    for (const name of collectDefines(ctx.root).names) {
      declared.add(name);
    }
    for (const enumerator of collectNodes(ctx.root, 'enumerator')) {
      const nameNode =
        enumerator.childForFieldName('name') ?? enumerator.namedChild(0);
      if (nameNode) {
        declared.add(nameNode.text);
      }
    }

    const candidates = Array.from(
      new Set(
        ctx.table.symbols
          .map((symbol) => symbol.name)
          .filter((name) => name.length >= MIN_CANDIDATE_LENGTH),
      ),
    );

    const issues: Issue[] = [];
    const reported = new Set<string>();
    for (const node of expressionIdentifiers(ctx.root)) {
      const name = node.text;
      if (
        declared.has(name) ||
        isKnownSignature(name) ||
        PREDEFINED_NAMES.has(name)
      ) {
        continue;
      }
      // ALL_CAPS names are probably macros; no local declaration is expected.
      if (!/[a-z]/.test(name)) {
        continue;
      }
      if (name.length < 1) {
        continue;
      }

      // One issue per identifier per line, anchored at its first occurrence.
      const key = `${node.startPosition.row}:${name}`;
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);

      const candidate = closestCandidate(name, candidates);
      const range = rangeFromNode(node);
      if (isForInitializerAssignmentTarget(node)) {
        // `for ( i = 0; ...)` is missing the declaration, not a typo.
        issues.push(
          makeIssue(
            rule,
            range,
            `Unknown identifier '${name}'`,
            `未声明的标识符 '${name}'`,
            {
              range: {
                startLine: range.startLine,
                startChar: range.startChar,
                endLine: range.startLine,
                endChar: range.startChar,
              },
              newText: 'int ',
            },
            'ghost',
          ),
        );
      } else if (candidate) {
        issues.push(
          makeIssue(
            rule,
            range,
            `'${name}' is not declared; did you mean '${candidate}'?`,
            `未声明的标识符 '${name}'，是否想用 '${candidate}'`,
            { range, newText: candidate },
            'ghost',
          ),
        );
      } else {
        // Without a close candidate this is a hint only, and only for files whose
        // headers we fully understand.
        if (!headersKnown) {
          continue;
        }
        issues.push(
          makeIssue(
            rule,
            range,
            `Unknown identifier '${name}'`,
            `未声明的标识符 '${name}'`,
            undefined,
            'hint',
          ),
        );
      }
    }

    return issues;
  },
};

/**
 * `for ( i = 0; ...)`: the identifier is the left side of a plain assignment in the
 * loop initializer, so inserting a declaration is the intended repair. Malformed
 * initializers (`for ( in i = 0; ...)`) have no clean assignment node and stay unfixed.
 *
 * With a comma initializer (`for ( i = 0, j = 0; ...)`) only the leftmost assignment
 * may receive the fix: a single leading `int` declares the whole comma list, so
 * `int i = 0, int j = 0` would be invalid.
 */
function isForInitializerAssignmentTarget(node: SyntaxNode): boolean {
  const assignment = node.parent;
  if (
    !assignment ||
    assignment.type !== 'assignment_expression' ||
    assignment.childForFieldName('left')?.id !== node.id ||
    assignment.childForFieldName('operator')?.text !== '='
  ) {
    return false;
  }

  let current: SyntaxNode = assignment;
  for (;;) {
    const parent = current.parent;
    if (!parent || parent.type !== 'comma_expression') {
      break;
    }
    current = parent;
  }

  const loop = current.parent;
  if (
    loop === null ||
    loop.type !== 'for_statement' ||
    loop.childForFieldName('initializer')?.id !== current.id
  ) {
    return false;
  }

  let leftmost: SyntaxNode = current;
  while (leftmost.type === 'comma_expression') {
    const left = leftmost.childForFieldName('left');
    if (!left) {
      break;
    }
    leftmost = left;
  }

  return leftmost.id === assignment.id;
}

/** Closest candidate within the distance limit; ambiguous ties stay silent. */
function closestCandidate(
  name: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = MAX_DISTANCE + 1;
  let tied = false;

  for (const candidate of candidates) {
    if (candidate === name) {
      continue;
    }
    const distance = damerauLevenshtein(name, candidate);
    if (distance > MAX_DISTANCE) {
      continue;
    }
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  return tied ? undefined : best;
}

function expressionIdentifiers(root: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  visitNode(root, found);
  return found;
}

function visitNode(node: SyntaxNode, found: SyntaxNode[]): void {
  switch (node.type) {
    case 'identifier':
      found.push(node);
      return;

    case 'declaration':
      visitDeclaration(node, found);
      return;

    case 'call_expression':
      visitCall(node, found);
      return;

    case 'field_expression':
      visitField(node, found);
      return;

    default:
      break;
  }

  // Preprocessor conditions may reference -D macros, and macro bodies are raw text.
  if (node.type.startsWith('preproc') || SKIPPED_NODE_TYPES.has(node.type)) {
    return;
  }

  for (const child of node.namedChildren) {
    visitNode(child, found);
  }
}

function visitCall(node: SyntaxNode, found: SyntaxNode[]): void {
  const callee = node.childForFieldName('function') ?? node.namedChild(0);
  // A plain identifier callee is a function name; implicit-declaration owns that case.
  if (callee && callee.type !== 'identifier') {
    visitNode(callee, found);
  }

  const args = node.childForFieldName('arguments') ?? node.namedChild(1);
  if (args) {
    for (const argument of args.namedChildren) {
      visitNode(argument, found);
    }
  }
}

function visitField(node: SyntaxNode, found: SyntaxNode[]): void {
  // `a.b` / `a->b`: only `a` is a variable reference; `b` is a field name.
  const argument = node.childForFieldName('argument') ?? node.namedChild(0);
  if (argument) {
    visitNode(argument, found);
  }
}

function visitDeclaration(node: SyntaxNode, found: SyntaxNode[]): void {
  // Type specifiers hold no variable references; initializers and array lengths do.
  for (const child of node.namedChildren) {
    if (DECLARATOR_TYPES.has(child.type)) {
      visitDeclarator(child, found);
    }
  }
}

function visitDeclarator(node: SyntaxNode, found: SyntaxNode[]): void {
  switch (node.type) {
    case 'init_declarator': {
      const declarator = node.childForFieldName('declarator');
      if (declarator) {
        visitDeclarator(declarator, found);
      }
      const value = node.childForFieldName('value');
      if (value) {
        visitNode(value, found);
      }
      return;
    }

    case 'array_declarator': {
      const declarator = node.childForFieldName('declarator');
      if (declarator) {
        visitDeclarator(declarator, found);
      }
      const size = node.childForFieldName('size');
      if (size) {
        visitNode(size, found);
      }
      return;
    }

    case 'pointer_declarator':
    case 'parenthesized_declarator':
    case 'attributed_declarator': {
      const declarator = node.childForFieldName('declarator');
      if (declarator) {
        visitDeclarator(declarator, found);
      }
      return;
    }

    case 'function_declarator':
    case 'identifier':
    default:
      // Function names and the declared identifier itself are not reads.
      return;
  }
}
