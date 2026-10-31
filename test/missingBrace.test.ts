import { describe, expect, it } from 'vitest';
import { buildMissingBraceFix } from '../src/core/fixes/missingBrace';

describe('buildMissingBraceFix', () => {
  it('withholds the fix when the unclosed count is not exactly one', () => {
    expect(buildMissingBraceFix('int main(){\n', 2)).toBeUndefined();
    expect(buildMissingBraceFix('int main(){\n', 0)).toBeUndefined();
  });

  it('appends on a new line when the last line has code', () => {
    const text = 'int main(){\n  return 0;';
    expect(buildMissingBraceFix(text, 1)).toEqual({
      offset: text.length,
      insert: '\n}',
    });
  });

  it('appends directly when the document ends with an empty line', () => {
    const text = 'int main(){\n  return 0;\n';
    expect(buildMissingBraceFix(text, 1)).toEqual({
      offset: text.length,
      insert: '}',
    });
  });

  it('appends directly after a just-opened block', () => {
    const text = 'int main(){\n';
    expect(buildMissingBraceFix(text, 1)).toEqual({
      offset: text.length,
      insert: '}',
    });
  });
});
