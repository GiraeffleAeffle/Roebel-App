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
