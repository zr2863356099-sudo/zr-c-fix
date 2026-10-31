export interface IncludeInsert {
  line: number;
  character: number;
  text: string;
}

const INCLUDE_DIRECTIVE = /^[ \t]*#[ \t]*include\b(.*)$/;
const SAFE_HEADER = /^[A-Za-z0-9_./-]+$/;

/**
 * Builds the insertion for a missing `#include <header>`. Missing headers go after the
 * last existing include line, or at the top of the file when there is none. An exact
 * `<header>` include already in the text yields no edit (fail-closed).
 */
export function buildIncludeInsert(
  text: string,
  header: string,
): IncludeInsert | undefined {
  if (!SAFE_HEADER.test(header)) {
    return undefined;
  }

  const starts = lineStarts(text);
  let lastInclude = -1;

  for (let line = 0; line < starts.length; line++) {
    const lineText = lineTextAt(text, starts, line);
    const match = INCLUDE_DIRECTIVE.exec(lineText);
    if (!match) {
      continue;
    }

    lastInclude = line;
    if (match[1]?.trim() === `<${header}>`) {
      return undefined;
    }
  }

  if (lastInclude < 0) {
    return { line: 0, character: 0, text: `#include <${header}>\n` };
  }

  const nextLine = lastInclude + 1;
  if (nextLine < starts.length) {
    return { line: nextLine, character: 0, text: `#include <${header}>\n` };
  }

  // The last include is the final line and has no trailing newline: append after it.
  return {
    line: lastInclude,
    character: lineTextAt(text, starts, lastInclude).length,
    text: `\n#include <${header}>`,
  };
}

/** Offsets of each line start; a trailing newline produces a final empty line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      starts.push(index + 1);
    } else if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        index++;
      }
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineTextAt(text: string, starts: number[], line: number): string {
  const start = starts[line] ?? text.length;
  const next = starts[line + 1] ?? text.length;
  let end = next;
  if (end > start && text.charCodeAt(end - 1) === 10) {
    end--;
  }
  if (end > start && text.charCodeAt(end - 1) === 13) {
    end--;
  }
  return text.slice(start, end);
}
