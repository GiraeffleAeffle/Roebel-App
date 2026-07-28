import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorResponse,
  parseScopeRequest,
  sanitizeDownloadFilename,
} from "../src/lib/workspace/request";
import { WorkspaceAuthError } from "../src/lib/workspace/context";
import { NextcloudError, ScopeViolationError } from "@netizen-labs/workspace";

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
