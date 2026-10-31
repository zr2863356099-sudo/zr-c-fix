import { describe, expect, it } from 'vitest';
import {
  collectLineHashes,
  hashLine,
  SuppressionTable,
} from '../src/core/suppression';

const base = {
  lineHash: hashLine('scanf("%d", x);'),
  ruleId: 'scanf-missing-amp',
  typeFingerprint: 'x:int',
};

describe('SuppressionTable', () => {
  it('suppresses the same key after it was consumed', () => {
    const table = new SuppressionTable();
    expect(table.isSuppressed(base)).toBe(false);

    table.consume(base);
    expect(table.isSuppressed(base)).toBe(true);
    expect(table.isSuppressed({ ...base })).toBe(true);
  });

  it('allows the hint again when the line content changes', () => {
    const table = new SuppressionTable();
    table.consume(base);

    expect(
      table.isSuppressed({
        ...base,
        lineHash: hashLine('scanf("%d", y);'),
      }),
    ).toBe(false);
  });

  it('allows the hint again when the type fingerprint changes', () => {
    const table = new SuppressionTable();
    table.consume(base);

    expect(
      table.isSuppressed({ ...base, typeFingerprint: 'x:long long' }),
    ).toBe(false);
  });

  it('prunes entries whose line hash disappeared', () => {
    const table = new SuppressionTable();
    table.consume(base);
    table.consume({ ...base, lineHash: hashLine('int y = 0;') });
    expect(table.size).toBe(2);

    table.pruneToLineHashes(collectLineHashes('int y = 0;\n'));
    expect(table.isSuppressed(base)).toBe(false);
    expect(table.size).toBe(1);
  });

  it('resets every entry', () => {
    const table = new SuppressionTable();
    table.consume(base);
    table.reset();
    expect(table.isSuppressed(base)).toBe(false);
  });
});

describe('collectLineHashes', () => {
  it('handles LF, CRLF, empty lines and a trailing newline', () => {
    expect(collectLineHashes('a\nb\r\n\n')).toEqual(
      new Set([hashLine('a'), hashLine('b'), hashLine(''), hashLine('')]),
    );
  });
});
