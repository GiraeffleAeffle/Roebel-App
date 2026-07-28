# Sovereign Arbeitsbereich Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Citizens the same real workspace shell orgs have, and make Dateien & Dokumente a native surface — files listed by our UI, documents edited inside our page — instead of a tile that links out to Nextcloud.

**Architecture:** Hybrid. A node-agnostic `@netizen-labs/workspace` package speaks WebDAV/OCS to Nextcloud and implements the WOPI host protocol; `apps/web` holds a Röbel ID OIDC session server-side and proxies every call so tokens never reach the browser; Collabora is embedded as the editor because it is designed for exactly that. All declarations land in the Netizen manifest so node #2 gets the workspace from `netizen up`.

**Tech Stack:** TypeScript, pnpm workspaces, Next.js 15 (App Router), `node:test` via `tsx`, `jose` (JWE sessions + WOPI JWTs), `fast-xml-parser` (PROPFIND/discovery), Nextcloud `user_oidc`, Collabora CODE, panva `oidc-provider` (the keystone).

**Spec:** [`docs/superpowers/specs/2026-07-28-sovereign-arbeitsbereich-slice1-design.md`](../specs/2026-07-28-sovereign-arbeitsbereich-slice1-design.md)

## Global Constraints

- **Package manager is pnpm.** Never `npm` or `yarn`. Workspace globs already include `packages/*`.
- **Commit with pathspecs** — `git add <file1> <file2>`, never `git add .` or `-A`. Another agent is working in this repo concurrently (Nostr); a bare index commit clobbers their staged work.
- **Do not touch** `packages/nostr`, `packages/relay-sync`, or `packages/cli/policies/**`. Task 13 is the only task that edits `packages/protocol` or `packages/cli`, and it lands last.
- **UI text is German.** Primary colour `#00498B`; secondary text `#6B7280`; borders `#B4B8C1`.
- **Never render a raw `0x` wallet address in the UI** — resolve to a display name.
- **Relative imports inside packages are extensionless** (`from "./scope"`), matching `packages/nostr`.
- **Tests are `node:test` + `node:assert/strict`**, run by `tsx`. Package tests live in `packages/workspace/test/*.test.ts`; web tests live in `apps/web/tests/*.test.ts` and are run by the root script `pnpm test:web`.
- **No React in anything under test.** Route handlers stay thin wrappers over pure modules; the pure modules are what tests import.
- **Secrets never enter git.** New env vars go into `.env.example` with placeholder values only.

---

### Task 1: Verify the Nextcloud access strategy on the live node

This is a preflight spike, not a feature. Everything downstream rests on it, so it is resolved before any code is written. It ends in a written finding, and its outcome selects the `auth` strategy Task 4 constructs.

**Files:**
- Modify: `docs/WORKSPACE_SSO_SETUP.md` (add a verified "Part E — API access" section)

**Interfaces:**
- Consumes: nothing.
- Produces: a decision recorded in the doc — `AUTH_STRATEGY = "bearer" | "app-password"` — and a confirmed value for whether the Nextcloud uid equals the OIDC `sub`.

- [ ] **Step 1: Read the installed user_oidc version**

Bearer-authenticated WebDAV/REST only began passing correctly in **user_oidc 7.4.0**. Anything older silently 401s.

```bash
ssh root@178.105.19.80 \
  'docker exec -u www-data roebel-nextcloud-1 php occ app:list | grep -A1 user_oidc'
```

Record the version. If it is below 7.4.0, upgrade first:

```bash
ssh root@178.105.19.80 \
  'docker exec -u www-data roebel-nextcloud-1 php occ app:update user_oidc'
```

- [ ] **Step 2: Enable bearer validation**

```bash
ssh root@178.105.19.80 'docker exec -u www-data roebel-nextcloud-1 \
  php occ config:app:set user_oidc oidc_provider_bearer_validation --value=1'
ssh root@178.105.19.80 'docker exec -u www-data roebel-nextcloud-1 \
  php occ config:app:set user_oidc selfencoded_bearer_validation --value=1'
```

- [ ] **Step 3: Check whether the Nextcloud uid is the OIDC `sub`**

The WebDAV path is `/remote.php/dav/files/<uid>/`. Our scope module computes that path from `sub`, so the two must be equal. The current rendered setup script passes `--unique-uid=1`, which makes the uid a hash of provider+sub rather than the sub itself.

```bash
ssh root@178.105.19.80 \
  'docker exec -u www-data roebel-nextcloud-1 php occ user:list'
```

If the listed uid is a hash rather than a `0x…` address, flip the provider to `--unique-uid=0`:

```bash
ssh root@178.105.19.80 'docker exec -u www-data roebel-nextcloud-1 \
  php occ user_oidc:provider Roebel --unique-uid=0'
```

This is safe **only because the node currently has one user** (confirmed by the 2026-07-27 restore test, which counted 1 user). Doing this later, with real citizens provisioned, would orphan every home directory. Record in the doc that the flip happened and why it must not be repeated.

- [ ] **Step 4: Prove a bearer token reaches WebDAV**

Obtain an access token from the keystone for any test citizen, then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X PROPFIND -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Depth: 1' \
  https://cloud.roebel.app/remote.php/dav/files/$SUB/
```

Expected: `207`. A `401` means bearer validation is not working — record that, and set `AUTH_STRATEGY = "app-password"`.

- [ ] **Step 5: Confirm the OCS provisioning API answers**

```bash
curl -s -u "$NC_ADMIN_USER:$NC_ADMIN_PASS" \
  -H 'OCS-APIRequest: true' \
  'https://cloud.roebel.app/ocs/v1.php/cloud/users?format=json' | head -c 400
```

Expected: a JSON body with `ocs.meta.statuscode = 100`. Task 5 depends on this.

- [ ] **Step 6: Write the finding and commit**

Append a "Part E — API access (verified YYYY-MM-DD)" section to `docs/WORKSPACE_SSO_SETUP.md` recording: the user_oidc version, whether bearer auth returned 207, the uid↔sub decision, and the selected `AUTH_STRATEGY`. State results plainly — if bearer failed, say so; do not write "should work".

```bash
git add docs/WORKSPACE_SSO_SETUP.md
git commit -m "docs(workspace): verify Nextcloud API access on the node

Bearer-token WebDAV, the uid-equals-sub requirement and the OCS
provisioning endpoint, all checked against the live box rather than
assumed. Records the auth strategy the workspace package will use."
```

---

### Task 2: Scaffold `@netizen-labs/workspace` with the scope guard

The scope guard is a security boundary — it decides whether a request can escape its own folder — so it is the first thing built and the first thing tested.

**Files:**
- Create: `packages/workspace/package.json`
- Create: `packages/workspace/tsconfig.json`
- Create: `packages/workspace/src/types.ts`
- Create: `packages/workspace/src/scope.ts`
- Create: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/scope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Actor = { kind: "human"; sub: string } | { kind: "agent"; sub: string; actingFor: string }`
  - `interface WorkspaceScope { kind: "personal" | "org"; sub: string; accountId?: string; folderName?: string }`
  - `class ScopeViolationError extends Error`
  - `function scopeRoot(scope: WorkspaceScope): string`
  - `function resolvePath(scope: WorkspaceScope, relPath: string): string`
  - `function orgFolderName(orgName: string): string`

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/workspace/package.json`:

```json
{
  "name": "@netizen-labs/workspace",
  "version": "0.1.0",
  "private": true,
  "description": "Netizen workspace primitives — scope guard, Nextcloud WebDAV/OCS client, provisioning, WOPI host, provenance. Node-agnostic: takes configuration, never node constants.",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "files": ["src"],
  "scripts": {
    "test": "tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "jose": "^6.2.3"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

`packages/workspace/tsconfig.json` — identical to `packages/nostr/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Then install:

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

`packages/workspace/test/scope.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ScopeViolationError,
  orgFolderName,
  resolvePath,
  scopeRoot,
  type WorkspaceScope,
} from "../src/scope";

const SUB = "0x1111111111111111111111111111111111111111";
const personal: WorkspaceScope = { kind: "personal", sub: SUB };
const org: WorkspaceScope = {
  kind: "org",
  sub: SUB,
  accountId: "acc-7",
  folderName: "Org Feuerwehr",
};

describe("scopeRoot", () => {
  it("puts a personal scope at the citizen's own WebDAV home", () => {
    assert.equal(scopeRoot(personal), `/remote.php/dav/files/${SUB}/`);
  });

  it("puts an org scope inside the group folder, url-encoded", () => {
    assert.equal(
      scopeRoot(org),
      `/remote.php/dav/files/${SUB}/Org%20Feuerwehr/`,
    );
  });

  it("refuses an org scope with no folder name rather than falling back to the home", () => {
    assert.throws(
      () => scopeRoot({ kind: "org", sub: SUB, accountId: "acc-7" }),
      ScopeViolationError,
    );
  });
});

describe("resolvePath", () => {
  it("joins a relative path onto the scope root", () => {
    assert.equal(
      resolvePath(personal, "Dokumente/Antrag.odt"),
      `/remote.php/dav/files/${SUB}/Dokumente/Antrag.odt`,
    );
  });

  it("treats an empty path as the root itself", () => {
    assert.equal(resolvePath(personal, ""), scopeRoot(personal));
  });

  it("encodes each segment without encoding the separators", () => {
    assert.equal(
      resolvePath(personal, "Meine Akten/Bericht #1.odt"),
      `/remote.php/dav/files/${SUB}/Meine%20Akten/Bericht%20%231.odt`,
    );
  });

  // The security boundary. Each of these must be rejected, not normalised away.
  for (const attack of [
    "../other-user/secrets.odt",
    "Dokumente/../../escape.odt",
    "..",
    "/etc/passwd",
    "\\\\windows\\\\path",
    "%2e%2e/escape.odt",
    "%2E%2E%2Fescape.odt",
    "Dokumente/\0/null.odt",
  ]) {
    it(`rejects ${JSON.stringify(attack)}`, () => {
      assert.throws(() => resolvePath(personal, attack), ScopeViolationError);
    });
  }

  it("keeps an org path inside the group folder", () => {
    assert.equal(
      resolvePath(org, "Protokolle/2026.odt"),
      `/remote.php/dav/files/${SUB}/Org%20Feuerwehr/Protokolle/2026.odt`,
    );
  });

  it("stops an org path escaping into the citizen's private home", () => {
    assert.throws(() => resolvePath(org, "../Privat/steuer.odt"), ScopeViolationError);
  });
});

describe("orgFolderName", () => {
  it("prefixes the org name so group folders are recognisable in the file list", () => {
    assert.equal(orgFolderName("Feuerwehr"), "Org Feuerwehr");
  });

  it("strips characters that would break a WebDAV path", () => {
    assert.equal(orgFolderName("Verein / Röbel\\Müritz"), "Org Verein Röbel Müritz");
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/scope'`.

- [ ] **Step 4: Write `types.ts`**

`packages/workspace/src/types.ts`:

```typescript
/**
 * Who is acting. Slice 1 only ever constructs `human`, but every call takes an
 * Actor so slice 2's agents use the identical code path — an agent carries its
 * own client-credentials token from the keystone and never borrows a human's
 * session. Attribution is structural rather than a convention to remember.
 */
export type Actor =
  | { kind: "human"; sub: string }
  | { kind: "agent"; sub: string; actingFor: string };

/**
 * Which slice of storage a request may touch. `sub` is always the WebDAV
 * principal (the signed-in citizen); an org scope narrows to that org's group
 * folder, which the citizen only sees at all because their `groups` claim put
 * them in it.
 */
export interface WorkspaceScope {
  kind: "personal" | "org";
  /** OIDC `sub` — the smart-account address, which is also the Nextcloud uid. */
  sub: string;
  /** Org account id. Required when kind === "org". */
  accountId?: string;
  /** Group folder name, e.g. "Org Feuerwehr". Required when kind === "org". */
  folderName?: string;
}
```

- [ ] **Step 5: Write `scope.ts`**

`packages/workspace/src/scope.ts`:

```typescript
import type { WorkspaceScope } from "./types";

/**
 * A request tried to leave its scope. This is a security failure, not a 404 —
 * it is thrown rather than returned so it can never be ignored by a caller that
 * forgot to check a return value.
 */
export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeViolationError";
  }
}

/** Percent-encode one path segment, leaving the separator alone. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Reject anything that could escape the scope root. Deliberately a denylist of
 * shapes plus a positive containment check afterwards: normalising a traversal
 * away and continuing would turn an attack into a silent success elsewhere.
 */
function assertSafeRelativePath(relPath: string): void {
  if (relPath.includes("\0")) {
    throw new ScopeViolationError("path contains a null byte");
  }
  if (relPath.startsWith("/")) {
    throw new ScopeViolationError("path must be relative to the scope root");
  }
  if (relPath.includes("\\")) {
    throw new ScopeViolationError("backslashes are not valid path separators");
  }
  // Decode first: "%2e%2e" is "..", and a caller that pre-encoded is either
  // confused or hostile. Either way the raw form is what we validate.
  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    throw new ScopeViolationError("path is not valid percent-encoding");
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.startsWith("/")) {
    throw new ScopeViolationError("path is unsafe once decoded");
  }
  for (const segment of decoded.split("/")) {
    if (segment === "..") {
      throw new ScopeViolationError("path traverses above the scope root");
    }
  }
}

/** The absolute WebDAV prefix every path in this scope must sit under. */
export function scopeRoot(scope: WorkspaceScope): string {
  const home = `/remote.php/dav/files/${encodeSegment(scope.sub)}/`;
  if (scope.kind === "personal") return home;
  if (!scope.folderName) {
    throw new ScopeViolationError("an org scope needs a folder name");
  }
  return `${home}${encodeSegment(scope.folderName)}/`;
}

/**
 * Resolve a caller-supplied relative path to an absolute WebDAV path, or throw.
 * The containment assertion at the end is the real guard — the shape checks
 * above only make its failure mode legible.
 */
export function resolvePath(scope: WorkspaceScope, relPath: string): string {
  const root = scopeRoot(scope);
  const trimmed = relPath.replace(/^\/+/, "");
  if (trimmed === "") return root;
  assertSafeRelativePath(relPath);

  const decoded = decodeURIComponent(trimmed);
  const encoded = decoded
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .map(encodeSegment)
    .join("/");
  const absolute = `${root}${encoded}`;

  if (!absolute.startsWith(root)) {
    throw new ScopeViolationError("resolved path escaped the scope root");
  }
  return absolute;
}

/**
 * The group folder name for an org. Prefixed so a citizen who belongs to three
 * orgs can tell the folders apart in one list, and stripped of the characters
 * that would otherwise need escaping at every layer.
 */
export function orgFolderName(orgName: string): string {
  const cleaned = orgName
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Org ${cleaned}`;
}
```

- [ ] **Step 6: Write `index.ts`**

`packages/workspace/src/index.ts`:

```typescript
export type { Actor, WorkspaceScope } from "./types";
export { ScopeViolationError, orgFolderName, resolvePath, scopeRoot } from "./scope";
```

- [ ] **Step 7: Run the tests and the typecheck**

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: all tests PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/workspace/package.json packages/workspace/tsconfig.json \
        packages/workspace/src/types.ts packages/workspace/src/scope.ts \
        packages/workspace/src/index.ts packages/workspace/test/scope.test.ts \
        pnpm-lock.yaml
git commit -m "feat(workspace): the package, and the scope guard it starts with

A path that escapes its scope is a security failure, so the guard is
built first and tested against traversal, encoded traversal, absolute
paths, backslashes and null bytes — and against an org scope reaching
back into the citizen's private home.

Node-agnostic by construction: it takes a scope, never a node constant."
```

---

### Task 3: Parse PROPFIND responses into typed entries

WebDAV answers a directory listing with a multi-status XML document. Parsing it is pure, so it is tested on its own before any network code exists.

**Files:**
- Create: `packages/workspace/src/propfind.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/propfind.test.ts`

**Interfaces:**
- Consumes: `ScopeViolationError` from Task 2 (not used here, but the module lives beside it).
- Produces:
  - `interface DirEntry { name: string; path: string; isDirectory: boolean; size: number; lastModified: string; contentType: string | null; fileId: string | null }`
  - `function parsePropfind(xml: string, rootHref: string): DirEntry[]`

- [ ] **Step 1: Write the failing test**

`packages/workspace/test/propfind.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePropfind } from "../src/propfind";

const ROOT = "/remote.php/dav/files/0xabc/";

const XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
      <d:getlastmodified>Mon, 27 Jul 2026 10:00:00 GMT</d:getlastmodified>
      <oc:fileid>100</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/Dokumente/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
      <d:getlastmodified>Mon, 27 Jul 2026 11:00:00 GMT</d:getlastmodified>
      <oc:fileid>101</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/0xabc/Bericht%20%231.odt</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getcontentlength>4096</d:getcontentlength>
      <d:getcontenttype>application/vnd.oasis.opendocument.text</d:getcontenttype>
      <d:getlastmodified>Mon, 27 Jul 2026 12:00:00 GMT</d:getlastmodified>
      <oc:fileid>102</oc:fileid>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

describe("parsePropfind", () => {
  it("drops the self entry so a listing contains only children", () => {
    const entries = parsePropfind(XML, ROOT);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["Dokumente", "Bericht #1.odt"],
    );
  });

  it("marks collections as directories with zero size", () => {
    const dir = parsePropfind(XML, ROOT)[0];
    assert.equal(dir.isDirectory, true);
    assert.equal(dir.size, 0);
    assert.equal(dir.contentType, null);
  });

  it("decodes percent-encoded names and keeps the path relative to the root", () => {
    const file = parsePropfind(XML, ROOT)[1];
    assert.equal(file.name, "Bericht #1.odt");
    assert.equal(file.path, "Bericht #1.odt");
    assert.equal(file.isDirectory, false);
    assert.equal(file.size, 4096);
    assert.equal(file.contentType, "application/vnd.oasis.opendocument.text");
    assert.equal(file.fileId, "102");
  });

  it("normalises the modification time to ISO 8601", () => {
    const file = parsePropfind(XML, ROOT)[1];
    assert.equal(file.lastModified, "2026-07-27T12:00:00.000Z");
  });

  it("returns an empty list for a directory with no children", () => {
    const empty = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${ROOT}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
    assert.deepEqual(parsePropfind(empty, ROOT), []);
  });

  it("survives a single-response document, which the parser must not read as a scalar", () => {
    const one = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${ROOT}Notiz.txt</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/><d:getcontentlength>7</d:getcontentlength>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
    const entries = parsePropfind(one, ROOT);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "Notiz.txt");
  });

  it("handles non-ASCII names, which is the normal case in German", () => {
    const umlaut = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>${ROOT}</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>${ROOT}Pr%C3%BCfbericht%20M%C3%BCritz.odt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
    assert.equal(parsePropfind(umlaut, ROOT)[0].name, "Prüfbericht Müritz.odt");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/propfind'`.

- [ ] **Step 3: Write `propfind.ts`**

`packages/workspace/src/propfind.ts`:

```typescript
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
```

- [ ] **Step 4: Export it and run the tests**

Add to `packages/workspace/src/index.ts`:

```typescript
export type { DirEntry } from "./propfind";
export { parsePropfind } from "./propfind";
```

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/propfind.ts packages/workspace/src/index.ts \
        packages/workspace/test/propfind.test.ts
git commit -m "feat(workspace): parse PROPFIND into typed entries

Drops the self entry so a listing is children only, decodes the
percent-encoded names German file names actually have, and forces the
single-response document into an array — the shape that silently reads
as a scalar and breaks a folder containing exactly one file."
```

---

### Task 4: The Nextcloud WebDAV client

**Files:**
- Create: `packages/workspace/src/nextcloud.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/nextcloud.test.ts`

**Interfaces:**
- Consumes: `WorkspaceScope`, `resolvePath`, `scopeRoot` (Task 2); `DirEntry`, `parsePropfind` (Task 3).
- Produces:
  - `interface NextcloudAuth { headers(): Promise<Record<string, string>> }`
  - `function bearerAuth(getToken: () => Promise<string>): NextcloudAuth`
  - `function basicAuth(user: string, password: string): NextcloudAuth`
  - `class NextcloudError extends Error { readonly status: number }`
  - `interface NextcloudClient { listDirectory · stat · download · upload · createFolder · move · remove }`
  - `function createNextcloudClient(opts: { baseUrl: string; auth: NextcloudAuth; fetch?: typeof globalThis.fetch }): NextcloudClient`

- [ ] **Step 1: Write the failing test**

`packages/workspace/test/nextcloud.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScopeViolationError } from "../src/scope";
import {
  NextcloudError,
  basicAuth,
  bearerAuth,
  createNextcloudClient,
} from "../src/nextcloud";
import type { WorkspaceScope } from "../src/types";

const SUB = "0xabc";
const scope: WorkspaceScope = { kind: "personal", sub: SUB };

const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/0xabc/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/files/0xabc/Notiz.txt</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>7</d:getcontentlength></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

/** Records every request and replies from a queue. */
function stubFetch(replies: Array<{ status: number; body?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const reply = replies.shift() ?? { status: 200 };
    return new Response(reply.body ?? "", { status: reply.status });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch };
}

describe("auth strategies", () => {
  it("bearer asks for a fresh token on every call, so refreshes are picked up", async () => {
    let issued = 0;
    const auth = bearerAuth(async () => `token-${++issued}`);
    assert.deepEqual(await auth.headers(), { Authorization: "Bearer token-1" });
    assert.deepEqual(await auth.headers(), { Authorization: "Bearer token-2" });
  });

  it("basic encodes the credential pair", async () => {
    const auth = basicAuth("admin", "pw");
    const expected = `Basic ${Buffer.from("admin:pw").toString("base64")}`;
    assert.deepEqual(await auth.headers(), { Authorization: expected });
  });
});

describe("listDirectory", () => {
  it("PROPFINDs the resolved path and returns typed children", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 207, body: LISTING }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example/",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    const entries = await client.listDirectory(scope, "");

    assert.equal(calls[0].method, "PROPFIND");
    assert.equal(calls[0].url, "https://cloud.example/remote.php/dav/files/0xabc/");
    assert.equal(calls[0].headers.Depth, "1");
    assert.equal(calls[0].headers.Authorization, "Bearer tok");
    assert.deepEqual(entries.map((e) => e.name), ["Notiz.txt"]);
  });

  it("refuses to issue a request at all when the path escapes the scope", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.listDirectory(scope, "../andere"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0, "no request may leave the process");
  });

  it("raises a typed error carrying the status", async () => {
    const { fetchImpl } = stubFetch([{ status: 401 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });

    await assert.rejects(
      () => client.listDirectory(scope, ""),
      (err: unknown) =>
        err instanceof NextcloudError && err.status === 401,
    );
  });
});

describe("mutations", () => {
  it("creates a folder with MKCOL", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.createFolder(scope, "Neuer Ordner");
    assert.equal(calls[0].method, "MKCOL");
    assert.equal(
      calls[0].url,
      "https://cloud.example/remote.php/dav/files/0xabc/Neuer%20Ordner",
    );
  });

  it("moves with an absolute Destination header", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.move(scope, "a.odt", "Archiv/a.odt");
    assert.equal(calls[0].method, "MOVE");
    assert.equal(
      calls[0].headers.Destination,
      "https://cloud.example/remote.php/dav/files/0xabc/Archiv/a.odt",
    );
  });

  it("validates BOTH ends of a move before issuing it", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await assert.rejects(
      () => client.move(scope, "a.odt", "../escape.odt"),
      ScopeViolationError,
    );
    assert.equal(calls.length, 0);
  });

  it("deletes and uploads at the resolved path", async () => {
    const { calls, fetchImpl } = stubFetch([{ status: 204 }, { status: 201 }]);
    const client = createNextcloudClient({
      baseUrl: "https://cloud.example",
      auth: bearerAuth(async () => "tok"),
      fetch: fetchImpl,
    });
    await client.remove(scope, "alt.odt");
    await client.upload(scope, "neu.odt", new Uint8Array([1, 2, 3]));
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[1].method, "PUT");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/nextcloud'`.

- [ ] **Step 3: Write `nextcloud.ts`**

`packages/workspace/src/nextcloud.ts`:

```typescript
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
```

- [ ] **Step 4: Export and run**

Add to `packages/workspace/src/index.ts`:

```typescript
export type { NextcloudAuth, NextcloudClient, NextcloudClientOptions } from "./nextcloud";
export { NextcloudError, basicAuth, bearerAuth, createNextcloudClient } from "./nextcloud";
```

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/nextcloud.ts packages/workspace/src/index.ts \
        packages/workspace/test/nextcloud.test.ts
git commit -m "feat(workspace): WebDAV client behind the scope guard

Auth is a strategy, not a header, because whether the node serves
bearer tokens or app passwords is an operational fact about a
deployment. Both ends of a MOVE are resolved before the request —
validating only the source would let a rename write out of scope.

Tests assert an out-of-scope call never reaches the network at all."
```

---

### Task 5: Idempotent provisioning (user, group, group folder)

Closes the open `§4.4` gap in `docs/WORKSPACE_STATE_AND_NEXT.md`: `groupfolders` is installed on the node but no folder exists.

**Files:**
- Create: `packages/workspace/src/provisioning.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/provisioning.test.ts`

**Interfaces:**
- Consumes: `NextcloudError` (Task 4), `orgFolderName` (Task 2).
- Produces:
  - `interface Provisioner { ensureUser · ensureGroup · ensureGroupFolder }`
  - `function createProvisioner(opts: { baseUrl: string; adminUser: string; adminPassword: string; fetch?: typeof globalThis.fetch }): Provisioner`
  - `ensureUser(sub: string, displayName: string): Promise<{ created: boolean }>`
  - `ensureGroup(groupId: string): Promise<{ created: boolean }>`
  - `ensureGroupFolder(params: { name: string; groupId: string }): Promise<{ folderId: number; created: boolean }>`

- [ ] **Step 1: Write the failing test**

`packages/workspace/test/provisioning.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProvisioner } from "../src/provisioning";

const SUB = "0xabc";

function ocs(statuscode: number, data: unknown): string {
  return JSON.stringify({ ocs: { meta: { statuscode }, data } });
}

function stubFetch(replies: Array<{ status?: number; body: string }>) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method ?? "GET",
      body: (init?.body as string | undefined) ?? null,
    });
    const reply = replies.shift() ?? { body: ocs(100, {}) };
    return new Response(reply.body, { status: reply.status ?? 200 });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch };
}

function provisioner(fetchImpl: typeof globalThis.fetch) {
  return createProvisioner({
    baseUrl: "https://cloud.example",
    adminUser: "admin",
    adminPassword: "pw",
    fetch: fetchImpl,
  });
}

describe("ensureUser", () => {
  it("does nothing when the user already exists", async () => {
    const { calls, fetchImpl } = stubFetch([{ body: ocs(100, { id: SUB }) }]);
    const result = await provisioner(fetchImpl).ensureUser(SUB, "Max");
    assert.deepEqual(result, { created: false });
    assert.equal(calls.length, 1, "a lookup only — no write");
  });

  it("creates the user when the lookup 404s", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(404, null) },
      { body: ocs(100, {}) },
    ]);
    const result = await provisioner(fetchImpl).ensureUser(SUB, "Max");
    assert.deepEqual(result, { created: true });
    assert.equal(calls[1].method, "POST");
    assert.match(calls[1].body ?? "", /userid=0xabc/);
    assert.match(calls[1].body ?? "", /displayName=Max/);
  });

  it("sends the OCS-APIRequest header, without which Nextcloud refuses the call", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_i: unknown, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(ocs(100, { id: SUB }));
    }) as unknown as typeof globalThis.fetch;
    await provisioner(fetchImpl).ensureUser(SUB, "Max");
    const headers = calls[0].headers as Record<string, string>;
    assert.equal(headers["OCS-APIRequest"], "true");
    assert.match(headers.Authorization, /^Basic /);
  });
});

describe("ensureGroupFolder", () => {
  it("reuses an existing folder with the same mount point", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr" } }) },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 1, "listing only — never a second create");
  });

  it("creates the folder and binds the group when none exists", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, {}) },
      { body: ocs(100, { id: 9 }) },
      { body: ocs(100, {}) },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 9, created: true });
    assert.match(calls[1].url, /\/apps\/groupfolders\/folders/);
    assert.match(calls[2].url, /\/apps\/groupfolders\/folders\/9\/groups/);
    assert.match(calls[2].body ?? "", /group=org%3Aacc-7%3Amember/);
  });
});

describe("ensureGroup", () => {
  it("creates a missing group and tolerates the already-exists code", async () => {
    const { fetchImpl } = stubFetch([{ body: ocs(102, null) }]);
    const result = await provisioner(fetchImpl).ensureGroup("org:acc-7:member");
    assert.deepEqual(result, { created: false });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/provisioning'`.

- [ ] **Step 3: Write `provisioning.ts`**

`packages/workspace/src/provisioning.ts`:

```typescript
import { NextcloudError } from "./nextcloud";

/**
 * Nextcloud provisioning over OCS. Every operation is create-if-absent, because
 * it runs on the request path — a citizen's first entry into the workspace —
 * and must be safe to hit concurrently from two tabs.
 */
export interface Provisioner {
  ensureUser(sub: string, displayName: string): Promise<{ created: boolean }>;
  ensureGroup(groupId: string): Promise<{ created: boolean }>;
  ensureGroupFolder(params: {
    name: string;
    groupId: string;
  }): Promise<{ folderId: number; created: boolean }>;
}

export interface ProvisionerOptions {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
  fetch?: typeof globalThis.fetch;
}

interface OcsEnvelope<T> {
  ocs: { meta: { statuscode: number }; data: T };
}

/** OCS says "already exists" with 102 rather than an error — not a failure. */
const ALREADY_EXISTS = 102;
const NOT_FOUND = 404;

export function createProvisioner(opts: ProvisionerOptions): Provisioner {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const authorization = `Basic ${Buffer.from(
    `${opts.adminUser}:${opts.adminPassword}`,
  ).toString("base64")}`;

  async function ocs<T>(
    method: string,
    path: string,
    form?: Record<string, string>,
  ): Promise<OcsEnvelope<T>> {
    const headers: Record<string, string> = {
      Authorization: authorization,
      // Without this header Nextcloud rejects the request outright.
      "OCS-APIRequest": "true",
      Accept: "application/json",
    };
    let body: string | undefined;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const res = await doFetch(`${base}${path}`, { method, headers, body });
    const text = await res.text();
    if (!res.ok) {
      throw new NextcloudError(res.status, `${method} ${path}: ${res.status}`);
    }
    try {
      return JSON.parse(text) as OcsEnvelope<T>;
    } catch {
      throw new NextcloudError(res.status, `${method} ${path}: non-JSON OCS reply`);
    }
  }

  return {
    async ensureUser(sub, displayName) {
      const lookup = await ocs<unknown>(
        "GET",
        `/ocs/v1.php/cloud/users/${encodeURIComponent(sub)}?format=json`,
      );
      if (lookup.ocs.meta.statuscode !== NOT_FOUND) return { created: false };

      await ocs("POST", "/ocs/v1.php/cloud/users?format=json", {
        userid: sub,
        displayName,
        // The account authenticates through OIDC; this password is never used
        // for login, and the OCS API refuses to create a user without one.
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
      return { created: true };
    },

    async ensureGroup(groupId) {
      const created = await ocs<unknown>(
        "POST",
        "/ocs/v1.php/cloud/groups?format=json",
        { groupid: groupId },
      );
      return { created: created.ocs.meta.statuscode !== ALREADY_EXISTS };
    },

    async ensureGroupFolder({ name, groupId }) {
      const listing = await ocs<Record<string, { id: number; mount_point: string }>>(
        "GET",
        "/apps/groupfolders/folders?format=json",
      );
      const existing = Object.values(listing.ocs.data ?? {}).find(
        (folder) => folder.mount_point === name,
      );
      if (existing) return { folderId: existing.id, created: false };

      const created = await ocs<{ id: number }>(
        "POST",
        "/apps/groupfolders/folders?format=json",
        { mountpoint: name },
      );
      const folderId = created.ocs.data.id;
      await ocs("POST", `/apps/groupfolders/folders/${folderId}/groups?format=json`, {
        group: groupId,
      });
      return { folderId, created: true };
    },
  };
}
```

- [ ] **Step 4: Export and run**

Add to `packages/workspace/src/index.ts`:

```typescript
export type { Provisioner, ProvisionerOptions } from "./provisioning";
export { createProvisioner } from "./provisioning";
```

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/provisioning.ts packages/workspace/src/index.ts \
        packages/workspace/test/provisioning.test.ts
git commit -m "feat(workspace): create-if-absent provisioning for users and group folders

Runs on the request path — a citizen's first entry — so every
operation is idempotent and safe to hit from two tabs at once. OCS
reports 'already exists' as statuscode 102 rather than an error, which
is treated as success rather than retried.

Closes the group-folder gap WORKSPACE_STATE_AND_NEXT lists as open."
```

---

### Task 6: Provenance — the seam slice 2 needs

Slice 1 records to Postgres. Slice 2 adds a Nostr sink that publishes the same record signed by the actor's own npub. One call site means the audit log is complete from day one.

**Files:**
- Create: `packages/workspace/src/provenance.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/provenance.test.ts`

**Interfaces:**
- Consumes: `Actor`, `WorkspaceScope` (Task 2).
- Produces:
  - `type WorkspaceActionKind = "upload" | "create-folder" | "update" | "move" | "delete"`
  - `interface WorkspaceAction { actor: Actor; kind: WorkspaceActionKind; scopeKind: "personal" | "org"; accountId: string | null; path: string; at: string }`
  - `interface ProvenanceSink { name: string; record(action: WorkspaceAction): Promise<void> }`
  - `function buildAction(params: { actor: Actor; kind: WorkspaceActionKind; scope: WorkspaceScope; path: string; now?: Date }): WorkspaceAction`
  - `function createRecorder(sinks: ProvenanceSink[]): (action: WorkspaceAction) => Promise<void>`

- [ ] **Step 1: Write the failing test**

`packages/workspace/test/provenance.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAction,
  createRecorder,
  type ProvenanceSink,
  type WorkspaceAction,
} from "../src/provenance";
import type { WorkspaceScope } from "../src/types";

const scope: WorkspaceScope = {
  kind: "org",
  sub: "0xabc",
  accountId: "acc-7",
  folderName: "Org Feuerwehr",
};

describe("buildAction", () => {
  it("records who acted, on what, and when", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "Protokolle/2026.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action, {
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scopeKind: "org",
      accountId: "acc-7",
      path: "Protokolle/2026.odt",
      at: "2026-07-28T09:00:00.000Z",
    });
  });

  it("keeps the delegation chain for an agent, which is the whole point", () => {
    const action = buildAction({
      actor: { kind: "agent", sub: "0xagent", actingFor: "0xabc" },
      kind: "update",
      scope,
      path: "Antrag.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action.actor, {
      kind: "agent",
      sub: "0xagent",
      actingFor: "0xabc",
    });
  });

  it("carries no accountId for a personal scope", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "delete",
      scope: { kind: "personal", sub: "0xabc" },
      path: "alt.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.equal(action.accountId, null);
  });

  // Slice 2 publishes this record to a world-readable, effectively
  // undeletable relay. Anything beyond these six keys would be permanent.
  it("has exactly the six keys and no content field", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(Object.keys(action).sort(), [
      "accountId",
      "actor",
      "at",
      "kind",
      "path",
      "scopeKind",
    ]);
  });
});

describe("createRecorder", () => {
  it("writes to every sink", async () => {
    const seen: string[] = [];
    const sink = (name: string): ProvenanceSink => ({
      name,
      async record() {
        seen.push(name);
      },
    });
    const record = createRecorder([sink("postgres"), sink("nostr")]);
    await record(buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
    }));
    assert.deepEqual(seen, ["postgres", "nostr"]);
  });

  // A failed audit write must not undo a file the citizen already saved.
  it("does not reject when a sink throws, and still writes the others", async () => {
    const seen: string[] = [];
    const failing: ProvenanceSink = {
      name: "broken",
      async record() {
        throw new Error("relay unreachable");
      },
    };
    const working: ProvenanceSink = {
      name: "postgres",
      async record() {
        seen.push("postgres");
      },
    };
    const record = createRecorder([failing, working]);
    await record(buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
    }));
    assert.deepEqual(seen, ["postgres"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/provenance'`.

- [ ] **Step 3: Write `provenance.ts`**

`packages/workspace/src/provenance.ts`:

```typescript
import type { Actor, WorkspaceScope } from "./types";

export type WorkspaceActionKind =
  | "upload"
  | "create-folder"
  | "update"
  | "move"
  | "delete";

/**
 * One auditable thing that happened in a workspace.
 *
 * Deliberately metadata-only. Slice 2 publishes this record to Nostr, where
 * deletion is advisory (NIP-09) and reads are open to the world — so document
 * content and personal data must never be able to reach it. The shape is the
 * enforcement, and a test pins the key set.
 */
export interface WorkspaceAction {
  actor: Actor;
  kind: WorkspaceActionKind;
  scopeKind: "personal" | "org";
  /** Org account id, or null for a personal scope. */
  accountId: string | null;
  /** Path relative to the scope root. */
  path: string;
  /** ISO 8601. */
  at: string;
}

export interface ProvenanceSink {
  /** Used only in the warning line when a sink fails. */
  name: string;
  record(action: WorkspaceAction): Promise<void>;
}

export function buildAction(params: {
  actor: Actor;
  kind: WorkspaceActionKind;
  scope: WorkspaceScope;
  path: string;
  now?: Date;
}): WorkspaceAction {
  return {
    actor: params.actor,
    kind: params.kind,
    scopeKind: params.scope.kind,
    accountId: params.scope.kind === "org" ? (params.scope.accountId ?? null) : null,
    path: params.path,
    at: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Fan out to every sink. Failures are logged, never thrown: the file operation
 * has already succeeded by the time we get here, and rejecting would report a
 * completed save as a failure. An unreachable relay must not look like a lost
 * document.
 */
export function createRecorder(
  sinks: ProvenanceSink[],
): (action: WorkspaceAction) => Promise<void> {
  return async (action) => {
    await Promise.all(
      sinks.map(async (sink) => {
        try {
          await sink.record(action);
        } catch (error) {
          console.warn(
            `[workspace] provenance sink "${sink.name}" failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
  };
}
```

- [ ] **Step 4: Export and run**

Add to `packages/workspace/src/index.ts`:

```typescript
export type { ProvenanceSink, WorkspaceAction, WorkspaceActionKind } from "./provenance";
export { buildAction, createRecorder } from "./provenance";
```

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/provenance.ts packages/workspace/src/index.ts \
        packages/workspace/test/provenance.test.ts
git commit -m "feat(workspace): the provenance seam, metadata only

One call site for every mutation, so slice 2 adds a Nostr sink instead
of reconstructing an audit trail. The record is metadata-only and a
test pins its key set: slice 2 publishes it to a world-readable relay
where deletion is advisory, so content must be structurally unable to
reach it.

A failing sink warns and never rejects — an unreachable relay must not
report a saved document as lost."
```

---

### Task 7: The WOPI host

What makes this a workspace rather than a Nextcloud skin: the document opens inside our page, under our sidebar, with no Nextcloud chrome.

**Files:**
- Create: `packages/workspace/src/wopi.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/wopi.test.ts`

**Interfaces:**
- Consumes: `DirEntry` (Task 3), `WorkspaceScope` (Task 2).
- Produces:
  - `interface WopiClaims { sub: string; scope: WorkspaceScope; path: string; canWrite: boolean }`
  - `function mintWopiToken(claims: WopiClaims, secret: Uint8Array, ttlSeconds: number): Promise<string>`
  - `function verifyWopiToken(token: string, secret: Uint8Array): Promise<WopiClaims>`
  - `function encodeFileId(scope: WorkspaceScope, path: string): string`
  - `function decodeFileId(fileId: string): { scope: WorkspaceScope; path: string }`
  - `function checkFileInfo(entry: DirEntry, claims: WopiClaims, userFriendlyName: string): WopiFileInfo`
  - `function parseDiscovery(xml: string): Map<string, string>`
  - `function buildEditorUrl(params: { urlsrc: string; wopiSrc: string; lang: string }): string`

- [ ] **Step 1: Write the failing test**

`packages/workspace/test/wopi.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEditorUrl,
  checkFileInfo,
  decodeFileId,
  encodeFileId,
  mintWopiToken,
  parseDiscovery,
  verifyWopiToken,
  type WopiClaims,
} from "../src/wopi";
import type { DirEntry } from "../src/propfind";
import type { WorkspaceScope } from "../src/types";

const SECRET = new Uint8Array(32).fill(7);
const scope: WorkspaceScope = { kind: "personal", sub: "0xabc" };
const claims: WopiClaims = {
  sub: "0xabc",
  scope,
  path: "Dokumente/Antrag.odt",
  canWrite: true,
};

describe("file ids", () => {
  it("round-trips scope and path", () => {
    const decoded = decodeFileId(encodeFileId(scope, "Dokumente/Antrag.odt"));
    assert.deepEqual(decoded.scope, scope);
    assert.equal(decoded.path, "Dokumente/Antrag.odt");
  });

  it("is url-safe, because it travels in a WOPISrc query parameter", () => {
    assert.match(encodeFileId(scope, "Meine Akten/Bericht #1.odt"), /^[A-Za-z0-9_-]+$/);
  });
});

describe("tokens", () => {
  it("round-trips the claims", async () => {
    const token = await mintWopiToken(claims, SECRET, 600);
    assert.deepEqual(await verifyWopiToken(token, SECRET), claims);
  });

  it("rejects an expired token", async () => {
    const token = await mintWopiToken(claims, SECRET, -1);
    await assert.rejects(() => verifyWopiToken(token, SECRET));
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintWopiToken(claims, SECRET, 600);
    await assert.rejects(
      () => verifyWopiToken(token, new Uint8Array(32).fill(9)),
    );
  });
});

describe("checkFileInfo", () => {
  const entry: DirEntry = {
    name: "Antrag.odt",
    path: "Dokumente/Antrag.odt",
    isDirectory: false,
    size: 4096,
    lastModified: "2026-07-28T09:00:00.000Z",
    contentType: "application/vnd.oasis.opendocument.text",
    fileId: "102",
  };

  it("reports the file to Collabora with write permission", () => {
    const info = checkFileInfo(entry, claims, "Max B.");
    assert.equal(info.BaseFileName, "Antrag.odt");
    assert.equal(info.Size, 4096);
    assert.equal(info.UserCanWrite, true);
    assert.equal(info.SupportsUpdate, true);
    assert.equal(info.UserFriendlyName, "Max B.");
  });

  it("never puts a wallet address in the name Collabora renders", () => {
    const info = checkFileInfo(entry, claims, "Max B.");
    assert.doesNotMatch(info.UserFriendlyName, /^0x/);
  });

  it("marks a read-only session as such", () => {
    const info = checkFileInfo(entry, { ...claims, canWrite: false }, "Max B.");
    assert.equal(info.UserCanWrite, false);
    assert.equal(info.SupportsUpdate, false);
  });
});

describe("parseDiscovery", () => {
  const XML = `<?xml version="1.0"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app name="writer">
      <action name="edit" ext="odt" urlsrc="https://office.example/browser/abc/cool.html?"/>
    </app>
    <app name="calc">
      <action name="edit" ext="ods" urlsrc="https://office.example/browser/abc/cool.html?"/>
    </app>
  </net-zone>
</wopi-discovery>`;

  it("maps each extension to its editor url", () => {
    const map = parseDiscovery(XML);
    assert.equal(map.get("odt"), "https://office.example/browser/abc/cool.html?");
    assert.equal(map.get("ods"), "https://office.example/browser/abc/cool.html?");
  });

  it("returns an empty map for a discovery document with no actions", () => {
    assert.equal(parseDiscovery("<wopi-discovery/>").size, 0);
  });
});

describe("buildEditorUrl", () => {
  it("appends WOPISrc and language to the discovery urlsrc", () => {
    const url = new URL(
      buildEditorUrl({
        urlsrc: "https://office.example/browser/abc/cool.html?",
        wopiSrc: "https://roebel.app/api/workspace/wopi/files/XYZ",
        lang: "de-DE",
      }),
    );
    assert.equal(
      url.searchParams.get("WOPISrc"),
      "https://roebel.app/api/workspace/wopi/files/XYZ",
    );
    assert.equal(url.searchParams.get("lang"), "de-DE");
  });

  // The token is POSTed into the iframe, never placed in a URL that would
  // land in browser history, referrers and server logs.
  it("does not carry the access token", () => {
    const url = buildEditorUrl({
      urlsrc: "https://office.example/browser/abc/cool.html?",
      wopiSrc: "https://roebel.app/api/workspace/wopi/files/XYZ",
      lang: "de-DE",
    });
    assert.doesNotMatch(url, /access_token/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/workspace test
```

Expected: FAIL — `Cannot find module '../src/wopi'`.

- [ ] **Step 3: Write `wopi.ts`**

`packages/workspace/src/wopi.ts`:

```typescript
import { XMLParser } from "fast-xml-parser";
import { SignJWT, jwtVerify } from "jose";
import type { DirEntry } from "./propfind";
import type { WorkspaceScope } from "./types";

/**
 * What a WOPI session is allowed to touch. Bound to ONE path, so a leaked
 * token opens one document for its remaining lifetime rather than a filesystem.
 */
export interface WopiClaims {
  sub: string;
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
  const doc = discoveryParser.parse(xml) as Record<string, unknown>;
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
```

- [ ] **Step 4: Export and run**

Add to `packages/workspace/src/index.ts`:

```typescript
export type { WopiClaims, WopiFileInfo } from "./wopi";
export {
  buildEditorUrl,
  checkFileInfo,
  decodeFileId,
  encodeFileId,
  mintWopiToken,
  parseDiscovery,
  verifyWopiToken,
} from "./wopi";
```

```bash
pnpm --filter @netizen-labs/workspace test
pnpm --filter @netizen-labs/workspace typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace/src/wopi.ts packages/workspace/src/index.ts \
        packages/workspace/test/wopi.test.ts
git commit -m "feat(workspace): be the WOPI host, so documents open in our page

Collabora is built to be embedded this way, so nothing has to be
defeated — no framing header to strip, no Nextcloud chrome to hide.

Tokens are bound to ONE path and expire, so a leak opens one document
briefly rather than a filesystem, and the editor url deliberately
omits the token: it is POSTed into the frame instead of landing in
history, referrers and access logs."
```

---

### Task 8: Register the web app as the keystone's third relying party

**Files:**
- Modify: `apps/roebel-id/src/config.ts:13-27` (the `Config` interface) and `:35-66` (`loadConfig`)
- Modify: `apps/roebel-id/src/wire.ts:45-49` (`firstPartyClientIds`)
- Modify: `apps/roebel-id/.env.example`
- Test: `apps/roebel-id/test/config.test.ts`

**Interfaces:**
- Consumes: the existing `RelyingPartyConfig` shape.
- Produces: `Config.web?: RelyingPartyConfig`, registered only when `WEB_CLIENT_ID` is set, and included in `firstPartyClientIds` so consent is pre-granted like Nextcloud's and Matrix's.

- [ ] **Step 1: Write the failing test**

`apps/roebel-id/test/config.test.ts` (create it if absent; if it exists, append these cases):

```typescript
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { loadConfig } from '../src/config.js'

const BASE = {
  ISSUER_URL: 'https://id.example',
  COOKIE_KEYS: 'a,b',
  GNOSIS_RPC_URL: 'https://rpc.example',
  CITIZEN_NFT_ADDRESS: '0x0000000000000000000000000000000000000001',
  ATTESTER_NFT_ADDRESS: '0x0000000000000000000000000000000000000002',
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SERVICE_KEY: 'service',
  THIRDWEB_CLIENT_ID: 'tw',
  NEXTCLOUD_CLIENT_ID: 'nextcloud',
  NEXTCLOUD_CLIENT_SECRET: 'nc-secret',
  NEXTCLOUD_REDIRECT_URIS: 'https://cloud.example/apps/user_oidc/code',
}

function withEnv(extra: Record<string, string>) {
  for (const [k, v] of Object.entries({ ...BASE, ...extra })) process.env[k] = v
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('WEB_') || key in BASE) delete process.env[key]
  }
})

describe('web relying party', () => {
  it('is absent when WEB_CLIENT_ID is unset, so the keystone boots unchanged', () => {
    withEnv({})
    assert.equal(loadConfig().web, undefined)
  })

  it('is registered when WEB_CLIENT_ID is set', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    assert.deepEqual(loadConfig().web, {
      clientId: 'roebel-web',
      clientSecret: 'web-secret',
      redirectUris: ['https://roebel.app/api/workspace/auth/callback'],
      postLogoutRedirectUris: [],
    })
  })

  it('fails loudly when the id is set but the secret is missing', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    assert.throws(() => loadConfig(), /WEB_CLIENT_SECRET/)
  })

  it('accepts several redirect uris, for preview deployments', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS:
        'https://roebel.app/api/workspace/auth/callback,https://staging.roebel.app/api/workspace/auth/callback',
    })
    assert.equal(loadConfig().web?.redirectUris.length, 2)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd apps/roebel-id && pnpm test
```

Expected: FAIL — `web` is not a property of `Config`.

- [ ] **Step 3: Add the client to `config.ts`**

In `apps/roebel-id/src/config.ts`, extend the interface (after the `matrix` field, line 26):

```typescript
  /** The Röbel web app's own workspace session. Registered only when WEB_CLIENT_ID is set. */
  web?: RelyingPartyConfig
```

And extend `loadConfig`'s return, after the existing `matrix` spread:

```typescript
    // The web app is optional for the same reason Matrix is: the keystone must
    // boot unchanged on a node that has not stood up the workspace yet.
    ...(process.env.WEB_CLIENT_ID
      ? {
          web: {
            clientId: required('WEB_CLIENT_ID'),
            clientSecret: required('WEB_CLIENT_SECRET'),
            redirectUris: required('WEB_REDIRECT_URIS').split(','),
            postLogoutRedirectUris: (process.env.WEB_POST_LOGOUT_URIS ?? '').split(',').filter(Boolean),
          },
        }
      : {}),
```

- [ ] **Step 4: Register it as first-party in `wire.ts`**

Replace `firstPartyClientIds` (currently lines 45-48):

```typescript
    firstPartyClientIds: [
      config.nextcloud.clientId,
      ...(config.matrix ? [config.matrix.clientId] : []),
      ...(config.web ? [config.web.clientId] : []),
    ],
```

The provider builds its client list from the same config, so no change is needed in `src/oidc/provider.ts` — verify by reading `buildProvider`'s `relyingParties` argument and confirming `web` is included wherever `matrix` is.

- [ ] **Step 5: Run the full keystone test suite**

```bash
cd apps/roebel-id && pnpm test
```

Expected: PASS, including the pre-existing e2e authorization-code flow tests — those are the regression guard for the multi-client change.

- [ ] **Step 6: Document the new env vars**

Append to `apps/roebel-id/.env.example` — placeholders only:

```bash
# The Röbel web app's workspace session (optional; omit to disable the workspace)
WEB_CLIENT_ID=roebel-web
WEB_CLIENT_SECRET=replace-with-a-strong-random-secret
WEB_REDIRECT_URIS=https://roebel.app/api/workspace/auth/callback
```

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/src/config.ts apps/roebel-id/src/wire.ts \
        apps/roebel-id/.env.example apps/roebel-id/test/config.test.ts
git commit -m "feat(roebel-id): the web app becomes a relying party

Third first-party client, registered exactly the way Matrix already is
— absent unless WEB_CLIENT_ID is set, so a node that has not stood up
the workspace boots unchanged.

Deploy is a separate step: fly deploy from apps/roebel-id/, never the
repo root, or the build context is 30 GB."
```

> **Deploy note for the operator (not part of the commit):**
> ```bash
> fly secrets set -a roebel-id \
>   WEB_CLIENT_ID="roebel-web" \
>   WEB_CLIENT_SECRET="$(openssl rand -hex 32)" \
>   WEB_REDIRECT_URIS="https://roebel.app/api/workspace/auth/callback"
> cd apps/roebel-id && fly deploy -a roebel-id
> ```

---

### Task 9: The web app's OIDC + session module

Pure and React-free, so the whole auth surface is unit-tested before a route handler exists.

**Files:**
- Create: `apps/web/src/lib/workspace/oidc.ts`
- Create: `apps/web/src/lib/workspace/session.ts`
- Modify: `apps/web/.env.example`
- Test: `apps/web/tests/workspace-session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface WorkspaceSession { sub: string; groups: string[]; accessToken: string; refreshToken: string | null; expiresAt: number }`
  - `function sealSession(s: WorkspaceSession, key: Uint8Array): Promise<string>`
  - `function openSession(jwe: string, key: Uint8Array): Promise<WorkspaceSession | null>`
  - `function isExpired(s: WorkspaceSession, nowMs: number): boolean`
  - `function sessionMatchesWallet(s: WorkspaceSession, wallet: string): boolean`
  - `function orgGroupId(accountId: string): string`
  - `function hasOrgAccess(s: WorkspaceSession, accountId: string): boolean`
  - `function createPkcePair(): Promise<{ verifier: string; challenge: string }>`
  - `function buildAuthorizationUrl(p: { issuer: string; clientId: string; redirectUri: string; state: string; codeChallenge: string }): string`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-session.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAuthorizationUrl, createPkcePair } from "../src/lib/workspace/oidc";
import {
  hasOrgAccess,
  isExpired,
  openSession,
  orgGroupId,
  sealSession,
  sessionMatchesWallet,
  type WorkspaceSession,
} from "../src/lib/workspace/session";

const KEY = new Uint8Array(32).fill(3);
const session: WorkspaceSession = {
  sub: "0xAbC0000000000000000000000000000000000001",
  groups: ["citizen", "org:acc-7:member"],
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 2_000_000_000_000,
};

describe("session sealing", () => {
  it("round-trips through an encrypted cookie", async () => {
    const sealed = await sealSession(session, KEY);
    assert.deepEqual(await openSession(sealed, KEY), session);
  });

  it("is opaque — the token must not be readable from the cookie", async () => {
    const sealed = await sealSession(session, KEY);
    assert.doesNotMatch(sealed, /"at"|"rt"|0xAbC/i);
  });

  it("returns null rather than throwing on a tampered cookie", async () => {
    const sealed = await sealSession(session, KEY);
    assert.equal(await openSession(`${sealed}x`, KEY), null);
  });

  it("returns null for a cookie sealed with a different key", async () => {
    const sealed = await sealSession(session, KEY);
    assert.equal(await openSession(sealed, new Uint8Array(32).fill(9)), null);
  });
});

describe("expiry", () => {
  it("is expired once the clock passes expiresAt", () => {
    assert.equal(isExpired(session, 2_000_000_000_001), true);
  });

  // Refreshing slightly early avoids a token that dies mid-request.
  it("is treated as expired inside the 30s skew window", () => {
    assert.equal(isExpired(session, 2_000_000_000_000 - 15_000), true);
    assert.equal(isExpired(session, 2_000_000_000_000 - 45_000), false);
  });
});

describe("wallet binding", () => {
  it("matches case-insensitively, because checksummed and lowercase forms both occur", () => {
    assert.equal(
      sessionMatchesWallet(session, "0xabc0000000000000000000000000000000000001"),
      true,
    );
  });

  // Without this the previous citizen's files would stay on screen after a switch.
  it("does not match a different wallet", () => {
    assert.equal(
      sessionMatchesWallet(session, "0x0000000000000000000000000000000000000002"),
      false,
    );
  });
});

describe("org access", () => {
  it("derives the group id the keystone emits", () => {
    assert.equal(orgGroupId("acc-7"), "org:acc-7:member");
  });

  it("grants access when the claim is present", () => {
    assert.equal(hasOrgAccess(session, "acc-7"), true);
  });

  it("denies access for an org the citizen has no claim for", () => {
    assert.equal(hasOrgAccess(session, "acc-9"), false);
  });

  it("accepts any role, not only member", () => {
    const owner = { ...session, groups: ["org:acc-9:owner"] };
    assert.equal(hasOrgAccess(owner, "acc-9"), true);
  });
});

describe("pkce + authorization url", () => {
  it("derives an S256 challenge from the verifier", async () => {
    const { verifier, challenge } = await createPkcePair();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const expected = Buffer.from(new Uint8Array(digest)).toString("base64url");
    assert.equal(challenge, expected);
  });

  it("builds a spec-shaped authorization request", () => {
    const url = new URL(
      buildAuthorizationUrl({
        issuer: "https://id.roebel.app",
        clientId: "roebel-web",
        redirectUri: "https://roebel.app/api/workspace/auth/callback",
        state: "st",
        codeChallenge: "ch",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://id.roebel.app/auth");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "roebel-web");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "ch");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("scope"), "openid profile email roebel");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/session'`.

- [ ] **Step 3: Write `session.ts`**

`apps/web/src/lib/workspace/session.ts`:

```typescript
import { CompactEncrypt, compactDecrypt } from "jose";

/**
 * The citizen's workspace session, held server-side and sealed into an httpOnly
 * cookie. Access tokens never reach the browser: every Nextcloud call is
 * proxied by a route handler.
 */
export interface WorkspaceSession {
  /** OIDC `sub` — the smart-account address, which is also the Nextcloud uid. */
  sub: string;
  /** The keystone's `groups` claim: citizen, attester, org:<accountId>:<role>. */
  groups: string[];
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Refresh this far before real expiry so a token cannot die mid-request. */
const SKEW_MS = 30_000;

export async function sealSession(
  session: WorkspaceSession,
  key: Uint8Array,
): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(session)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
}

/**
 * Returns null rather than throwing on any failure. A tampered or stale cookie
 * is an ordinary "not signed in", and making callers wrap every read in a
 * try/catch would guarantee one of them eventually forgets.
 */
export async function openSession(
  jwe: string,
  key: Uint8Array,
): Promise<WorkspaceSession | null> {
  try {
    const { plaintext } = await compactDecrypt(jwe, key);
    return JSON.parse(new TextDecoder().decode(plaintext)) as WorkspaceSession;
  } catch {
    return null;
  }
}

export function isExpired(session: WorkspaceSession, nowMs: number): boolean {
  return nowMs >= session.expiresAt - SKEW_MS;
}

/**
 * The session is keyed to `sub`. Without this check, switching wallets in the
 * app would leave the previous citizen's files on screen — an identity bug, not
 * a caching bug.
 */
export function sessionMatchesWallet(
  session: WorkspaceSession,
  wallet: string,
): boolean {
  return session.sub.toLowerCase() === wallet.toLowerCase();
}

/** The claim the keystone emits for org membership. */
export function orgGroupId(accountId: string): string {
  return `org:${accountId}:member`;
}

/** Any role in the org grants workspace access; the folder ACL narrows it. */
export function hasOrgAccess(
  session: WorkspaceSession,
  accountId: string,
): boolean {
  const prefix = `org:${accountId}:`;
  return session.groups.some((group) => group.startsWith(prefix));
}
```

- [ ] **Step 4: Write `oidc.ts`**

`apps/web/src/lib/workspace/oidc.ts`:

```typescript
/** Scopes the keystone declares; `roebel` is what carries the groups claim. */
export const WORKSPACE_SCOPES = "openid profile email roebel";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token: string;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** PKCE S256 pair. The verifier stays in a short-lived cookie, never in a URL. */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function buildAuthorizationUrl(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL("/auth", params.issuer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", WORKSPACE_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function postToken(
  issuer: string,
  clientId: string,
  clientSecret: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(new URL("/token", issuer), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return postToken(params.issuer, params.clientId, params.clientSecret, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

export async function refreshTokens(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return postToken(params.issuer, params.clientId, params.clientSecret, {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm test:web
```

Expected: PASS.

- [ ] **Step 6: Document the env vars**

Append to `apps/web/.env.example` — placeholders only:

```bash
# --- Sovereign workspace (Arbeitsbereich) ---
# Server-side only. Absent = the workspace routes 404 and the app ships unchanged.
ROEBEL_ID_ISSUER=https://id.roebel.app
WORKSPACE_CLIENT_ID=roebel-web
WORKSPACE_CLIENT_SECRET=replace-me
# 32 random bytes, base64: openssl rand -base64 32
WORKSPACE_SESSION_KEY=replace-me
WOPI_TOKEN_SECRET=replace-me
NEXTCLOUD_BASE_URL=https://cloud.roebel.app
NEXTCLOUD_ADMIN_USER=replace-me
NEXTCLOUD_ADMIN_PASSWORD=replace-me
COLLABORA_BASE_URL=https://cloud.roebel.app
NEXT_PUBLIC_APP_ORIGIN=https://roebel.app
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workspace/oidc.ts apps/web/src/lib/workspace/session.ts \
        apps/web/.env.example apps/web/tests/workspace-session.test.ts
git commit -m "feat(web): the workspace session, sealed and keyed to sub

Tokens live in an encrypted httpOnly cookie and never reach the
browser. The session is keyed to sub, so switching wallets in the app
discards it — otherwise the previous citizen's files would stay on
screen, which is an identity bug rather than a caching one.

openSession returns null instead of throwing: a tampered cookie is an
ordinary 'not signed in', and a throwing reader guarantees some call
site eventually forgets the try/catch."
```

---

### Task 10: The server context — one place that resolves session, scope and client

Every route handler needs the same four things: a valid session, a refreshed token, a resolved scope, and a Nextcloud client. Building that once keeps the handlers to a few lines each, which is what makes them thin enough not to need their own tests.

**Files:**
- Create: `apps/web/src/lib/workspace/config.ts`
- Create: `apps/web/src/lib/workspace/context.ts`
- Test: `apps/web/tests/workspace-context.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSession`, `isExpired`, `hasOrgAccess` (Task 9); `refreshTokens` (Task 9); `createNextcloudClient`, `bearerAuth` (Task 4); `orgFolderName` (Task 2).
- Produces:
  - `function workspaceConfig(): WorkspaceConfig` — reads and validates env once
  - `function isWorkspaceEnabled(): boolean`
  - `class WorkspaceAuthError extends Error { readonly reason: "no-session" | "expired" | "forbidden" }`
  - `function resolveScope(p: { session: WorkspaceSession; scopeKind: string | null; accountId: string | null; orgName: string | null }): WorkspaceScope`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-context.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceAuthError, resolveScope } from "../src/lib/workspace/context";
import type { WorkspaceSession } from "../src/lib/workspace/session";

const session: WorkspaceSession = {
  sub: "0xabc",
  groups: ["citizen", "org:acc-7:member"],
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 9_999_999_999_999,
};

describe("resolveScope", () => {
  it("defaults to the citizen's personal scope", () => {
    assert.deepEqual(
      resolveScope({ session, scopeKind: null, accountId: null, orgName: null }),
      { kind: "personal", sub: "0xabc" },
    );
  });

  it("builds an org scope from the org name", () => {
    assert.deepEqual(
      resolveScope({
        session,
        scopeKind: "org",
        accountId: "acc-7",
        orgName: "Feuerwehr",
      }),
      {
        kind: "org",
        sub: "0xabc",
        accountId: "acc-7",
        folderName: "Org Feuerwehr",
      },
    );
  });

  // The groups claim is the ACL. A citizen may not reach an org they do not
  // belong to by putting its id in a query string.
  it("refuses an org the session has no claim for", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "acc-99",
          orgName: "Fremd",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an org scope with no account id", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: null,
          orgName: "Feuerwehr",
        }),
      WorkspaceAuthError,
    );
  });

  it("refuses an org scope with no org name, which would give an unnamed folder", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "acc-7",
          orgName: null,
        }),
      WorkspaceAuthError,
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/context'`.

- [ ] **Step 3: Write `config.ts`**

`apps/web/src/lib/workspace/config.ts`:

```typescript
/**
 * Workspace configuration, read from the environment once.
 *
 * The whole surface is optional: a deployment without these vars simply has no
 * Arbeitsbereich, and the app ships unchanged. That is the same config-gating
 * the workspace tiles already use.
 */
export interface WorkspaceConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  sessionKey: Uint8Array;
  wopiSecret: Uint8Array;
  nextcloudBaseUrl: string;
  nextcloudAdminUser: string;
  nextcloudAdminPassword: string;
  collaboraBaseUrl: string;
  appOrigin: string;
}

const REQUIRED = [
  "ROEBEL_ID_ISSUER",
  "WORKSPACE_CLIENT_ID",
  "WORKSPACE_CLIENT_SECRET",
  "WORKSPACE_SESSION_KEY",
  "WOPI_TOKEN_SECRET",
  "NEXTCLOUD_BASE_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_PASSWORD",
  "COLLABORA_BASE_URL",
  "NEXT_PUBLIC_APP_ORIGIN",
] as const;

export function isWorkspaceEnabled(): boolean {
  return REQUIRED.every((name) => (process.env[name] ?? "").length > 0);
}

export function workspaceConfig(): WorkspaceConfig {
  const missing = REQUIRED.filter((name) => !(process.env[name] ?? "").length);
  if (missing.length) {
    throw new Error(`workspace is not configured: missing ${missing.join(", ")}`);
  }
  return {
    issuer: process.env.ROEBEL_ID_ISSUER!,
    clientId: process.env.WORKSPACE_CLIENT_ID!,
    clientSecret: process.env.WORKSPACE_CLIENT_SECRET!,
    sessionKey: new Uint8Array(Buffer.from(process.env.WORKSPACE_SESSION_KEY!, "base64")),
    wopiSecret: new Uint8Array(Buffer.from(process.env.WOPI_TOKEN_SECRET!, "base64")),
    nextcloudBaseUrl: process.env.NEXTCLOUD_BASE_URL!,
    nextcloudAdminUser: process.env.NEXTCLOUD_ADMIN_USER!,
    nextcloudAdminPassword: process.env.NEXTCLOUD_ADMIN_PASSWORD!,
    collaboraBaseUrl: process.env.COLLABORA_BASE_URL!,
    appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN!,
  };
}
```

- [ ] **Step 4: Write `context.ts`**

`apps/web/src/lib/workspace/context.ts`:

```typescript
import { cookies } from "next/headers";
import {
  bearerAuth,
  createNextcloudClient,
  createProvisioner,
  orgFolderName,
  type NextcloudClient,
  type Provisioner,
  type WorkspaceScope,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "./config";
import { refreshTokens } from "./oidc";
import {
  hasOrgAccess,
  isExpired,
  openSession,
  sealSession,
  type WorkspaceSession,
} from "./session";

export const SESSION_COOKIE = "roebel_ws";

export class WorkspaceAuthError extends Error {
  readonly reason: "no-session" | "expired" | "forbidden";
  constructor(reason: "no-session" | "expired" | "forbidden", message: string) {
    super(message);
    this.name = "WorkspaceAuthError";
    this.reason = reason;
  }
}

/**
 * Turn the request's query parameters into a scope, refusing anything the
 * session's `groups` claim does not authorise. The claim is the ACL — a citizen
 * must not reach another org by editing a query string.
 */
export function resolveScope(params: {
  session: WorkspaceSession;
  scopeKind: string | null;
  accountId: string | null;
  orgName: string | null;
}): WorkspaceScope {
  if (params.scopeKind !== "org") {
    return { kind: "personal", sub: params.session.sub };
  }
  if (!params.accountId) {
    throw new WorkspaceAuthError("forbidden", "an org scope needs an account id");
  }
  if (!params.orgName) {
    throw new WorkspaceAuthError("forbidden", "an org scope needs an org name");
  }
  if (!hasOrgAccess(params.session, params.accountId)) {
    throw new WorkspaceAuthError(
      "forbidden",
      `no group claim for org ${params.accountId}`,
    );
  }
  return {
    kind: "org",
    sub: params.session.sub,
    accountId: params.accountId,
    folderName: orgFolderName(params.orgName),
  };
}

/**
 * Read the session cookie, refreshing the access token when it is close to
 * expiry. Returns null when there is no usable session, which the route
 * handlers turn into a 401 the client answers by starting the OIDC hop.
 */
export async function readSession(): Promise<WorkspaceSession | null> {
  const cfg = workspaceConfig();
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const session = await openSession(raw, cfg.sessionKey);
  if (!session) return null;
  if (!isExpired(session, Date.now())) return session;
  if (!session.refreshToken) return null;

  try {
    const tokens = await refreshTokens({
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      refreshToken: session.refreshToken,
    });
    const refreshed: WorkspaceSession = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    jar.set(SESSION_COOKIE, await sealSession(refreshed, cfg.sessionKey), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    return refreshed;
  } catch {
    // A refusal to refresh means the session is over. Re-authenticating is the
    // correct answer, not an error page.
    return null;
  }
}

/** The session plus everything a handler needs to act on it. */
export interface WorkspaceContext {
  session: WorkspaceSession;
  client: NextcloudClient;
  provisioner: Provisioner;
}

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const session = await readSession();
  if (!session) {
    throw new WorkspaceAuthError("no-session", "not signed in to the workspace");
  }
  const cfg = workspaceConfig();
  return {
    session,
    client: createNextcloudClient({
      baseUrl: cfg.nextcloudBaseUrl,
      auth: bearerAuth(async () => session.accessToken),
    }),
    provisioner: createProvisioner({
      baseUrl: cfg.nextcloudBaseUrl,
      adminUser: cfg.nextcloudAdminUser,
      adminPassword: cfg.nextcloudAdminPassword,
    }),
  };
}
```

- [ ] **Step 5: Add the package as a dependency**

In `apps/web/package.json`, add to `dependencies`:

```json
    "@netizen-labs/workspace": "workspace:*",
```

Then:

```bash
pnpm install
pnpm test:web
```

Expected: PASS. (The test only imports `resolveScope` and `WorkspaceAuthError`, both of which are pure — `next/headers` is never reached.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/workspace/config.ts apps/web/src/lib/workspace/context.ts \
        apps/web/package.json apps/web/tests/workspace-context.test.ts pnpm-lock.yaml
git commit -m "feat(web): one server context for session, scope and client

The groups claim is the ACL, enforced here rather than in each
handler: an org scope is refused unless the session carries a claim
for that org, so a citizen cannot reach another org's folder by
editing a query string.

A refresh that fails ends the session rather than erroring — asking
the citizen to sign in again is the correct answer to an expired
token, not an error page."
```

---

### Task 11: The auth route handlers

**Files:**
- Create: `apps/web/src/app/api/workspace/auth/login/route.ts`
- Create: `apps/web/src/app/api/workspace/auth/callback/route.ts`
- Create: `apps/web/src/app/api/workspace/auth/logout/route.ts`
- Create: `apps/web/src/lib/workspace/claims.ts`
- Test: `apps/web/tests/workspace-claims.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizationUrl`, `createPkcePair`, `exchangeCode` (Task 9); `sealSession` (Task 9); `SESSION_COOKIE`, `workspaceConfig` (Task 10).
- Produces: `function claimsFromIdToken(idToken: string): { sub: string; groups: string[] }`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-claims.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimsFromIdToken } from "../src/lib/workspace/claims";

/** Build an unsigned JWT body — the signature is verified upstream at /token. */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("claimsFromIdToken", () => {
  it("reads the sub and the groups claim", () => {
    const token = idToken({ sub: "0xabc", groups: ["citizen", "org:acc-7:member"] });
    assert.deepEqual(claimsFromIdToken(token), {
      sub: "0xabc",
      groups: ["citizen", "org:acc-7:member"],
    });
  });

  it("treats a missing groups claim as no memberships, not as an error", () => {
    assert.deepEqual(claimsFromIdToken(idToken({ sub: "0xabc" })), {
      sub: "0xabc",
      groups: [],
    });
  });

  it("accepts a space-delimited groups string, which some IdPs emit", () => {
    const token = idToken({ sub: "0xabc", groups: "citizen org:acc-7:member" });
    assert.deepEqual(claimsFromIdToken(token).groups, [
      "citizen",
      "org:acc-7:member",
    ]);
  });

  it("throws on a token with no sub, which must never yield a session", () => {
    assert.throws(() => claimsFromIdToken(idToken({ groups: [] })), /sub/);
  });

  it("throws on a malformed token rather than returning empty claims", () => {
    assert.throws(() => claimsFromIdToken("not-a-jwt"));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/claims'`.

- [ ] **Step 3: Write `claims.ts`**

`apps/web/src/lib/workspace/claims.ts`:

```typescript
/**
 * Read the claims out of an id_token.
 *
 * No signature check here on purpose: this token came straight from the
 * keystone's /token endpoint over TLS, using client authentication, in response
 * to a code we generated. Verifying it again would be theatre. Anything read
 * from a token that did NOT arrive that way must be verified — this function is
 * not for those.
 */
export function claimsFromIdToken(idToken: string): {
  sub: string;
  groups: string[];
} {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("id_token is not a JWT");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("id_token payload is not JSON");
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("id_token has no sub");
  }

  const raw = payload.groups;
  const groups = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(" ").filter(Boolean)
      : [];

  return { sub, groups };
}
```

- [ ] **Step 4: Write the three route handlers**

`apps/web/src/app/api/workspace/auth/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceConfig } from "@/lib/workspace/config";
import { buildAuthorizationUrl, createPkcePair } from "@/lib/workspace/oidc";

export const dynamic = "force-dynamic";

/** Start the OIDC hop. The verifier and the return target ride in short cookies. */
export async function GET(request: Request) {
  const cfg = workspaceConfig();
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/arbeitsbereich";
  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();

  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  jar.set("roebel_ws_verifier", verifier, options);
  jar.set("roebel_ws_state", state, options);
  // Relative paths only: an absolute returnTo would make this an open redirect.
  jar.set("roebel_ws_return", returnTo.startsWith("/") ? returnTo : "/arbeitsbereich", options);

  return NextResponse.redirect(
    buildAuthorizationUrl({
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      redirectUri: `${cfg.appOrigin}/api/workspace/auth/callback`,
      state,
      codeChallenge: challenge,
    }),
  );
}
```

`apps/web/src/app/api/workspace/auth/callback/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { workspaceConfig } from "@/lib/workspace/config";
import { exchangeCode } from "@/lib/workspace/oidc";
import { claimsFromIdToken } from "@/lib/workspace/claims";
import { sealSession } from "@/lib/workspace/session";
import { SESSION_COOKIE } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = workspaceConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const verifier = jar.get("roebel_ws_verifier")?.value;
  const expectedState = jar.get("roebel_ws_state")?.value;
  const returnTo = jar.get("roebel_ws_return")?.value ?? "/arbeitsbereich";

  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.redirect(`${cfg.appOrigin}/arbeitsbereich?fehler=anmeldung`);
  }

  const tokens = await exchangeCode({
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code,
    redirectUri: `${cfg.appOrigin}/api/workspace/auth/callback`,
    codeVerifier: verifier,
  });
  const { sub, groups } = claimsFromIdToken(tokens.id_token);

  const sealed = await sealSession(
    {
      sub,
      groups,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    },
    cfg.sessionKey,
  );

  const response = NextResponse.redirect(`${cfg.appOrigin}${returnTo}`);
  response.cookies.set(SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  for (const name of ["roebel_ws_verifier", "roebel_ws_state", "roebel_ws_return"]) {
    response.cookies.delete(name);
  }
  return response;
}
```

`apps/web/src/app/api/workspace/auth/logout/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
```

- [ ] **Step 5: Run the tests and the build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: tests PASS; the build compiles the three new routes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/workspace/claims.ts \
        apps/web/src/app/api/workspace/auth/login/route.ts \
        apps/web/src/app/api/workspace/auth/callback/route.ts \
        apps/web/src/app/api/workspace/auth/logout/route.ts \
        apps/web/tests/workspace-claims.test.ts
git commit -m "feat(web): the OIDC hop, once, then silent

Authorization code with PKCE and a state check; returnTo is forced to
a relative path so the callback can never become an open redirect.

The id_token's signature is deliberately not re-checked: it arrived
from the keystone's token endpoint over TLS, under client
authentication, answering a code we generated. The comment says so, so
nobody copies the shortcut somewhere it would be wrong."
```

---

### Task 12: The files API

Thin handlers over Task 10's context. The one piece of logic that deserves its own test is the request parser, which turns query parameters into a scope request.

**Files:**
- Create: `apps/web/src/lib/workspace/request.ts`
- Create: `apps/web/src/lib/workspace/provenance-sink.ts`
- Create: `apps/web/src/app/api/workspace/files/route.ts`
- Create: `apps/web/src/app/api/workspace/files/folder/route.ts`
- Create: `apps/web/src/app/api/workspace/files/upload/route.ts`
- Create: `apps/web/src/app/api/workspace/files/download/route.ts`
- Create: `supabase/migrations/20260728_workspace_actions.sql`
- Test: `apps/web/tests/workspace-request.test.ts`

**Interfaces:**
- Consumes: `requireWorkspace`, `resolveScope`, `WorkspaceAuthError` (Task 10); `buildAction`, `createRecorder` (Task 6).
- Produces:
  - `function parseScopeRequest(url: URL): { scopeKind: string | null; accountId: string | null; orgName: string | null; path: string }`
  - `function errorResponse(error: unknown): Response`
  - `function recordWorkspaceAction(action: WorkspaceAction): Promise<void>`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-request.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorResponse, parseScopeRequest } from "../src/lib/workspace/request";
import { WorkspaceAuthError } from "../src/lib/workspace/context";
import { ScopeViolationError } from "@netizen-labs/workspace";

describe("parseScopeRequest", () => {
  it("defaults to a personal scope at the root", () => {
    assert.deepEqual(
      parseScopeRequest(new URL("https://roebel.app/api/workspace/files")),
      { scopeKind: null, accountId: null, orgName: null, path: "" },
    );
  });

  it("reads an org scope from the query", () => {
    assert.deepEqual(
      parseScopeRequest(
        new URL(
          "https://roebel.app/api/workspace/files?scope=org&accountId=acc-7&orgName=Feuerwehr&path=Protokolle",
        ),
      ),
      {
        scopeKind: "org",
        accountId: "acc-7",
        orgName: "Feuerwehr",
        path: "Protokolle",
      },
    );
  });

  it("keeps a path with spaces and umlauts intact after url decoding", () => {
    const parsed = parseScopeRequest(
      new URL(
        "https://roebel.app/api/workspace/files?path=Meine%20Akten/Pr%C3%BCfbericht.odt",
      ),
    );
    assert.equal(parsed.path, "Meine Akten/Prüfbericht.odt");
  });
});

describe("errorResponse", () => {
  it("maps a missing session to 401, which the client answers with the OIDC hop", async () => {
    const res = errorResponse(new WorkspaceAuthError("no-session", "nope"));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, "no-session");
  });

  it("maps a forbidden org to 403", () => {
    assert.equal(errorResponse(new WorkspaceAuthError("forbidden", "nope")).status, 403);
  });

  // A traversal attempt is a client error, and the reply must not describe the
  // filesystem it failed to reach.
  it("maps a scope violation to 400 with no path detail", async () => {
    const res = errorResponse(new ScopeViolationError("path traverses above the scope root"));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "ungueltiger Pfad");
  });

  it("maps anything else to 500 without leaking the message", async () => {
    const res = errorResponse(new Error("postgres://user:pw@host down"));
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(await res.json()), /postgres/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/request'`.

- [ ] **Step 3: Write `request.ts`**

`apps/web/src/lib/workspace/request.ts`:

```typescript
import { NextResponse } from "next/server";
import { ScopeViolationError } from "@netizen-labs/workspace";
import { WorkspaceAuthError } from "./context";

/** Query parameters -> the arguments resolveScope expects. */
export function parseScopeRequest(url: URL): {
  scopeKind: string | null;
  accountId: string | null;
  orgName: string | null;
  path: string;
} {
  const q = url.searchParams;
  return {
    scopeKind: q.get("scope"),
    accountId: q.get("accountId"),
    orgName: q.get("orgName"),
    path: q.get("path") ?? "",
  };
}

/**
 * Map a thrown error to a response.
 *
 * 401 is the signal the client uses to start the OIDC hop, so it must be
 * distinguishable from 403. Nothing below those two describes what failed:
 * a traversal attempt gets a flat "invalid path", and an unexpected error gets
 * no message at all — an internal error message is an information leak.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof WorkspaceAuthError) {
    const status = error.reason === "forbidden" ? 403 : 401;
    return NextResponse.json({ reason: error.reason }, { status });
  }
  if (error instanceof ScopeViolationError) {
    return NextResponse.json({ error: "ungueltiger Pfad" }, { status: 400 });
  }
  console.error("[workspace] unexpected error:", error);
  return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
}
```

- [ ] **Step 4: Write the provenance sink and its migration**

`supabase/migrations/20260728_workspace_actions.sql`:

```sql
-- Provenance for every mutating workspace operation. Metadata only: slice 2
-- mirrors these rows to Nostr, where reads are open and deletion is advisory,
-- so document content must be structurally unable to reach this table.
create table if not exists public.workspace_actions (
  id           bigserial primary key,
  actor_kind   text        not null check (actor_kind in ('human', 'agent')),
  actor_sub    text        not null,
  acting_for   text,
  kind         text        not null,
  scope_kind   text        not null check (scope_kind in ('personal', 'org')),
  account_id   text,
  path         text        not null,
  at           timestamptz not null default now()
);

create index if not exists workspace_actions_actor_idx on public.workspace_actions (actor_sub, at desc);
create index if not exists workspace_actions_account_idx on public.workspace_actions (account_id, at desc);

-- An audit trail nobody may edit from the client. Writes come from the server
-- with the service role; RLS on with no policies denies the anon key entirely.
alter table public.workspace_actions enable row level security;
```

Apply it with the Supabase MCP (the CLI is deliberately not installed in this repo).

`apps/web/src/lib/workspace/provenance-sink.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import { createRecorder, type ProvenanceSink, type WorkspaceAction } from "@netizen-labs/workspace";

/**
 * Slice 1's only sink. Slice 2 adds a Nostr sink beside it — the call site does
 * not change, which is the point of routing every mutation through here.
 */
const postgresSink: ProvenanceSink = {
  name: "postgres",
  async record(action: WorkspaceAction) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await client.from("workspace_actions").insert({
      actor_kind: action.actor.kind,
      actor_sub: action.actor.sub,
      acting_for: action.actor.kind === "agent" ? action.actor.actingFor : null,
      kind: action.kind,
      scope_kind: action.scopeKind,
      account_id: action.accountId,
      path: action.path,
      at: action.at,
    });
    if (error) throw new Error(error.message);
  },
};

export const recordWorkspaceAction = createRecorder([postgresSink]);
```

- [ ] **Step 5: Write the four route handlers**

`apps/web/src/app/api/workspace/files/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildAction } from "@netizen-labs/workspace";
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    return NextResponse.json({ entries: await client.listDirectory(scope, parsed.path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    await client.remove(scope, parsed.path);
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "delete",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
```

`apps/web/src/app/api/workspace/files/folder/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildAction } from "@netizen-labs/workspace";
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    await client.createFolder(scope, parsed.path);
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "create-folder",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
```

`apps/web/src/app/api/workspace/files/upload/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildAction } from "@netizen-labs/workspace";
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    await client.upload(scope, parsed.path, await request.arrayBuffer());
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "upload",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
```

`apps/web/src/app/api/workspace/files/download/route.ts`:

```typescript
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    const body = await client.download(scope, parsed.path);
    const name = parsed.path.split("/").pop() ?? "download";
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        // The filename is quoted and stripped of quotes so a crafted name
        // cannot inject extra header directives.
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 6: Run tests and build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: PASS; build compiles.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workspace/request.ts \
        apps/web/src/lib/workspace/provenance-sink.ts \
        apps/web/src/app/api/workspace/files/route.ts \
        apps/web/src/app/api/workspace/files/folder/route.ts \
        apps/web/src/app/api/workspace/files/upload/route.ts \
        apps/web/src/app/api/workspace/files/download/route.ts \
        supabase/migrations/20260728_workspace_actions.sql \
        apps/web/tests/workspace-request.test.ts
git commit -m "feat(web): the files API, proxied so tokens stay server-side

Handlers are thin over the shared context; the logic worth testing is
the error mapping. 401 stays distinguishable from 403 because the
client uses it to start the OIDC hop, and nothing below those leaks
what failed — a traversal gets a flat 'invalid path', an unexpected
error gets no message at all.

Every mutation goes through recordWorkspaceAction, so slice 2 adds a
Nostr sink rather than reconstructing an audit trail."
```

---

### Task 13: The WOPI endpoints and the editor session

**Files:**
- Create: `apps/web/src/lib/workspace/editor.ts`
- Create: `apps/web/src/app/api/workspace/wopi/files/[fileId]/route.ts`
- Create: `apps/web/src/app/api/workspace/wopi/files/[fileId]/contents/route.ts`
- Create: `apps/web/src/app/api/workspace/editor/route.ts`
- Test: `apps/web/tests/workspace-editor.test.ts`

**Interfaces:**
- Consumes: `parseDiscovery`, `buildEditorUrl`, `mintWopiToken`, `verifyWopiToken`, `encodeFileId`, `decodeFileId`, `checkFileInfo` (Task 7); `requireWorkspace`, `resolveScope` (Task 10).
- Produces:
  - `function extensionOf(path: string): string`
  - `function isEditable(path: string, discovery: Map<string, string>): boolean`
  - `async function loadDiscovery(collaboraBaseUrl: string, fetchImpl?: typeof globalThis.fetch): Promise<Map<string, string>>`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-editor.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extensionOf, isEditable, loadDiscovery } from "../src/lib/workspace/editor";

const DISCOVERY = `<?xml version="1.0"?>
<wopi-discovery><net-zone name="external-http">
  <app name="writer"><action name="edit" ext="odt" urlsrc="https://office.example/browser/a/cool.html?"/></app>
</net-zone></wopi-discovery>`;

describe("extensionOf", () => {
  it("lowercases the extension, so ODT and odt are one entry", () => {
    assert.equal(extensionOf("Dokumente/Antrag.ODT"), "odt");
  });

  it("returns an empty string for a file with no extension", () => {
    assert.equal(extensionOf("Dokumente/LIESMICH"), "");
  });

  it("is not fooled by a dot in a folder name", () => {
    assert.equal(extensionOf("v1.2/Bericht"), "");
  });
});

describe("isEditable", () => {
  it("is true for an extension the discovery document offers", () => {
    assert.equal(isEditable("a.odt", new Map([["odt", "url"]])), true);
  });

  it("is false for anything else, so we never open an editor that cannot render", () => {
    assert.equal(isEditable("a.zip", new Map([["odt", "url"]])), false);
  });
});

describe("loadDiscovery", () => {
  it("fetches and parses the hosting discovery document", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      calls.push(String(input));
      return new Response(DISCOVERY);
    }) as unknown as typeof globalThis.fetch;

    const map = await loadDiscovery("https://office.example/", fetchImpl);
    assert.equal(calls[0], "https://office.example/hosting/discovery");
    assert.equal(map.get("odt"), "https://office.example/browser/a/cool.html?");
  });

  it("returns an empty map when Collabora is unreachable, so the file list still renders", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    assert.equal((await loadDiscovery("https://office.example", fetchImpl)).size, 0);
  });

  it("returns an empty map on a non-200, rather than parsing an error page", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 502 })) as unknown as typeof globalThis.fetch;
    assert.equal((await loadDiscovery("https://office.example", fetchImpl)).size, 0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/editor'`.

- [ ] **Step 3: Write `editor.ts`**

`apps/web/src/lib/workspace/editor.ts`:

```typescript
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
```

- [ ] **Step 4: Write the editor session route**

`apps/web/src/app/api/workspace/editor/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildEditorUrl, encodeFileId, mintWopiToken } from "@netizen-labs/workspace";
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { workspaceConfig } from "@/lib/workspace/config";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { extensionOf, loadDiscovery } from "@/lib/workspace/editor";

export const dynamic = "force-dynamic";

/** Ten minutes is long enough to open a document and short enough to matter if leaked. */
const WOPI_TTL_SECONDS = 600;

/**
 * Mint an editing session: returns the iframe url plus the token the client
 * POSTs into the frame. The token is never put in the url — see wopi.ts.
 */
export async function GET(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const cfg = workspaceConfig();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });

    const discovery = await loadDiscovery(cfg.collaboraBaseUrl);
    const urlsrc = discovery.get(extensionOf(parsed.path));
    if (!urlsrc) {
      return NextResponse.json(
        { error: "Dieses Format kann nicht im Browser bearbeitet werden." },
        { status: 415 },
      );
    }

    // stat before minting: a token for a path that does not exist would send
    // Collabora into a retry loop against a 404.
    await client.stat(scope, parsed.path);

    const fileId = encodeFileId(scope, parsed.path);
    const token = await mintWopiToken(
      { sub: session.sub, scope, path: parsed.path, canWrite: true },
      cfg.wopiSecret,
      WOPI_TTL_SECONDS,
    );

    return NextResponse.json({
      url: buildEditorUrl({
        urlsrc,
        wopiSrc: `${cfg.appOrigin}/api/workspace/wopi/files/${fileId}`,
        lang: "de-DE",
      }),
      token,
      ttlSeconds: WOPI_TTL_SECONDS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 5: Write the two WOPI endpoints**

`apps/web/src/app/api/workspace/wopi/files/[fileId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  bearerAuth,
  checkFileInfo,
  createNextcloudClient,
  decodeFileId,
  verifyWopiToken,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "@/lib/workspace/config";
import { readSession } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/**
 * CheckFileInfo. Collabora calls this itself, with only the WOPI token — there
 * is no browser session on this request, so the token is the sole authority and
 * must be verified here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const cfg = workspaceConfig();
  const token = new URL(request.url).searchParams.get("access_token");
  if (!token) return NextResponse.json({}, { status: 401 });

  let claims;
  try {
    claims = await verifyWopiToken(token, cfg.wopiSecret);
  } catch {
    return NextResponse.json({}, { status: 401 });
  }

  const { fileId } = await params;
  const { path } = decodeFileId(fileId);
  // The token is bound to one path; a mismatch means the file id was swapped.
  if (path !== claims.path) return NextResponse.json({}, { status: 403 });

  const session = await readSession();
  const client = createNextcloudClient({
    baseUrl: cfg.nextcloudBaseUrl,
    auth: bearerAuth(async () => session?.accessToken ?? ""),
  });
  const entry = await client.stat(claims.scope, claims.path);

  // Never a raw 0x in what Collabora renders as the collaborator's name.
  const friendly = "Bürger:in";
  return NextResponse.json(checkFileInfo(entry, claims, friendly));
}
```

`apps/web/src/app/api/workspace/wopi/files/[fileId]/contents/route.ts`:

```typescript
import { NextResponse } from "next/server";
import {
  bearerAuth,
  buildAction,
  createNextcloudClient,
  decodeFileId,
  verifyWopiToken,
  type WopiClaims,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "@/lib/workspace/config";
import { readSession } from "@/lib/workspace/context";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

async function authorise(
  request: Request,
  fileId: string,
): Promise<WopiClaims | null> {
  const cfg = workspaceConfig();
  const token = new URL(request.url).searchParams.get("access_token");
  if (!token) return null;
  try {
    const claims = await verifyWopiToken(token, cfg.wopiSecret);
    return decodeFileId(fileId).path === claims.path ? claims : null;
  } catch {
    return null;
  }
}

async function nextcloud() {
  const cfg = workspaceConfig();
  const session = await readSession();
  return createNextcloudClient({
    baseUrl: cfg.nextcloudBaseUrl,
    auth: bearerAuth(async () => session?.accessToken ?? ""),
  });
}

/** GetFile — Collabora loading the document. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const claims = await authorise(request, (await params).fileId);
  if (!claims) return NextResponse.json({}, { status: 401 });
  const body = await (await nextcloud()).download(claims.scope, claims.path);
  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream" },
  });
}

/** PutFile — Collabora saving the document. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const claims = await authorise(request, (await params).fileId);
  if (!claims) return NextResponse.json({}, { status: 401 });
  if (!claims.canWrite) return NextResponse.json({}, { status: 403 });

  await (await nextcloud()).upload(claims.scope, claims.path, await request.arrayBuffer());
  await recordWorkspaceAction(
    buildAction({
      actor: { kind: "human", sub: claims.sub },
      kind: "update",
      scope: claims.scope,
      path: claims.path,
    }),
  );
  return NextResponse.json({});
}
```

- [ ] **Step 6: Run tests and build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: PASS; build compiles.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/workspace/editor.ts \
        "apps/web/src/app/api/workspace/wopi/files/[fileId]/route.ts" \
        "apps/web/src/app/api/workspace/wopi/files/[fileId]/contents/route.ts" \
        apps/web/src/app/api/workspace/editor/route.ts \
        apps/web/tests/workspace-editor.test.ts
git commit -m "feat(web): WOPI endpoints, so Collabora edits our files in our page

Collabora calls these itself with no browser session, so the WOPI
token is the sole authority and is verified on every hit — and checked
against the file id, so swapping the id cannot redirect a session at
another document.

Discovery failures yield an empty map instead of throwing: the file
list must still render when the editor is down, and the honest symptom
is 'this file cannot be opened'."
```

---

### Task 14: The Arbeitsbereich shell

Citizens get the layout orgs already have. The nav model is a pure module so it is testable without React.

**Files:**
- Create: `apps/web/src/lib/workspace/nav.ts`
- Create: `apps/web/src/components/workspace/WorkspaceSidebar.tsx`
- Create: `apps/web/src/app/arbeitsbereich/layout.tsx`
- Create: `apps/web/src/app/arbeitsbereich/page.tsx`
- Modify: `apps/web/src/app/app/dashboard/page.tsx` (replace the whole file with a redirect)
- Modify: `apps/web/src/components/app/AppSidebar.tsx:52`
- Modify: `apps/web/src/components/app/AppRightPanel.tsx:192`
- Test: `apps/web/tests/workspace-nav.test.ts`

**Interfaces:**
- Consumes: `sessionMatchesWallet` (Task 9); `SESSION_COOKIE` (Task 10).
- Produces:
  - `interface WorkspaceNavItem { id: string; label: string; href: string; native: boolean }`
  - `function workspaceNav(): WorkspaceNavItem[]`
  - `GET /api/workspace/auth/session` → `{ sub: string } | { sub: null }`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-nav.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceNav } from "../src/lib/workspace/nav";

describe("workspaceNav", () => {
  it("opens with Übersicht, then the native Dateien surface", () => {
    const nav = workspaceNav();
    assert.deepEqual(
      nav.slice(0, 2).map((i) => i.id),
      ["uebersicht", "dateien"],
    );
  });

  it("routes every entry inside /arbeitsbereich", () => {
    for (const item of workspaceNav()) {
      assert.match(item.href, /^\/arbeitsbereich/);
    }
  });

  it("labels are German", () => {
    const labels = workspaceNav().map((i) => i.label);
    assert.deepEqual(labels, ["Übersicht", "Dateien & Dokumente"]);
  });

  // Slice 1 ships exactly two entries. Chat, wiki, projects and the KI
  // workspace stay link-out tiles on the Übersicht until their slice lands, so
  // the nav never advertises a surface that does not exist.
  it("ships only what is built", () => {
    assert.equal(workspaceNav().length, 2);
    assert.ok(workspaceNav().every((i) => i.native));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/nav'`.

- [ ] **Step 3: Write `nav.ts`**

`apps/web/src/lib/workspace/nav.ts`:

```typescript
/**
 * The Arbeitsbereich's own navigation — the citizen equivalent of the org
 * sidebar. Only surfaces that are actually native appear here; everything still
 * served by a link-out tile stays on the Übersicht, so the nav never advertises
 * something that is not built.
 *
 * Pure and React-free so it is unit-testable; the UI maps `icon` to a lucide
 * component.
 */
export interface WorkspaceNavItem {
  id: string;
  label: string;
  href: string;
  /** True when the surface is rendered by us rather than linked out to. */
  native: boolean;
}

export function workspaceNav(): WorkspaceNavItem[] {
  return [
    { id: "uebersicht", label: "Übersicht", href: "/arbeitsbereich", native: true },
    {
      id: "dateien",
      label: "Dateien & Dokumente",
      href: "/arbeitsbereich/dateien",
      native: true,
    },
  ];
}
```

- [ ] **Step 4: Write the sidebar and the layout**

`apps/web/src/components/workspace/WorkspaceSidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen } from "lucide-react";
import { workspaceNav } from "@/lib/workspace/nav";

const ICONS: Record<string, typeof LayoutDashboard> = {
  uebersicht: LayoutDashboard,
  dateien: FolderOpen,
};

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return (
    <nav className="hidden md:block w-60 shrink-0 border-r border-border p-4 space-y-1">
      {workspaceNav().map((item) => {
        const Icon = ICONS[item.id] ?? LayoutDashboard;
        const active =
          item.href === "/arbeitsbereich"
            ? pathname === item.href
            : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`apps/web/src/app/arbeitsbereich/layout.tsx` — structurally the org shell in `app/dashboard/layout.tsx`, with the workspace sidebar:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { AuthGuard } from "@/components/app/AuthGuard";
import { AccountProvider } from "@/lib/context/AccountContext";
import { AppModeProvider } from "@/lib/context/AppModeContext";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";

export default function ArbeitsbereichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppModeProvider>
        <AccountProvider>
          <div className="min-h-screen bg-background flex flex-col">
            <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
              <Link href="/app" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Image
                  src="/Logo-new.png"
                  alt="Röbel App"
                  width={105}
                  height={24}
                  className="h-6 w-auto object-contain"
                />
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  · Arbeitsbereich
                </span>
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Zur App
              </Link>
            </header>
            <div className="flex-1 md:flex md:items-stretch">
              <WorkspaceSidebar />
              <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-6xl w-full">
                {children}
              </main>
            </div>
          </div>
        </AccountProvider>
      </AppModeProvider>
    </AuthGuard>
  );
}
```

- [ ] **Step 5: Move the dashboard body into the Übersicht**

Create `apps/web/src/app/arbeitsbereich/page.tsx` with the **entire current contents** of `apps/web/src/app/app/dashboard/page.tsx`, with three edits:

1. Rename the component `CitizenDashboardPage` → `ArbeitsbereichPage`.
2. Change the heading from `Dashboard` to `Arbeitsbereich`, and the citizen-gate copy's link target from `/app/verifizierung` (unchanged) — keep the gate text as-is, it already reads correctly for a workspace.
3. Leave `<WorkspaceTilesCard />` in place: it is the honest display of which surfaces are still link-outs, and Task 16 removes only its Nextcloud entry.

Then replace `apps/web/src/app/app/dashboard/page.tsx` entirely with:

```tsx
import { redirect } from "next/navigation";

/**
 * The citizen dashboard moved into its own shell at /arbeitsbereich, so
 * citizens get the layout orgs already had. Kept as a redirect because the old
 * path is linked from the app sidebar, the right panel, and any bookmark a
 * citizen already made.
 */
export default function LegacyCitizenDashboard() {
  redirect("/arbeitsbereich");
}
```

- [ ] **Step 6: Retarget the two entry points**

In `apps/web/src/components/app/AppSidebar.tsx` line 52, change the href and label:

```tsx
  { href: "/arbeitsbereich", label: "Arbeitsbereich", icon: LayoutDashboard, modes: ["citizen"] },
```

In `apps/web/src/components/app/AppRightPanel.tsx`, change the citizen CTA (line 186 heading and line 192 href):

```tsx
            <h3 className="font-semibold text-sm text-foreground">Arbeitsbereich</h3>
```
```tsx
            href="/arbeitsbereich"
```

and the CTA label on line 195 from `Dashboard öffnen` to `Arbeitsbereich öffnen`.

- [ ] **Step 7: Wire the wallet binding**

Task 9 defined `sessionMatchesWallet` but nothing calls it yet. Without this the session survives a wallet switch, and the previous citizen's files stay on screen.

Create `apps/web/src/app/api/workspace/auth/session/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readSession } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/** Who the workspace session belongs to. Never returns token material. */
export async function GET() {
  const session = await readSession();
  return NextResponse.json({ sub: session?.sub ?? null });
}
```

Create `apps/web/src/components/workspace/WorkspaceSessionGuard.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { sessionMatchesWallet } from "@/lib/workspace/session";

/**
 * The workspace session is keyed to `sub`. If the connected wallet stops
 * matching it, the session is discarded and re-established — otherwise
 * switching wallets in the app would leave the previous citizen's files on
 * screen, which is an identity bug rather than a caching one.
 */
export function WorkspaceSessionGuard() {
  const account = useActiveAccount();

  useEffect(() => {
    const wallet = account?.address;
    if (!wallet) return;
    let cancelled = false;

    void (async () => {
      const res = await fetch("/api/workspace/auth/session");
      if (!res.ok || cancelled) return;
      const { sub } = (await res.json()) as { sub: string | null };
      if (!sub || cancelled) return;
      // Only the sub is compared here; the helper is shared with the server so
      // the two can never disagree about what "matches" means.
      if (sessionMatchesWallet({ sub, groups: [], accessToken: "", refreshToken: null, expiresAt: 0 }, wallet)) {
        return;
      }
      await fetch("/api/workspace/auth/logout", { method: "POST" });
      window.location.href = `/api/workspace/auth/login?returnTo=${encodeURIComponent(
        window.location.pathname,
      )}`;
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  return null;
}
```

Mount it in `apps/web/src/app/arbeitsbereich/layout.tsx`, immediately inside `<AccountProvider>`:

```tsx
          <WorkspaceSessionGuard />
```

- [ ] **Step 8: Run tests and build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: PASS; build compiles both the new route group and the redirect.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/workspace/nav.ts \
        apps/web/src/components/workspace/WorkspaceSidebar.tsx \
        apps/web/src/components/workspace/WorkspaceSessionGuard.tsx \
        apps/web/src/app/api/workspace/auth/session/route.ts \
        apps/web/src/app/arbeitsbereich/layout.tsx \
        apps/web/src/app/arbeitsbereich/page.tsx \
        apps/web/src/app/app/dashboard/page.tsx \
        apps/web/src/components/app/AppSidebar.tsx \
        apps/web/src/components/app/AppRightPanel.tsx \
        apps/web/tests/workspace-nav.test.ts
git commit -m "feat(web): citizens get the shell orgs already had

Own layout, own sidebar, own working area at /arbeitsbereich, instead
of one page nested in the social app. The old /app/dashboard becomes a
redirect — it is linked from the sidebar, the right panel and whatever
citizens have bookmarked.

The nav lists only native surfaces; everything still served by a
link-out tile stays on the Übersicht, so it never advertises a
workspace that does not exist yet."
```

---

### Task 15: The Dateien & Dokumente surface

**Files:**
- Create: `apps/web/src/lib/workspace/client-api.ts`
- Create: `apps/web/src/components/workspace/FileBrowser.tsx`
- Create: `apps/web/src/components/workspace/DocumentEditor.tsx`
- Create: `apps/web/src/app/arbeitsbereich/dateien/page.tsx`
- Test: `apps/web/tests/workspace-client-api.test.ts`

**Interfaces:**
- Consumes: the routes from Tasks 12 and 13.
- Produces:
  - `interface FileScopeParams { scope: "personal" | "org"; accountId?: string; orgName?: string }`
  - `function buildFilesQuery(p: FileScopeParams & { path: string }): string`
  - `function breadcrumbs(path: string): Array<{ label: string; path: string }>`
  - `function parentPath(path: string): string`
  - `function formatSize(bytes: number): string`

- [ ] **Step 1: Write the failing test**

`apps/web/tests/workspace-client-api.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breadcrumbs,
  buildFilesQuery,
  formatSize,
  parentPath,
} from "../src/lib/workspace/client-api";

describe("buildFilesQuery", () => {
  it("omits org parameters for a personal scope", () => {
    assert.equal(buildFilesQuery({ scope: "personal", path: "Dokumente" }), "path=Dokumente");
  });

  it("carries the org identity for an org scope", () => {
    const q = new URLSearchParams(
      buildFilesQuery({
        scope: "org",
        accountId: "acc-7",
        orgName: "Feuerwehr",
        path: "Protokolle",
      }),
    );
    assert.equal(q.get("scope"), "org");
    assert.equal(q.get("accountId"), "acc-7");
    assert.equal(q.get("orgName"), "Feuerwehr");
    assert.equal(q.get("path"), "Protokolle");
  });

  it("encodes a path with spaces and a hash", () => {
    const q = new URLSearchParams(
      buildFilesQuery({ scope: "personal", path: "Meine Akten/Bericht #1.odt" }),
    );
    assert.equal(q.get("path"), "Meine Akten/Bericht #1.odt");
  });
});

describe("breadcrumbs", () => {
  it("starts at the workspace root", () => {
    assert.deepEqual(breadcrumbs(""), [{ label: "Arbeitsbereich", path: "" }]);
  });

  it("accumulates each segment's own path", () => {
    assert.deepEqual(breadcrumbs("Dokumente/2026/Q3"), [
      { label: "Arbeitsbereich", path: "" },
      { label: "Dokumente", path: "Dokumente" },
      { label: "2026", path: "Dokumente/2026" },
      { label: "Q3", path: "Dokumente/2026/Q3" },
    ]);
  });
});

describe("parentPath", () => {
  it("drops the last segment", () => {
    assert.equal(parentPath("Dokumente/2026/Q3"), "Dokumente/2026");
  });

  it("returns the root from a first-level folder", () => {
    assert.equal(parentPath("Dokumente"), "");
  });

  it("stays at the root", () => {
    assert.equal(parentPath(""), "");
  });
});

describe("formatSize", () => {
  it("uses German decimal separators", () => {
    assert.equal(formatSize(1536), "1,5 KB");
    assert.equal(formatSize(5_242_880), "5,0 MB");
  });

  it("shows bytes without a decimal", () => {
    assert.equal(formatSize(512), "512 B");
  });

  it("shows an em dash for a directory's zero size", () => {
    assert.equal(formatSize(0), "—");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm test:web
```

Expected: FAIL — `Cannot find module '../src/lib/workspace/client-api'`.

- [ ] **Step 3: Write `client-api.ts`**

`apps/web/src/lib/workspace/client-api.ts`:

```typescript
/**
 * Browser-side helpers for the Dateien surface. Pure so they are unit-tested
 * without React; the components below only compose them.
 */

export interface FileScopeParams {
  scope: "personal" | "org";
  accountId?: string;
  orgName?: string;
}

export function buildFilesQuery(
  params: FileScopeParams & { path: string },
): string {
  const q = new URLSearchParams();
  if (params.scope === "org") {
    q.set("scope", "org");
    if (params.accountId) q.set("accountId", params.accountId);
    if (params.orgName) q.set("orgName", params.orgName);
  }
  q.set("path", params.path);
  return q.toString();
}

export function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "Arbeitsbereich", path: "" }];
  let accumulated = "";
  for (const segment of path.split("/").filter(Boolean)) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** German formatting: comma decimals, em dash for a directory. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${UNITS[unit]}`;
}
```

- [ ] **Step 4: Write `DocumentEditor.tsx`**

The token is POSTed into the iframe, never placed in its `src`.

```tsx
"use client";

import { useEffect, useRef } from "react";

/**
 * Collabora in an iframe, which is what Collabora is designed for — so there is
 * no framing header to defeat and no Nextcloud chrome to hide.
 *
 * The access token is submitted as a form POST into the frame rather than being
 * put in the url: a token in a src would land in browser history, in the
 * Referer header, and in every access log between here and the editor.
 */
export function DocumentEditor({
  url,
  token,
  onClose,
}: {
  url: string;
  token: string;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.submit();
  }, [url, token]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="h-12 border-b border-border flex items-center justify-end px-4">
        <button
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Schließen
        </button>
      </div>
      <form
        ref={formRef}
        action={url}
        method="post"
        target="collabora-frame"
        className="hidden"
      >
        <input type="hidden" name="access_token" value={token} />
      </form>
      <iframe
        name="collabora-frame"
        title="Dokument bearbeiten"
        className="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
```

- [ ] **Step 5: Write `FileBrowser.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { File, Folder, FolderPlus, RefreshCw, Upload } from "lucide-react";
import type { DirEntry } from "@netizen-labs/workspace";
import {
  breadcrumbs,
  buildFilesQuery,
  formatSize,
  parentPath,
  type FileScopeParams,
} from "@/lib/workspace/client-api";
import { DocumentEditor } from "./DocumentEditor";

/**
 * The native file list. Identical component for both scopes — personal is the
 * citizen's own Nextcloud home, org is the group folder the `groups` claim
 * grants. The server decides which; this only passes the scope along.
 */
export function FileBrowser({ scope }: { scope: FileScopeParams }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ url: string; token: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/workspace/files?${buildFilesQuery({ ...scope, path })}`);
    if (res.status === 401) {
      // The one visible hop: not signed in to the workspace yet.
      window.location.href = `/api/workspace/auth/login?returnTo=${encodeURIComponent(
        window.location.pathname,
      )}`;
      return;
    }
    if (!res.ok) {
      setError("Die Dateien konnten nicht geladen werden.");
      setLoading(false);
      return;
    }
    setEntries((await res.json()).entries as DirEntry[]);
    setLoading(false);
  }, [scope, path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(entry: DirEntry) {
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    const res = await fetch(
      `/api/workspace/editor?${buildFilesQuery({ ...scope, path: entry.path })}`,
    );
    if (res.status === 415) {
      window.location.href = `/api/workspace/files/download?${buildFilesQuery({
        ...scope,
        path: entry.path,
      })}`;
      return;
    }
    if (!res.ok) {
      setError("Das Dokument konnte nicht geöffnet werden.");
      return;
    }
    const session = await res.json();
    setEditor({ url: session.url, token: session.token });
  }

  async function upload(file: File) {
    const target = path ? `${path}/${file.name}` : file.name;
    await fetch(`/api/workspace/files/upload?${buildFilesQuery({ ...scope, path: target })}`, {
      method: "PUT",
      body: await file.arrayBuffer(),
    });
    await load();
  }

  async function createFolder() {
    const name = window.prompt("Name des neuen Ordners");
    if (!name) return;
    const target = path ? `${path}/${name}` : name;
    await fetch(`/api/workspace/files/folder?${buildFilesQuery({ ...scope, path: target })}`, {
      method: "POST",
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs(path).map((crumb, index, all) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <button
                onClick={() => setPath(crumb.path)}
                className={
                  index === all.length - 1
                    ? "text-foreground font-medium"
                    : "hover:text-foreground"
                }
              >
                {crumb.label}
              </button>
              {index < all.length - 1 && <span>/</span>}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={createFolder}
            className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-accent"
          >
            <FolderPlus className="h-4 w-4" /> Ordner
          </button>
          <label className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-accent cursor-pointer">
            <Upload className="h-4 w-4" /> Hochladen
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          <button
            onClick={() => void load()}
            aria-label="Aktualisieren"
            className="border border-border rounded-lg p-1.5 hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive border border-destructive/30 rounded-lg p-3">
          {error}
        </p>
      )}

      <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-muted/40" />
          ))}

        {!loading && path !== "" && (
          <button
            onClick={() => setPath(parentPath(path))}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">… eine Ebene höher</span>
          </button>
        )}

        {!loading && entries.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Dieser Ordner ist leer.
          </p>
        )}

        {!loading &&
          entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => void open(entry)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
            >
              {entry.isDirectory ? (
                <Folder className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <File className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="flex-1 truncate text-foreground">{entry.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatSize(entry.size)}
              </span>
            </button>
          ))}
      </div>

      {editor && (
        <DocumentEditor
          url={editor.url}
          token={editor.token}
          onClose={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write the page**

`apps/web/src/app/arbeitsbereich/dateien/page.tsx`:

```tsx
"use client";

import { FolderOpen } from "lucide-react";
import { FileBrowser } from "@/components/workspace/FileBrowser";

export default function DateienPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" />
          Dateien & Dokumente
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deine Dateien liegen auf dem Server der Gemeinschaft. Dokumente
          öffnest und bearbeitest du direkt hier.
        </p>
      </div>
      <FileBrowser scope={{ scope: "personal" }} />
    </div>
  );
}
```

- [ ] **Step 7: Run tests and build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: PASS; build compiles.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/workspace/client-api.ts \
        apps/web/src/components/workspace/FileBrowser.tsx \
        apps/web/src/components/workspace/DocumentEditor.tsx \
        apps/web/src/app/arbeitsbereich/dateien/page.tsx \
        apps/web/tests/workspace-client-api.test.ts
git commit -m "feat(web): the native file list, and documents that open in place

One FileBrowser for both scopes — the server decides what a scope may
reach, the component only passes it along.

A 401 starts the OIDC hop rather than showing an error, and a format
Collabora cannot render falls back to a download instead of opening an
editor that would fail. The editor token is POSTed into the iframe, so
it never reaches history, referrers or an access log."
```

---

### Task 16: Org scope — the same surface inside the org shell

The org keeps its own sidebar, because org work belongs in the org context. Only the files tile is replaced; the rest stay link-outs until their slice lands.

**Files:**
- Modify: `apps/web/src/lib/dashboard/workspace-tiles.ts:59-67` (drop the `nextcloud` entry)
- Modify: `apps/web/src/lib/dashboard/org-workspace-tiles.ts:52-63` (drop the `org-nextcloud` entry)
- Modify: `apps/web/src/app/dashboard/arbeitsbereich/page.tsx`
- Modify: `apps/web/tests/workspace-tiles.test.ts`
- Modify: `apps/web/tests/org-workspace-tiles.test.ts`

**Interfaces:**
- Consumes: `FileBrowser` (Task 15); `useAccount` from `@/lib/context/AccountContext`.
- Produces: nothing new.

- [ ] **Step 1: Update the two tile tests first**

Open `apps/web/tests/workspace-tiles.test.ts` and `apps/web/tests/org-workspace-tiles.test.ts`, and change every assertion that expects a `nextcloud` / `org-nextcloud` tile. Add to each file a case that pins the reason:

```typescript
// Files are a native surface now (/arbeitsbereich/dateien), so a tile that
// linked out to Nextcloud would be a second, worse route to the same place.
test("no longer offers a files tile", () => {
  const ids = buildWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
  }).map((t) => t.id);
  assert.equal(ids.includes("nextcloud"), false);
  assert.equal(ids.includes("chat"), true);
});
```

For the org file, the equivalent asserts `org-nextcloud` is absent and `org-chat` present, and `buildOrgWorkspaceTiles` needs its `org` argument:

```typescript
test("no longer offers a files tile", () => {
  const ids = buildOrgWorkspaceTiles({
    workspaceBaseUrl: "https://cloud.example",
    chatBaseUrl: "https://chat.example",
    org: { id: "acc-7", slug: "feuerwehr" },
  }).map((t) => t.id);
  assert.equal(ids.includes("org-nextcloud"), false);
  assert.equal(ids.includes("org-chat"), true);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm test:web
```

Expected: FAIL — both builders still emit a files tile.

- [ ] **Step 3: Drop the two entries**

In `apps/web/src/lib/dashboard/workspace-tiles.ts`, delete this line from the `entries` array:

```typescript
    { id: "nextcloud", label: "Dokumente & Dateien", icon: "cloud", url: normalise(config.workspaceBaseUrl) },
```

and update the module docstring's first paragraph to say that files are native at `/arbeitsbereich/dateien` and these tiles cover only the surfaces that are still linked out.

In `apps/web/src/lib/dashboard/org-workspace-tiles.ts`, delete:

```typescript
    { id: "org-nextcloud", label: "Dateien & Dokumente", icon: "cloud", url: normalise(config.workspaceBaseUrl) },
```

Leave `workspaceBaseUrl` in both config interfaces: it is still read by callers and removing it is a wider change than this task needs.

- [ ] **Step 4: Mount the browser in the org Arbeitsbereich**

Replace `apps/web/src/app/dashboard/arbeitsbereich/page.tsx` entirely:

```tsx
"use client";

import { Briefcase } from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { FileBrowser } from "@/components/workspace/FileBrowser";
import { OrgWorkspaceTilesCard } from "@/components/org-dashboard/OrgWorkspaceTilesCard";

export default function ArbeitsbereichPage() {
  const { activeAccount } = useAccount();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          Arbeitsbereich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Der gemeinsame Arbeitsbereich eurer Organisation. Dateien und
          Dokumente liegen hier; wer Zugriff hat, entscheidet die
          Mitgliedschaft in der Organisation.
        </p>
      </div>

      {activeAccount ? (
        // The org's group folder. The server refuses the scope unless the
        // session carries a claim for this org, so an id in the URL is not
        // enough — this only supplies the name the folder is mounted under.
        <FileBrowser
          scope={{
            scope: "org",
            accountId: activeAccount.id,
            orgName: activeAccount.name,
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Wähle eine Organisation, um den gemeinsamen Arbeitsbereich zu öffnen.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Weitere Apps
        </h2>
        <OrgWorkspaceTilesCard />
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Provision the group folder on first org entry**

In `apps/web/src/lib/workspace/context.ts`, extend `requireWorkspace` so an org scope's folder exists before it is listed. Add this exported function and call it from the files route's `GET` when `scope.kind === "org"`:

```typescript
import { orgGroupId } from "./session";

/**
 * Ensure the org's shared folder exists and is bound to its group. Idempotent
 * and create-if-absent, so it is safe on the request path — this is what closes
 * the group-folder gap rather than leaving it to a runbook.
 */
export async function ensureOrgFolder(
  ctx: WorkspaceContext,
  scope: WorkspaceScope,
): Promise<void> {
  if (scope.kind !== "org" || !scope.accountId || !scope.folderName) return;
  const groupId = orgGroupId(scope.accountId);
  await ctx.provisioner.ensureGroup(groupId);
  await ctx.provisioner.ensureGroupFolder({ name: scope.folderName, groupId });
}
```

In `apps/web/src/app/api/workspace/files/route.ts`, inside `GET`, after `resolveScope`:

```typescript
    await ensureOrgFolder({ session, client, provisioner }, scope);
```

adjusting the destructure at the top of `GET` to `const { session, client, provisioner } = await requireWorkspace();` and adding `ensureOrgFolder` to the import from `@/lib/workspace/context`.

- [ ] **Step 6: Run tests and build**

```bash
pnpm test:web
pnpm --filter @roebel/web build
```

Expected: PASS; build compiles.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/dashboard/workspace-tiles.ts \
        apps/web/src/lib/dashboard/org-workspace-tiles.ts \
        apps/web/src/app/dashboard/arbeitsbereich/page.tsx \
        apps/web/src/lib/workspace/context.ts \
        apps/web/src/app/api/workspace/files/route.ts \
        apps/web/tests/workspace-tiles.test.ts \
        apps/web/tests/org-workspace-tiles.test.ts
git commit -m "feat(web): orgs get the native files surface too

Same component, org scope, inside the org's own sidebar — org work
belongs in the org context, so this mounts the browser rather than
sending anyone to a second shell.

The files tile is gone from both builders: with a native surface, a
tile linking out to Nextcloud is a second and worse route to the same
place. The remaining tiles stay until their slices land.

The group folder is provisioned on first entry, which closes the gap
WORKSPACE_STATE_AND_NEXT §4.4 has been carrying."
```

---

### Task 17: Declare it all in the manifest, render it, and check it

The hard thing, so node #2 gets the workspace from `netizen up` rather than from this document. **Lands last** — `packages/protocol` and `packages/cli` are being edited concurrently by the Nostr agent, so these diffs are additive and committed with pathspecs.

**Files:**
- Modify: `packages/protocol/src/manifest.ts:124-135` (the `workspace` block)
- Modify: `packages/cli/src/render.ts:45-84` (keystone env), `:313-330` (`renderNextcloudSetup`), `:549-556` (Collabora aliasgroup)
- Modify: `packages/cli/src/doctor.ts` (three checks)
- Modify: `packages/protocol/examples/roebel.netizen.json`
- Test: `packages/cli/test/workspace.test.ts`

**Interfaces:**
- Consumes: the existing `rp()`, `hostname()`, `header()` helpers in `render.ts`.
- Produces: `services.workspace.wopiHosts?: string[]`, `services.workspace.bearerValidation?: boolean`, and a `web` relying party in the manifest instance.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/workspace.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NetizenManifestSchema } from "@netizen-labs/protocol";
import { renderCompose, renderNextcloudSetup, renderRoebelIdEnv } from "../src/render.js";
import { doctor } from "../src/doctor.js";
import manifest from "../../protocol/examples/roebel.netizen.json" with { type: "json" };

const m = NetizenManifestSchema.parse(manifest);

describe("the workspace declaration", () => {
  it("parses with the new fields", () => {
    assert.equal(m.services.workspace?.bearerValidation, true);
    assert.ok((m.services.workspace?.wopiHosts ?? []).includes("https://roebel.app"));
  });

  it("declares the web relying party, so the keystone learns about the app", () => {
    const web = m.identity?.relyingParties.find((r) => r.id === "web");
    assert.ok(web, "manifest must declare a `web` relying party");
    assert.ok(
      web!.redirectUris.some((u) => u.endsWith("/api/workspace/auth/callback")),
    );
  });
});

describe("renderRoebelIdEnv", () => {
  it("emits the web client vars beside the nextcloud and matrix ones", () => {
    const env = renderRoebelIdEnv(m);
    assert.match(env, /^WEB_CLIENT_ID=web$/m);
    assert.match(env, /^WEB_CLIENT_SECRET=/m);
    assert.match(env, /^WEB_REDIRECT_URIS=.*\/api\/workspace\/auth\/callback/m);
  });
});

describe("renderNextcloudSetup", () => {
  it("turns on bearer validation, without which the app cannot read a file", () => {
    const sh = renderNextcloudSetup(m);
    assert.match(sh, /oidc_provider_bearer_validation --value=1/);
    assert.match(sh, /selfencoded_bearer_validation --value=1/);
  });

  it("maps the uid to the sub, because the WebDAV path is derived from it", () => {
    assert.match(renderNextcloudSetup(m), /--unique-uid=0/);
  });
});

describe("renderCompose", () => {
  it("adds every declared WOPI host to Collabora's alias group", () => {
    const compose = renderCompose(m);
    assert.match(compose, /aliasgroup1: "https:\/\/cloud\.roebel\.app"/);
    assert.match(compose, /aliasgroup2: "https:\/\/roebel\.app"/);
  });
});

describe("doctor", () => {
  it("warns when a workspace declares Collabora but no WOPI host", () => {
    const broken = structuredClone(m) as typeof m;
    broken.services.workspace!.wopiHosts = [];
    const warnings = doctor(broken).warnings.join("\n");
    assert.match(warnings, /wopiHosts/);
  });

  it("warns when Nextcloud is declared without bearer validation", () => {
    const broken = structuredClone(m) as typeof m;
    broken.services.workspace!.bearerValidation = false;
    assert.match(doctor(broken).warnings.join("\n"), /bearerValidation/);
  });

  it("warns when a workspace has no group folders, so org scope cannot work", () => {
    const broken = structuredClone(m) as typeof m;
    broken.services.workspace!.groupFolders = false;
    assert.match(doctor(broken).warnings.join("\n"), /groupFolders/);
  });

  it("is quiet on the real manifest", () => {
    const warnings = doctor(m).warnings.join("\n");
    for (const term of ["wopiHosts", "bearerValidation", "groupFolders"]) {
      assert.doesNotMatch(warnings, new RegExp(term));
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @netizen-labs/cli test
```

Expected: FAIL — the manifest has no `wopiHosts` and no `web` relying party.

- [ ] **Step 3: Extend the schema**

In `packages/protocol/src/manifest.ts`, inside the `workspace` object (after `groupFolders`, line 128), add:

```typescript
      /**
       * Origins allowed to act as a WOPI host against this node's Collabora —
       * i.e. the app that embeds the editor. Without the app's own origin here,
       * Collabora refuses to render its documents.
       */
      wopiHosts: z.array(z.string().url()).optional(),
      /**
       * Enable user_oidc bearer-token validation, which lets the app call
       * WebDAV/OCS with the citizen's access token instead of a password.
       * Needs user_oidc >= 7.4.0.
       */
      bearerValidation: z.boolean().optional(),
```

- [ ] **Step 4: Emit the web client in the keystone env**

In `packages/cli/src/render.ts`, in `renderRoebelIdEnv`, add `const web = rp(m, "web");` beside the existing `nc` and `mx` lookups, and after the `if (mx)` block:

```typescript
  if (web) {
    lines.push(
      `WEB_CLIENT_ID=${web.id}`,
      `WEB_CLIENT_SECRET=${s.webClientSecret ?? "$WEB_CLIENT_SECRET"}`,
      `WEB_REDIRECT_URIS=${web.redirectUris.join(",")}`,
    );
  }
```

- [ ] **Step 5: Extend the Nextcloud setup script**

In `renderNextcloudSetup`, change `--unique-uid=1` to `--unique-uid=0` and add the bearer-validation lines after the `provisioning_groups` line:

```typescript
php occ config:app:set user_oidc provisioning_groups --value=1
# Bearer-token API access — how the app reads a citizen's files with their own
# access token rather than a stored password. Needs user_oidc >= 7.4.0.
${ws?.bearerValidation ? `php occ config:app:set user_oidc oidc_provider_bearer_validation --value=1
php occ config:app:set user_oidc selfencoded_bearer_validation --value=1` : "# bearerValidation not declared — the app cannot read files via the API"}
php occ app:install groupfolders || true
```

Add `const ws = m.services.workspace;` at the top of the function. Note in a comment that `--unique-uid=0` makes the Nextcloud uid equal the OIDC `sub`, which is what makes the WebDAV path derivable — and that changing it on a node with existing users orphans their homes.

- [ ] **Step 6: Add the WOPI hosts to Collabora**

In `renderCompose`'s Collabora block, replace the single `aliasgroup1` line with the declared hosts appended after the Nextcloud one:

```typescript
    if (ws.collabora) {
      const aliases = [
        `https://${hostname(ws.nextcloud)}`,
        ...(ws.wopiHosts ?? []),
      ];
      svc.push(
        `  collabora:
    image: collabora/code:latest
    restart: unless-stopped
    environment:
${aliases.map((alias, i) => `      aliasgroup${i + 1}: "${alias}"`).join("\n")}
      DONT_GEN_SSL_CERT: "true"
      extra_params: "--o:ssl.enable=false --o:ssl.termination=true"
    expose: ["9980"]`,
      );
    }
```

- [ ] **Step 7: Add the three doctor checks**

In `packages/cli/src/doctor.ts`, inside `doctor()` where `warnings` is assembled, add:

```typescript
  const ws = m.services.workspace;
  if (ws?.collabora && (ws.wopiHosts ?? []).length === 0) {
    warnings.push(
      "workspace declares collabora but no wopiHosts — Collabora will refuse to render documents for the app",
    );
  }
  if (ws?.nextcloud && !ws.bearerValidation) {
    warnings.push(
      "workspace declares nextcloud without bearerValidation — the app cannot read files through the API",
    );
  }
  if (ws?.nextcloud && !ws.groupFolders) {
    warnings.push(
      "workspace declares nextcloud without groupFolders — org scope has nowhere to mount",
    );
  }
```

- [ ] **Step 8: Update the manifest instance**

In `packages/protocol/examples/roebel.netizen.json`, add to `identity.relyingParties`:

```json
    {
      "id": "web",
      "redirectUris": ["https://roebel.app/api/workspace/auth/callback"],
      "scopes": ["openid", "profile", "email", "roebel"]
    }
```

and to `services.workspace`:

```json
      "groupFolders": true,
      "bearerValidation": true,
      "wopiHosts": ["https://roebel.app"]
```

Add `"webClientSecret": "$WEB_CLIENT_SECRET"` to `services.secrets`.

> This file is being edited concurrently. Before editing, run `git diff packages/protocol/examples/roebel.netizen.json` and keep every change you did not make.

- [ ] **Step 9: Run every package test**

```bash
pnpm --filter @netizen-labs/protocol test
pnpm --filter @netizen-labs/cli test
pnpm --filter @netizen-labs/workspace test
pnpm test:web
```

Expected: all PASS, including the Nostr agent's federation tests in `packages/cli` — those are the regression guard that these additive changes broke nothing of theirs.

- [ ] **Step 10: Commit**

```bash
git add packages/protocol/src/manifest.ts \
        packages/protocol/examples/roebel.netizen.json \
        packages/cli/src/render.ts packages/cli/src/doctor.ts \
        packages/cli/test/workspace.test.ts
git commit -m "feat(protocol,cli): the workspace is declared, not hand-wired

wopiHosts, bearerValidation and the web relying party land in the
manifest, so node #2 gets the workspace from \`netizen up\` instead of
from a runbook. Collabora's alias group is now built from the declared
hosts rather than the Nextcloud host alone — without the app's origin
in it, Collabora refuses to render our documents.

The uid mapping moves to --unique-uid=0 so the Nextcloud uid IS the
OIDC sub, which is what makes the WebDAV path derivable. Changing that
on a node with existing users orphans their homes; the comment says so.

doctor gains three checks, so a fork learns about a misconfiguration
from the tool rather than from a blank file list."
```

---

## Manual verification (after Task 17, on the live node)

- [ ] A Citizen opens `/arbeitsbereich`, is redirected to `id.roebel.app`, signs once, and lands back on the Übersicht.
- [ ] Reload: no signature, no visible hop.
- [ ] `/arbeitsbereich/dateien` lists their files; creating a folder and uploading a file both appear after refresh.
- [ ] Opening a `.odt` renders Collabora **inside the Röbel page** — no Nextcloud header, no Element chrome, and the URL is still `roebel.app`.
- [ ] An edit saved in Collabora is visible in Nextcloud directly (`https://cloud.roebel.app`).
- [ ] An org member switching to their org sees the group folder at `/dashboard/arbeitsbereich`; a citizen who is not a member gets an empty scope, and the server logs a `forbidden`.
- [ ] `select count(*) from workspace_actions` grows by one per mutation, and no row contains document content.
- [ ] `netizen doctor packages/protocol/examples/roebel.netizen.json` reports no new warnings.
- [ ] `/app/dashboard` redirects to `/arbeitsbereich`.
- [ ] **No token leaks to the client.** In devtools, no `/api/workspace/*` response body contains `accessToken`, `refreshToken` or the string `Bearer`, and the `roebel_ws` cookie is opaque ciphertext. The route handlers are thin wrappers and are not unit-tested, so this is checked by hand.
- [ ] Switching to a different wallet in the app while `/arbeitsbereich` is open re-runs the OIDC hop instead of continuing to show the previous citizen's files.

## If the WOPI host does not work out

Spec §7 carries a written fallback, and it is deliberately not a task: take it only if Task 13 proves unworkable against the live Collabora.

Iframe Nextcloud's `richdocuments` instead of embedding Collabora directly, and scope the framing to our own origin at Caddy — which we control, and which `render.ts` already generates:

```
header /apps/richdocuments/* {
    -X-Frame-Options
    Content-Security-Policy "frame-ancestors https://roebel.app"
}
```

That change belongs in `renderCaddyfile`, not hand-applied to the box, for the same reason everything else in Task 17 does. It is worse UX — Nextcloud's chrome comes along — so it is the fallback, not the plan.
