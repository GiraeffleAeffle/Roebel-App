import { parseDiscovery } from "@netizen-labs/workspace";

/** Lowercased extension, or "" when the basename has none. */
export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function isEditable(path: string, discovery: Map<string, string>): boolean {
  return discovery.has(extensionOf(path));
}

/**
 * Collabora's /hosting/discovery, which lists an editor url per extension.
 *
 * An unreachable or erroring Collabora yields an empty map rather than
 * throwing: the file list must still render when the editor is down. The
 * failure then shows up as "this file cannot be opened", which is honest.
 */
export async function loadDiscovery(
  collaboraBaseUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Map<string, string>> {
  const url = `${collaboraBaseUrl.replace(/\/+$/, "")}/hosting/discovery`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      console.warn(`[workspace] discovery returned ${res.status}`);
      return new Map();
    }
    return parseDiscovery(await res.text());
  } catch (error) {
    console.warn("[workspace] discovery unreachable:", error);
    return new Map();
  }
}
