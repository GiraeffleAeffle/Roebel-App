import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  WorkspaceAuthError,
  ensureOrgFolder,
  resolveOrgFolderName,
  resolveScope,
  type OrgAccountLookup,
  type WorkspaceContext,
} from "../src/lib/workspace/context";
import type { WorkspaceSession } from "../src/lib/workspace/session";
import type { NextcloudClient, Provisioner, WorkspaceScope } from "@netizen-labs/workspace";

const session: WorkspaceSession = {
  sub: "0xabc",
  groups: ["citizen", "org:acc-7:member"],
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 9_999_999_999_999,
};

/**
 * A registry stub that answers for exactly one accountId and refuses every
 * other one (returns null) — so a test can prove which accountId a call site
 * actually looked up, not just that "some" lookup happened to succeed.
 */
function lookupFor(accountId: string, name: string): OrgAccountLookup {
  return async (id) =>
    id === accountId ? { name, account_type: "organisation" as const } : null;
}

describe("resolveScope", () => {
  it("defaults to the citizen's personal scope", async () => {
    assert.deepEqual(
      await resolveScope(
        { session, scopeKind: null, accountId: null, orgName: null },
        lookupFor("acc-7", "Feuerwehr"),
      ),
      { kind: "personal", sub: "0xabc" },
    );
  });

  it("builds an org scope, with the folder name from the account registry lookup", async () => {
    assert.deepEqual(
      await resolveScope(
        { session, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" },
        lookupFor("acc-7", "Feuerwehr"),
      ),
      { kind: "org", sub: "0xabc", accountId: "acc-7", folderName: "Org Feuerwehr" },
    );
  });

  // THE REGRESSION TEST for the takeover bug: a citizen genuinely authorised
  // for acc-7 sends a DIFFERENT org's real name as orgName, hoping
  // ensureOrgFolder will additively bind acc-7's group onto that other org's
  // already-provisioned folder. The folder name must come from the account
  // registry alone — the crafted orgName must never reach it, in the output
  // or as an argument to the lookup itself.
  it("ignores a crafted orgName: the folder name always comes from the account registry, never the client", async () => {
    const lookup = mock.fn(lookupFor("acc-7", "Freiwillige Feuerwehr Röbel"));
    const scope = await resolveScope(
      {
        session,
        scopeKind: "org",
        accountId: "acc-7",
        // The exploit shape: a legitimate, ACL-authorised accountId paired
        // with a DIFFERENT org's real display name.
        orgName: "Kleinverein e.V.",
      },
      lookup,
    );
    assert.equal(scope.kind, "org");
    assert.equal((scope as { folderName?: string }).folderName, "Org Freiwillige Feuerwehr Röbel");
    assert.notEqual((scope as { folderName?: string }).folderName, "Org Kleinverein e.V.");
    // And the crafted name never even reaches the lookup as an argument —
    // only the ACL-authorised accountId does.
    assert.equal(lookup.mock.callCount(), 1);
    assert.deepEqual(lookup.mock.calls[0].arguments, ["acc-7"]);
  });

  it("refuses an org scope whose account the registry does not know", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" },
          async () => null,
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an org scope whose account is personal, not an organisation", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" },
          async () => ({ name: "Max Mustermann", account_type: "personal" as const }),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  // The groups claim is the ACL. A citizen may not reach an org they do not
  // belong to by putting its id in a query string.
  it("refuses an org the session has no claim for, before ever calling the registry lookup", async () => {
    const lookup = mock.fn(lookupFor("acc-99", "Fremd"));
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "acc-99", orgName: "Fremd" },
          lookup,
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
    // The ACL check is the first gate — a foreign accountId never reaches
    // the account registry at all.
    assert.equal(lookup.mock.callCount(), 0);
  });

  it("refuses an org scope with no account id", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: null, orgName: "Feuerwehr" },
          lookupFor("acc-7", "Feuerwehr"),
        ),
      WorkspaceAuthError,
    );
  });

  // resolveScope delegates the ACL check to hasOrgAccess, so the same
  // trailing-colon property has to hold one layer up: a claim for org
  // "acc-70" must not unlock the scope for org "acc-7".
  it("refuses an org whose claim is a numeric prefix of the requested id (acc-70 claim vs acc-7 request)", async () => {
    const superset = { ...session, groups: ["org:acc-70:member"] };
    await assert.rejects(
      () =>
        resolveScope(
          { session: superset, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" },
          lookupFor("acc-7", "Feuerwehr"),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses the other direction too (acc-7 claim vs acc-70 request)", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "acc-70", orgName: "Feuerwehr" },
          lookupFor("acc-70", "Feuerwehr"),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses a suffix of the claimed org (cc-7 from an acc-7 claim)", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "cc-7", orgName: "Feuerwehr" },
          lookupFor("cc-7", "Feuerwehr"),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an accountId differing only in case", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "ACC-7", orgName: "Feuerwehr" },
          lookupFor("ACC-7", "Feuerwehr"),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an empty-string accountId", async () => {
    await assert.rejects(
      () =>
        resolveScope(
          { session, scopeKind: "org", accountId: "", orgName: "Feuerwehr" },
          lookupFor("", "Feuerwehr"),
        ),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("grants org access regardless of role, e.g. an owner claim not just member", async () => {
    const owner = { ...session, groups: ["org:acc-7:owner"] };
    assert.deepEqual(
      await resolveScope(
        { session: owner, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" },
        lookupFor("acc-7", "Feuerwehr"),
      ),
      { kind: "org", sub: "0xabc", accountId: "acc-7", folderName: "Org Feuerwehr" },
    );
  });
});

describe("resolveOrgFolderName", () => {
  it("derives the folder name from the account's registry name", () => {
    assert.equal(
      resolveOrgFolderName({
        name: "Freiwillige Feuerwehr Röbel",
        account_type: "organisation",
      }),
      "Org Freiwillige Feuerwehr Röbel",
    );
  });

  it("refuses a null account (no registry match)", () => {
    assert.throws(() => resolveOrgFolderName(null), WorkspaceAuthError);
  });

  it("refuses a personal account — only an organisation gets a shared folder", () => {
    assert.throws(
      () => resolveOrgFolderName({ name: "Max Mustermann", account_type: "personal" }),
      WorkspaceAuthError,
    );
  });
});

describe("ensureOrgFolder", () => {
  function fakeProvisioner() {
    const ensureGroupCalls: string[] = [];
    const ensureGroupFolderCalls: Array<{ name: string; groupId: string }> = [];
    const provisioner: Provisioner = {
      async ensureUser() {
        return { created: false };
      },
      async ensureGroup(groupId: string) {
        ensureGroupCalls.push(groupId);
        return { created: false };
      },
      async ensureGroupFolder(params: { name: string; groupId: string }) {
        ensureGroupFolderCalls.push(params);
        return { folderId: 1, created: false };
      },
    };
    return { provisioner, ensureGroupCalls, ensureGroupFolderCalls };
  }

  function ctxWith(provisioner: Provisioner): WorkspaceContext {
    return { session, client: {} as NextcloudClient, provisioner };
  }

  it("does nothing for a personal scope", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = { kind: "personal", sub: "0xabc" };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.equal(ensureGroupCalls.length, 0);
    assert.equal(ensureGroupFolderCalls.length, 0);
  });

  // Proves the second half of the fix: given the TRUSTED scope resolveScope
  // already produced (folderName from the account registry, not the
  // client), ensureOrgFolder binds the group derived from accountId onto
  // exactly that folder name — no other name is ever handed to the
  // provisioner.
  it("binds the group derived from accountId onto exactly scope.folderName", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = {
      kind: "org",
      sub: "0xabc",
      accountId: "acc-ensure-1",
      folderName: "Org Freiwillige Feuerwehr Röbel",
    };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.deepEqual(ensureGroupCalls, ["org:acc-ensure-1:member"]);
    assert.deepEqual(ensureGroupFolderCalls, [
      { name: "Org Freiwillige Feuerwehr Röbel", groupId: "org:acc-ensure-1:member" },
    ]);
  });

  it("does not call the provisioner again for an account already confirmed in this process", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = {
      kind: "org",
      sub: "0xabc",
      accountId: "acc-ensure-2",
      folderName: "Org Kleinverein",
    };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.equal(ensureGroupCalls.length, 1);
    assert.equal(ensureGroupFolderCalls.length, 1);
  });
});
