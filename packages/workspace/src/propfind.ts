import { XMLParser } from "fast-xml-parser";

/** One file or folder in a directory listing. */
export interface DirEntry {
  /** Display name, already percent-decoded. */
  name: string;
  /** Path relative to the scope root — what a caller passes back to resolvePath. */
  path: string;
  isDirectory: boolean;
  /** Bytes. Always 0 for a directory. */
  size: number;
  /** ISO 8601. Empty string when the server omitted it. */
  lastModified: string;
  contentType: string | null;
  /** Nextcloud's stable numeric file id, used to address WOPI sessions. */
  fileId: string | null;
}

// removeNSPrefix collapses d:/oc:/nc: so the shape does not depend on which
// prefix the server happened to choose. Values stay strings: parsing "0100" as
// a number would corrupt ids.
const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === "response" || name === "propstat",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toIso(httpDate: unknown): string {
  if (typeof httpDate !== "string" || httpDate.length === 0) return "";
  const ms = Date.parse(httpDate);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

/**
 * Turn a WebDAV multi-status document into the children of `rootHref`.
 *
 * The self entry — the directory being listed — is dropped, because callers
 * want a list of children and would otherwise have to filter it themselves at
 * every call site.
 */
export function parsePropfind(xml: string, rootHref: string): DirEntry[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const multistatus = (doc.multistatus ?? {}) as Record<string, unknown>;
  const responses = asArray(multistatus.response as Record<string, unknown>[]);

  const rootNormalised = rootHref.endsWith("/") ? rootHref : `${rootHref}/`;
  const entries: DirEntry[] = [];

  for (const response of responses) {
    const href = String(response.href ?? "");
    if (href.length === 0) continue;

    // The self entry, with or without its trailing slash.
    if (href === rootNormalised || `${href}/` === rootNormalised) continue;
    if (!href.startsWith(rootNormalised)) continue;

    const propstats = asArray(response.propstat as Record<string, unknown>[]);
    const prop = (propstats.find(
      (p) => typeof p.status === "string" && p.status.includes("200"),
    )?.prop ?? propstats[0]?.prop ?? {}) as Record<string, unknown>;

    const isDirectory =
      prop.resourcetype !== null &&
      typeof prop.resourcetype === "object" &&
      "collection" in (prop.resourcetype as Record<string, unknown>);

    const relativeHref = href.slice(rootNormalised.length).replace(/\/$/, "");
    if (relativeHref.length === 0) continue;

    const path = decodeURIComponent(relativeHref);
    const name = path.split("/").pop() ?? path;

    entries.push({
      name,
      path,
      isDirectory,
      size: isDirectory ? 0 : Number(prop.getcontentlength ?? 0),
      lastModified: toIso(prop.getlastmodified),
      contentType: isDirectory ? null : ((prop.getcontenttype as string) ?? null),
      fileId: prop.fileid === undefined ? null : String(prop.fileid),
    });
  }

  return entries;
}
