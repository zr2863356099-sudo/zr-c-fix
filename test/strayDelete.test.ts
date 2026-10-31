import { describe, expect, it } from 'vitest';
import { buildStrayDelete } from '../src/core/fixes/strayDelete';

describe('buildStrayDelete', () => {
  it('deletes a single-line run together with its line break', () => {
    const text = 'int a = 1;\n7 8 9\nint b = 2;\n';
    const start = text.indexOf('7 8 9');
    expect(buildStrayDelete(text, start, start + '7 8 9'.length)).toEqual({
      range: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
      newText: '',
    });
  });

  it('deletes a run pasted across lines', () => {
    const text = 'int a;\n1 2\n3 4\nint b;\n';
    const start = text.indexOf('1 2');
    const end = text.indexOf('3 4') + '3 4'.length;
    expect(buildStrayDelete(text, start, end)).toEqual({
      range: { startLine: 1, startChar: 0, endLine: 3, endChar: 0 },
      newText: '',
    });
  });

  it('extends past trailing whitespace before the line break', () => {
    const text = 'int a;\n1 2   \nint b;\n';
    const start = text.indexOf('1 2');
    expect(buildStrayDelete(text, start, start + '1 2'.length)).toEqual({
      range: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
      newText: '',
    });
  });

  it('extends through CRLF', () => {
    const text = 'int a;\r\n1 2\r\nint b;\r\n';
    const start = text.indexOf('1 2');
    expect(buildStrayDelete(text, start, start + '1 2'.length)).toEqual({
      range: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
      newText: '',
    });
  });

  it('stops at non-whitespace following the run', () => {
    const text = '1 2 + x;\n';
    expect(buildStrayDelete(text, 0, 3)).toEqual({
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 3 },
      newText: '',
    });
  });

  it('withholds an empty or inverted range', () => {
    expect(buildStrayDelete('abc', 2, 2)).toBeUndefined();
    expect(buildStrayDelete('abc', 2, 1)).toBeUndefined();
  });
});
