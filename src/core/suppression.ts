export interface SuppressionKey {
  lineHash: string;
  ruleId: string;
  typeFingerprint: string;
}

interface Entry extends SuppressionKey {
  key: string;
}

/**
 * Remembers correction hints that were already offered. The key intentionally excludes
 * the document URI and line number: callers own one table per document.
 */
export class SuppressionTable {
  private readonly entries = new Map<string, Entry>();

  consume(key: SuppressionKey): void {
    const normalized = normalizeKey(key);
    this.entries.set(encode(normalized), {
      ...normalized,
      key: encode(normalized),
    });
  }

  isSuppressed(key: SuppressionKey): boolean {
    return this.entries.has(encode(normalizeKey(key)));
  }

  reset(): void {
    this.entries.clear();
  }

  /**
   * Drops entries whose line text no longer exists in the document. An entry survives
   * while its exact line hash is still present, even if the line moved.
   */
  pruneToLineHashes(lineHashes: ReadonlySet<string>): void {
    for (const [encoded, entry] of this.entries) {
      if (!lineHashes.has(entry.lineHash)) {
        this.entries.delete(encoded);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Stable 32-bit FNV-1a hash, including the source length to reduce collisions. */
export function hashLine(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function collectLineHashes(text: string): Set<string> {
  const hashes = new Set<string>();
  let start = 0;

  for (let index = 0; index <= text.length; index++) {
    const code = text.charCodeAt(index);
    if (index !== text.length && code !== 10 && code !== 13) {
      continue;
    }

    hashes.add(hashLine(text.slice(start, index)));

    if (code === 13 && text.charCodeAt(index + 1) === 10) {
      index++;
    }
    start = index + 1;
  }

  return hashes;
}

function normalizeKey(key: SuppressionKey): SuppressionKey {
  return {
    lineHash: key.lineHash,
    ruleId: key.ruleId,
    typeFingerprint: key.typeFingerprint,
  };
}

function encode(key: SuppressionKey): string {
  return `${key.lineHash}\u0000${key.ruleId}\u0000${key.typeFingerprint}`;
}
