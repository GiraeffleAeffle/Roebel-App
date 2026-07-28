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
 * RFC 4918 permits <d:href> to carry either an abs_path or a full
 * absoluteURI. Take just the pathname when it's the latter, so a path-only
 * `rootHref` still matches an absolute href a server chooses to send — a
 * scheme and host must never be mistaken for extra path segments.
 */
function toPathname(href: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(href)) {
    try {
      return new URL(href).pathname;
    } catch {
      return href;
    }
  }
  return href;
}

/**
 * Split a WebDAV href into decoded path segments, dropping empty segments —
 * which is what makes the result independent of a leading or trailing "/".
 *
 * Splits BEFORE decoding, then decodes each segment individually, rather than
 * decoding the whole path and splitting on "/" afterwards. That order matters:
 * a segment can legitimately contain an encoded "%2F", and decoding the whole
 * string first would turn it into a literal "/" that gets misread as an extra
 * path boundary.
 */
function segmentsOf(href: string): string[] {
  return toPathname(href)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Turn a WebDAV multi-status document into the children of `rootHref`.
 *
 * The self entry — the directory being listed — is dropped, because callers
 * want a list of children and would otherwise have to filter it themselves at
 * every call site.
 *
 * Encoding contract: `rootHref` and every `<d:href>` in `xml` are compared as
 * decoded path segments, not as raw strings, and an absolute URI href is
 * reduced to its pathname first. This is deliberate — the server's encoder
 * and the caller's `rootHref` may legitimately disagree on which of
 * `! ' ( ) *` (left unescaped by `encodeURIComponent`, but not necessarily by
 * a Sabre/PHP-style server) get percent-encoded, and a raw prefix compare
 * would then silently treat an entire real directory as empty. Every `name`
 * and `path` this function returns is therefore always fully decoded — a
 * caller never percent-decodes them again.
 */
export function parsePropfind(xml: string, rootHref: string): DirEntry[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const multistatus = (doc.multistatus ?? {}) as Record<string, unknown>;
  const responses = asArray(multistatus.response as Record<string, unknown>[]);

  const rootSegments = segmentsOf(rootHref);
  const entries: DirEntry[] = [];

  for (const response of responses) {
    const href = String(response.href ?? "");
    if (href.length === 0) continue;

    const hrefSegments = segmentsOf(href);
    if (hrefSegments.length < rootSegments.length) continue;
    const isUnderRoot = rootSegments.every((segment, i) => hrefSegments[i] === segment);
    if (!isUnderRoot) continue;

    const relativeSegments = hrefSegments.slice(rootSegments.length);
    if (relativeSegments.length === 0) continue; // the self entry

    const propstats = asArray(response.propstat as Record<string, unknown>[]);
    const prop = (propstats.find(
      (p) => typeof p.status === "string" && p.status.includes("200"),
    )?.prop ?? propstats[0]?.prop ?? {}) as Record<string, unknown>;

    const isDirectory =
      prop.resourcetype !== null &&
      typeof prop.resourcetype === "object" &&
      "collection" in (prop.resourcetype as Record<string, unknown>);

    const path = relativeSegments.join("/");
    const name = relativeSegments[relativeSegments.length - 1];

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
