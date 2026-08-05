import { readFileSync } from "node:fs";

/**
 * The "do not monetize me" list — one hex pubkey per line, '#' comments.
 * Lives beside the relay's write allow-list (same directory-mount rules).
 * A missing file is an empty list, never an error: the free record does not
 * depend on the paid tier's configuration.
 */
export function loadExclusions(path: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return new Set();
  }
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    const value = line.trim().toLowerCase();
    if (!value || value.startsWith("#")) continue;
    if (/^[0-9a-f]{64}$/.test(value)) set.add(value);
  }
  return set;
}
