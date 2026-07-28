import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORKSPACE_UNCONFIGURED_STATUS,
  errorResponse,
  parseScopeRequest,
  sanitizeDownloadFilename,
  unconfiguredResponse,
  withWorkspaceRoute,
} from "../src/lib/workspace/request";
import { WorkspaceAuthError } from "../src/lib/workspace/context";
import { NextcloudError, ScopeViolationError } from "@netizen-labs/workspace";

describe("parseScopeRequest", () => {
  it("defaults to a personal scope at the root", () => {
    assert.deepEqual(
      parseScopeRequest(new URL("https://roebel.app/api/workspace/files")),
      { scopeKind: null, accountId: null, path: "" },
    );
  });

  it("reads an org scope from the query", () => {
    assert.deepEqual(
      parseScopeRequest(
        new URL(
          "https://roebel.app/api/workspace/files?scope=org&accountId=acc-7&path=Protokolle",
        ),
      ),
      {
        scopeKind: "org",
        accountId: "acc-7",
        path: "Protokolle",
      },
    );
  });

  // The folder's identity is derived server-side from accountId alone (see
  // resolveScope's incident writeup) — an orgName in the query string, if
  // one is even sent, must not survive into the parsed result at all.
  it("does not surface an orgName even if the query string still carries one", () => {
    const parsed = parseScopeRequest(
      new URL(
        "https://roebel.app/api/workspace/files?scope=org&accountId=acc-7&orgName=Kleinverein&path=",
      ),
    );
    assert.equal("orgName" in parsed, false);
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

  // Nextcloud rejecting a token the app still believes is valid (revoked
  // out-of-band, IdP session killed, clock skew, user_oidc misconfigured) is
  // a distinct failure class from our own session checks, but the client
  // must treat it identically: 401 is the only signal it uses to start the
  // OIDC hop, so this has to come back in the same shape as
  // WorkspaceAuthError's 401 branch.
  it("maps a Nextcloud 401 to the same shape as our own expired-session 401", async () => {
    const res = errorResponse(
      new NextcloudError(401, "GET /remote.php/dav/files/0xabc/ failed with 401"),
    );
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, "expired");
  });

  it("maps a Nextcloud 404 to a plain not-found", async () => {
    const res = errorResponse(
      new NextcloudError(404, "GET /remote.php/dav/files/0xabc/gone.pdf failed with 404"),
    );
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "nicht gefunden");
  });

  it("maps a Nextcloud 423 (locked) through", async () => {
    const res = errorResponse(
      new NextcloudError(423, "PUT /remote.php/dav/files/0xabc/doc.odt failed with 423"),
    );
    assert.equal(res.status, 423);
    assert.equal((await res.json()).error, "Datei ist gesperrt");
  });

  it("maps a Nextcloud 507 (out of storage) through", async () => {
    const res = errorResponse(
      new NextcloudError(507, "PUT /remote.php/dav/files/0xabc/big.zip failed with 507"),
    );
    assert.equal(res.status, 507);
    assert.equal((await res.json()).error, "kein Speicherplatz mehr verfuegbar");
  });

  it("maps an unmapped Nextcloud status to 502, not 500 — the upstream said no, not us", async () => {
    const res = errorResponse(
      new NextcloudError(503, "GET /remote.php/dav/files/0xabc/ failed with 503"),
    );
    assert.equal(res.status, 502);
  });

  it("never forwards a NextcloudError's message, which embeds the resolved WebDAV path", async () => {
    const res = errorResponse(
      new NextcloudError(
        503,
        "PROPFIND /remote.php/dav/files/0xSecretWallet/Org Feuerwehr/Protokolle/ failed with 503",
      ),
    );
    const body = JSON.stringify(await res.json());
    assert.doesNotMatch(body, /remote\.php/);
    assert.doesNotMatch(body, /0xSecretWallet/);
  });
});

describe("sanitizeDownloadFilename", () => {
  it("keeps only the last path segment", () => {
    assert.equal(
      sanitizeDownloadFilename("Org Feuerwehr/Protokolle/2026-Bericht.pdf"),
      "2026-Bericht.pdf",
    );
  });

  it("falls back to a generic name for an empty path", () => {
    assert.equal(sanitizeDownloadFilename(""), "download");
  });

  it("falls back to a generic name when the path ends in a separator", () => {
    assert.equal(sanitizeDownloadFilename("Protokolle/"), "download");
  });

  // The two characters that end or escape a Content-Disposition quoted-string
  // must not survive into it, or a crafted name could close the filename
  // attribute early and append its own header directives.
  it("strips a double quote so the name cannot close the quoted-string early", () => {
    assert.equal(
      sanitizeDownloadFilename('Ordner/Bericht" evil="x.pdf'),
      "Bericht evil=x.pdf",
    );
  });

  it("strips a backslash, the quoted-string escape character", () => {
    assert.equal(sanitizeDownloadFilename("Ordner/na\\me.pdf"), "name.pdf");
  });

  // A semicolon is an ordinary character inside a quoted-string — it needs
  // no stripping, unlike the quote and backslash above.
  it("leaves a semicolon alone, since it is harmless inside the quotes", () => {
    assert.equal(
      sanitizeDownloadFilename("Ordner/Bericht; Version 2.pdf"),
      "Bericht; Version 2.pdf",
    );
  });

  // CR/LF inside a header value could otherwise inject a second header.
  it("strips CR and LF so a crafted name cannot inject a second header", () => {
    assert.equal(
      sanitizeDownloadFilename("Ordner/evil.pdf\r\nX-Injected: 1"),
      "evil.pdfX-Injected: 1",
    );
  });
});

// THE merge-day blocker. With no workspace env vars set:
//   no cookie -> requireWorkspace() throws WorkspaceAuthError("no-session")
//   -> 401 -> FileBrowser hard-navigates to /api/workspace/auth/login
//   -> workspaceConfig() throws on that route's first line, uncaught
//   -> Next 500. Every visit to /dashboard/arbeitsbereich, a page that WORKED
// before this branch. withWorkspaceRoute is the one place that stops it, for
// every route at once.
describe("withWorkspaceRoute — the config gate", () => {
  // isWorkspaceEnabled() reads process.env at call time, so the gate can be
  // exercised directly rather than mocked.
  const REQUIRED = [
    "ROEBEL_ID_ISSUER",
    "WORKSPACE_CLIENT_ID",
    "WORKSPACE_CLIENT_SECRET",
    "WOPI_TOKEN_SECRET",
    "NEXTCLOUD_BASE_URL",
    "NEXTCLOUD_ADMIN_USER",
    "NEXTCLOUD_ADMIN_PASSWORD",
    "COLLABORA_BASE_URL",
    "NEXT_PUBLIC_APP_ORIGIN",
  ];

  function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
    const saved = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
      saved.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return run();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  const allUnset = Object.fromEntries(REQUIRED.map((k) => [k, undefined]));
  const allSet = Object.fromEntries(REQUIRED.map((k) => [k, "x"]));

  it("answers 503 {reason:'unconfigured'} instead of running the handler", async () => {
    let ran = false;
    const handler = withWorkspaceRoute(async () => {
      ran = true;
      return new Response("should not happen");
    });
    const res = await withEnv(allUnset, () => handler());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { reason: "unconfigured" });
    assert.equal(ran, false, "the handler must never run unconfigured");
  });

  // The specific shape that produced the 500: a route whose FIRST statement is
  // workspaceConfig(), which throws when a single var is missing. That is
  // /api/workspace/auth/login, and it is where the 401 sent the browser.
  it("does not let a workspaceConfig() throw escape as a 500", async () => {
    const loginish = withWorkspaceRoute(async () => {
      const { workspaceConfig } = await import("../src/lib/workspace/config");
      workspaceConfig();
      return new Response("unreachable");
    });
    const res = await withEnv(allUnset, () => loginish());
    assert.equal(res.status, 503);
    assert.notEqual(res.status, 500);
  });

  // Every one of the nine is load-bearing: a partially-configured deployment
  // is unconfigured, not half-working.
  for (const missing of REQUIRED) {
    it(`treats a deployment missing only ${missing} as unconfigured`, async () => {
      const handler = withWorkspaceRoute(async () => new Response("ran"));
      const res = await withEnv({ ...allSet, [missing]: undefined }, () => handler());
      assert.equal(res.status, 503);
    });
  }

  it("runs the handler, with its arguments, once everything is configured", async () => {
    const seen: unknown[] = [];
    const handler = withWorkspaceRoute(async (a: string, b: number) => {
      seen.push(a, b);
      return new Response("ok", { status: 200 });
    });
    const res = await withEnv(allSet, () => handler("scope", 7));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, ["scope", 7]);
  });

  // The second job of the wrapper: several routes (login, callback, session,
  // logout, both WOPI handlers) had no try/catch of their own, so an
  // unexpected throw surfaced as a framework 500 carrying its message.
  it("catches a throw from a configured handler and maps it through errorResponse", async () => {
    const handler = withWorkspaceRoute(async () => {
      throw new WorkspaceAuthError("no-session", "nope");
    });
    const res = await withEnv(allSet, () => handler());
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, "no-session");
  });

  it("does not leak an unexpected error's message", async () => {
    const handler = withWorkspaceRoute(async () => {
      throw new Error("postgres://user:pw@host down");
    });
    const res = await withEnv(allSet, () => handler());
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(await res.json()), /postgres/);
  });
});

describe("unconfiguredResponse", () => {
  it("is the 503 shape FileBrowser keys its link-out fallback on", async () => {
    const res = unconfiguredResponse();
    assert.equal(res.status, WORKSPACE_UNCONFIGURED_STATUS);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { reason: "unconfigured" });
  });
});
