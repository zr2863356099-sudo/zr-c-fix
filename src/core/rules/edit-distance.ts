/**
 * Optimal-string-alignment Damerau-Levenshtein distance (insert, delete, substitute
 * and adjacent transposition). Small inputs only; all signature names are short.
 */
export function damerauLevenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (Math.abs(left.length - right.length) > 2) {
    return 3;
  }

  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(columns).fill(0),
  );

  for (let row = 0; row < rows; row++) {
    matrix[row]![0] = row;
  }
  for (let column = 0; column < columns; column++) {
    matrix[0]![column] = column;
  }

  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitution =
        left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + substitution,
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, matrix[row - 2]![column - 2]! + 1);
      }

      matrix[row]![column] = value;
    }
  }

  return matrix[left.length]![right.length]!;
}
