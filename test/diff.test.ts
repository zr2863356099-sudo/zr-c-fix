import { describe, expect, it } from 'vitest';
import { trimCommon } from '../src/core/diff';

describe('trimCommon', () => {
  it('turns a scanf fix into an insertion', () => {
    expect(trimCommon('scanf("%d", x);', 'scanf("%d", &x);')).toEqual({
      prefixLength: 12,
      oldMiddle: '',
      newMiddle: '&',
    });
  });

  it('trims an assignment-in-condition fix', () => {
    const diff = trimCommon('if (flag=0)', 'if (flag==0)');
    expect(diff).toBeDefined();
    const { prefixLength, oldMiddle, newMiddle } = diff!;
    // Either "0" -> "=0" or an equivalent insertion-only trim is legal.
    expect(
      'if (flag=0)'.slice(0, prefixLength) +
        newMiddle +
        'if (flag=0)'.slice(prefixLength + oldMiddle.length),
    ).toBe('if (flag==0)');
    expect(oldMiddle + newMiddle).not.toBe('');
  });

  it('returns undefined when texts are identical', () => {
    expect(trimCommon('int x = 0;', 'int x = 0;')).toBeUndefined();
  });

  it('returns the whole text when there is no common prefix', () => {
    expect(trimCommon('abc', 'xyz')).toEqual({
      prefixLength: 0,
      oldMiddle: 'abc',
      newMiddle: 'xyz',
    });
  });

  it('handles multi-byte characters by index', () => {
    const oldText = 'puts("你好");';
    const newText = 'puts("你好！");';
    const diff = trimCommon(oldText, newText);
    expect(diff).toBeDefined();
    const { prefixLength, oldMiddle, newMiddle } = diff!;
    expect(oldText.slice(0, prefixLength)).toBe('puts("你好');
    expect(oldMiddle).toBe('');
    expect(newMiddle).toBe('！');
  });

  it('does not let the suffix overlap the prefix', () => {
    expect(trimCommon('aa', 'aaa')).toEqual({
      prefixLength: 2,
      oldMiddle: '',
      newMiddle: 'a',
    });
  });
});
