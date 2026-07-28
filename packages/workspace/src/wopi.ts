import { XMLParser } from "fast-xml-parser";
import { SignJWT, jwtVerify } from "jose";
import type { DirEntry } from "./propfind";
import type { WorkspaceScope } from "./types";

/**
 * What a WOPI session is allowed to touch. Bound to ONE path, so a leaked
 * token opens one document for its remaining lifetime rather than a filesystem.
 *
 * `sessionId` is how the WOPI endpoints reach the citizen's Nextcloud tokens:
 * Collabora calls them itself with no browser cookie, so the token has to carry
 * the handle to the server-side session.
 */
export interface WopiClaims {
  sub: string;
  sessionId: string;
  scope: WorkspaceScope;
  path: string;
  canWrite: boolean;
}

/** The subset of CheckFileInfo Collabora actually reads. */
export interface WopiFileInfo {
  BaseFileName: string;
  Size: number;
  OwnerId: string;
  UserId: string;
  UserFriendlyName: string;
  UserCanWrite: boolean;
  SupportsUpdate: boolean;
  SupportsLocks: boolean;
  LastModifiedTime: string;
  Version: string;
}

function b64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function b64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

/** Opaque, url-safe handle for (scope, path) — it rides in the WOPISrc path. */
export function encodeFileId(scope: WorkspaceScope, path: string): string {
  return b64urlEncode(JSON.stringify({ scope, path }));
}

export function decodeFileId(fileId: string): {
  scope: WorkspaceScope;
  path: string;
} {
  const parsed = JSON.parse(b64urlDecode(fileId)) as {
    scope: WorkspaceScope;
    path: string;
  };
  return parsed;
}

export async function mintWopiToken(
  claims: WopiClaims,
  secret: Uint8Array,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyWopiToken(
  token: string,
  secret: Uint8Array,
): Promise<WopiClaims> {
  const { payload } = await jwtVerify(token, secret);
  return {
    sub: payload.sub as string,
    sessionId: payload.sessionId as string,
    scope: payload.scope as WorkspaceScope,
    path: payload.path as string,
    canWrite: payload.canWrite as boolean,
  };
}

/**
 * The document description Collabora asks for before rendering. `UserId` is the
 * smart-account address because Collabora needs a stable identifier; the name
 * a human sees is `UserFriendlyName`, which the caller resolves to a display
 * name — a wallet address must never be rendered in the UI.
 */
export function checkFileInfo(
  entry: DirEntry,
  claims: WopiClaims,
  userFriendlyName: string,
): WopiFileInfo {
  return {
    BaseFileName: entry.name,
    Size: entry.size,
    OwnerId: claims.sub,
    UserId: claims.sub,
    UserFriendlyName: userFriendlyName,
    UserCanWrite: claims.canWrite,
    SupportsUpdate: claims.canWrite,
    // Slice 1 has one editor per document; collaborative locking arrives with
    // multi-user editing, and claiming support we do not implement would make
    // Collabora issue lock calls that silently fail.
    SupportsLocks: false,
    LastModifiedTime: entry.lastModified,
    Version: entry.lastModified,
  };
}

const discoveryParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "net-zone" || name === "app" || name === "action",
});

/** Map file extension -> Collabora editor url, from /hosting/discovery. */
export function parseDiscovery(xml: string): Map<string, string> {
  const map = new Map<string, string>();

  let doc: Record<string, unknown>;
  try {
    doc = discoveryParser.parse(xml) as Record<string, unknown>;
  } catch {
    // A malformed discovery document must not crash the WOPI host — an empty
    // map just means no extension can be opened, which the caller already
    // has to handle for extensions Collabora simply doesn't list.
    return map;
  }

  const root = doc["wopi-discovery"] as Record<string, unknown> | undefined;
  if (!root) return map;

  const zones = (root["net-zone"] ?? []) as Array<Record<string, unknown>>;
  for (const zone of zones) {
    const apps = (zone.app ?? []) as Array<Record<string, unknown>>;
    for (const app of apps) {
      const actions = (app.action ?? []) as Array<Record<string, string>>;
      for (const action of actions) {
        const ext = action["@_ext"];
        const urlsrc = action["@_urlsrc"];
        if (ext && urlsrc && !map.has(ext)) map.set(ext, urlsrc);
      }
    }
  }
  return map;
}

/**
 * The iframe src. The access token is deliberately absent — it is POSTed into
 * the frame instead, so it never reaches browser history, a Referer header or
 * an access log.
 */
export function buildEditorUrl(params: {
  urlsrc: string;
  wopiSrc: string;
  lang: string;
}): string {
  const url = new URL(params.urlsrc);
  url.searchParams.set("WOPISrc", params.wopiSrc);
  url.searchParams.set("lang", params.lang);
  return url.toString();
}
