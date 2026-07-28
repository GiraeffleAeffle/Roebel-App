import { type DirEntry, parsePropfind } from "./propfind";
import { resolvePath, scopeRoot } from "./scope";
import type { WorkspaceScope } from "./types";

/**
 * How requests authenticate. A strategy rather than a fixed header because the
 * node may serve bearer tokens (user_oidc) or per-user app passwords, and that
 * choice is an operational fact about a deployment, not a property of the code.
 */
export interface NextcloudAuth {
  headers(): Promise<Record<string, string>>;
}

/** Asks for a token per request, so a refresh between calls is picked up. */
export function bearerAuth(getToken: () => Promise<string>): NextcloudAuth {
  return {
    async headers() {
      return { Authorization: `Bearer ${await getToken()}` };
    },
  };
}

/** App-password / admin fallback — see the spec's §6 fallback. */
export function basicAuth(user: string, password: string): NextcloudAuth {
  const encoded = Buffer.from(`${user}:${password}`).toString("base64");
  return {
    async headers() {
      return { Authorization: `Basic ${encoded}` };
    },
  };
}

export class NextcloudError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NextcloudError";
    this.status = status;
  }
}

export interface NextcloudClient {
  listDirectory(scope: WorkspaceScope, relPath: string): Promise<DirEntry[]>;
  stat(scope: WorkspaceScope, relPath: string): Promise<DirEntry>;
  download(scope: WorkspaceScope, relPath: string): Promise<ArrayBuffer>;
  upload(
    scope: WorkspaceScope,
    relPath: string,
    body: Uint8Array | ArrayBuffer,
  ): Promise<void>;
  createFolder(scope: WorkspaceScope, relPath: string): Promise<void>;
  move(scope: WorkspaceScope, from: string, to: string): Promise<void>;
  remove(scope: WorkspaceScope, relPath: string): Promise<void>;
}

export interface NextcloudClientOptions {
  /** e.g. https://cloud.roebel.app — trailing slashes are tolerated. */
  baseUrl: string;
  auth: NextcloudAuth;
  fetch?: typeof globalThis.fetch;
}

const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getlastmodified/>
    <oc:fileid/>
  </d:prop>
</d:propfind>`;

export function createNextcloudClient(
  opts: NextcloudClientOptions,
): NextcloudClient {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;

  async function request(
    method: string,
    absolutePath: string,
    init: { headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<Response> {
    const authHeaders = await opts.auth.headers();
    const res = await doFetch(`${base}${absolutePath}`, {
      method,
      headers: { ...authHeaders, ...(init.headers ?? {}) },
      body: init.body,
    });
    if (!res.ok && res.status !== 207) {
      throw new NextcloudError(
        res.status,
        `${method} ${absolutePath} failed with ${res.status}`,
      );
    }
    return res;
  }

  return {
    async listDirectory(scope, relPath) {
      // resolvePath throws before any I/O, so an out-of-scope request never
      // reaches the network — asserted by a test.
      const path = resolvePath(scope, relPath);
      const withSlash = path.endsWith("/") ? path : `${path}/`;
      const res = await request("PROPFIND", withSlash, {
        headers: { Depth: "1", "Content-Type": "application/xml" },
        body: PROPFIND_BODY,
      });
      return parsePropfind(await res.text(), withSlash);
    },

    async stat(scope, relPath) {
      const path = resolvePath(scope, relPath);
      const res = await request("PROPFIND", path, {
        headers: { Depth: "0", "Content-Type": "application/xml" },
        body: PROPFIND_BODY,
      });
      // Depth 0 describes the resource itself, so parse it as the sole child of
      // its parent rather than of itself.
      const parent = path.slice(0, path.lastIndexOf("/") + 1);
      const entries = parsePropfind(await res.text(), parent);
      const entry = entries[0];
      if (!entry) {
        throw new NextcloudError(404, `${relPath} not found`);
      }
      return entry;
    },

    async download(scope, relPath) {
      const res = await request("GET", resolvePath(scope, relPath));
      return res.arrayBuffer();
    },

    async upload(scope, relPath, body) {
      await request("PUT", resolvePath(scope, relPath), {
        headers: { "Content-Type": "application/octet-stream" },
        body: body as BodyInit,
      });
    },

    async createFolder(scope, relPath) {
      await request("MKCOL", resolvePath(scope, relPath));
    },

    async move(scope, from, to) {
      // Both ends are resolved before the request: validating only the source
      // would let a move write outside the scope.
      const source = resolvePath(scope, from);
      const destination = resolvePath(scope, to);
      await request("MOVE", source, {
        headers: { Destination: `${base}${destination}`, Overwrite: "F" },
      });
    },

    async remove(scope, relPath) {
      await request("DELETE", resolvePath(scope, relPath));
    },
  };
}

/** Re-exported so callers can build a listing URL without importing scope.ts. */
export { scopeRoot };
