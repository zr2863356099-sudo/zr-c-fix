export interface TrimmedDiff {
  prefixLength: number;
  oldMiddle: string;
  newMiddle: string;
}

/**
 * Trims the common prefix and suffix from two single-line strings. Offsets are JS
 * UTF-16 code-unit indices, matching VS Code positions. Returns undefined when equal.
 */
export function trimCommon(
  oldText: string,
  newText: string,
): TrimmedDiff | undefined {
  if (oldText === newText) {
    return undefined;
  }

  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefixLength = 0;
  while (
    prefixLength < maxPrefix &&
    oldText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength++;
  }

  const maxSuffix = Math.min(oldText.length, newText.length) - prefixLength;
  let suffixLength = 0;
  while (
    suffixLength < maxSuffix &&
    oldText[oldText.length - 1 - suffixLength] ===
      newText[newText.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return {
    prefixLength,
    oldMiddle: oldText.slice(prefixLength, oldText.length - suffixLength),
    newMiddle: newText.slice(prefixLength, newText.length - suffixLength),
  };
}
