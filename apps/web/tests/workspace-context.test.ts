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

  // resolveScope delegates the ACL check to hasOrgAccess, so the same
  // trailing-colon property has to hold one layer up: a claim for org
  // "acc-70" must not unlock the scope for org "acc-7".
  it("refuses an org whose claim is a numeric prefix of the requested id (acc-70 claim vs acc-7 request)", () => {
    const superset = { ...session, groups: ["org:acc-70:member"] };
    assert.throws(
      () =>
        resolveScope({
          session: superset,
          scopeKind: "org",
          accountId: "acc-7",
          orgName: "Feuerwehr",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses the other direction too (acc-7 claim vs acc-70 request)", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "acc-70",
          orgName: "Feuerwehr",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses a suffix of the claimed org (cc-7 from an acc-7 claim)", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "cc-7",
          orgName: "Feuerwehr",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an accountId differing only in case", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "ACC-7",
          orgName: "Feuerwehr",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  // An empty accountId is already caught by the "needs an account id" guard
  // above, before hasOrgAccess ever runs — included so the full input space
  // is pinned at this layer too, not just verified once by hand.
  it("refuses an empty-string accountId", () => {
    assert.throws(
      () =>
        resolveScope({
          session,
          scopeKind: "org",
          accountId: "",
          orgName: "Feuerwehr",
        }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("grants org access regardless of role, e.g. an owner claim not just member", () => {
    const owner = { ...session, groups: ["org:acc-7:owner"] };
    assert.deepEqual(
      resolveScope({
        session: owner,
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
});
