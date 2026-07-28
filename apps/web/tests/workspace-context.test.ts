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
