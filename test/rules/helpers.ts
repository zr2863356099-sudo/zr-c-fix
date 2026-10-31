import type { CParser } from '../../src/core/parser';
import { runRules } from '../../src/core/rules';
import { DEFAULT_RULE_CONFIG, type Issue } from '../../src/core/rules/types';
import { buildSymbolTable } from '../../src/core/symbols';
import { createTestParser } from '../helpers/parser';

let parser: CParser | undefined;

async function getParser(): Promise<CParser> {
  parser ??= await createTestParser();
  return parser;
}

export async function runRule(
  source: string,
  ruleId: string,
): Promise<Issue[]> {
  const active = await getParser();
  const tree = active.parse(source);

  try {
    const table = buildSymbolTable(tree.rootNode, source);
    return runRules(
      {
        text: source,
        root: tree.rootNode,
        table,
        config: DEFAULT_RULE_CONFIG,
      },
      [ruleId],
    );
  } finally {
    tree.delete();
  }
}
