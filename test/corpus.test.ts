import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CParser } from '../src/core/parser';
import {
  DEFAULT_RULE_CONFIG,
  getEnabledRuleIds,
  runRules,
} from '../src/core/rules';
import { buildSymbolTable } from '../src/core/symbols';
import { createTestParser } from './helpers/parser';

interface ExpectedHit {
  ruleId: string;
  reason: string;
}

type ExpectedCorpus = Record<string, ExpectedHit[]>;

const CORPUS_DIR = path.resolve(process.cwd(), 'test', 'corpus');
const EXPECTED: ExpectedCorpus = JSON.parse(
  readFileSync(path.join(CORPUS_DIR, 'expected.json'), 'utf8'),
) as ExpectedCorpus;

let parser: CParser | undefined;

function corpusFiles(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((file) => file.endsWith('.c'))
    .sort();
}

function analyze(source: string): string[] {
  if (!parser) {
    throw new Error('parser not initialised');
  }

  const tree = parser.parse(source);
  try {
    const table = buildSymbolTable(tree.rootNode, source);
    const issues = runRules(
      {
        text: source,
        root: tree.rootNode,
        table,
        config: DEFAULT_RULE_CONFIG,
      },
      getEnabledRuleIds('core'),
    );
    return issues.map((issue) => issue.ruleId).sort();
  } finally {
    tree.delete();
  }
}

describe('real corpus regression (core preset)', () => {
  beforeAll(async () => {
    parser = await createTestParser();
  });

  afterAll(() => {
    parser?.dispose();
    parser = undefined;
  });

  it('covers every corpus file exactly once', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(corpusFiles());
  });

  it('gives every expected hit a non-empty reason', () => {
    for (const [file, hits] of Object.entries(EXPECTED)) {
      for (const hit of hits) {
        expect(hit.ruleId, file).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(hit.reason.trim().length, `${file}:${hit.ruleId}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  for (const file of corpusFiles()) {
    it(`${file} produces exactly the expected rule hit multiset`, () => {
      const source = readFileSync(path.join(CORPUS_DIR, file), 'utf8');
      const got = analyze(source);
      const want = (EXPECTED[file] ?? []).map((hit) => hit.ruleId).sort();

      expect(got, `${file}\n  got:  [${got.join(', ')}]\n  want: [${want.join(', ')}]`).toEqual(want);
    });
  }
});
