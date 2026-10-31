import type { Range } from '../rules/types';
import { rangeFromOffsets } from '../rules/utils';

export interface StrayDelete {
  range: Range;
  newText: '';
}

/**
 * Deletes `[startIndex, endIndex)` and, when only whitespace remains on the end line,
 * extends the deletion through the line terminator. Used for stray numeric runs pasted
 * across lines, which the single-line inline fix cannot express.
 */
export function buildStrayDelete(
  text: string,
  startIndex: number,
  endIndex: number,
): StrayDelete | undefined {
  const start = Math.max(0, Math.min(startIndex, text.length));
  const end = Math.max(start, Math.min(endIndex, text.length));
  if (end <= start) {
    return undefined;
  }

  let cursor = end;
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code !== 32 && code !== 9) {
      break;
    }
    cursor++;
  }

  let deleteEnd = end;
  if (cursor >= text.length) {
    deleteEnd = cursor;
  } else if (text.charCodeAt(cursor) === 13) {
    deleteEnd =
      text.charCodeAt(cursor + 1) === 10 ? cursor + 2 : cursor + 1;
  } else if (text.charCodeAt(cursor) === 10) {
    deleteEnd = cursor + 1;
  }

  return { range: rangeFromOffsets(text, start, deleteEnd), newText: '' };
}
