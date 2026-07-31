import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceAuthError, ensureOrgFolder, resolveScope } from "../src/lib/workspace/context";
import type { WorkspaceSession } from "../src/lib/workspace/session";
import type { NextcloudClient, Provisioner, WorkspaceScope } from "@netizen-labs/workspace";

const session: WorkspaceSession = {
  sub: "0xabc",
  groups: ["citizen", "org:acc-7:member"],
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 9_999_999_999_999,
};

describe("resolveScope", () => {
  it("defaults to the citizen's personal scope", async () => {
    assert.deepEqual(
      await resolveScope({ session, scopeKind: null, accountId: null, orgName: null }),
      { kind: "personal", sub: "0xabc", canWrite: true },
    );
  });

  it("builds an org scope, with the folder name derived from accountId alone", async () => {
    // `session` carries an org:acc-7:member claim — a member reads, does not write.
    assert.deepEqual(
      await resolveScope({ session, scopeKind: "org", accountId: "acc-7", orgName: "Feuerwehr" }),
      { kind: "org", sub: "0xabc", accountId: "acc-7", folderName: "org-acc-7", canWrite: false },
    );
  });

  // Task 10 enforces scope.canWrite on the routes; this is the model it reads.
  it("org scope for a member is read-only; personal is writable", async () => {
    const member = await resolveScope({ session, scopeKind: "org", accountId: "acc-7", orgName: null });
    assert.equal(member.canWrite, false);
    const personal = await resolveScope({ session, scopeKind: null, accountId: null, orgName: null });
    assert.equal(personal.canWrite, true);
  });

  it("org scope for an admin or owner is writable", async () => {
    const admin = { ...session, groups: ["org:acc-7:admin"] };
    const owner = { ...session, groups: ["org:acc-7:owner"] };
    assert.equal(
      (await resolveScope({ session: admin, scopeKind: "org", accountId: "acc-7", orgName: null })).canWrite,
      true,
    );
    assert.equal(
      (await resolveScope({ session: owner, scopeKind: "org", accountId: "acc-7", orgName: null })).canWrite,
      true,
    );
  });

  // THE REGRESSION TEST for round 2 of the takeover bug: round 1 fixed a raw
  // crafted `orgName` query parameter by looking the name up from the account
  // registry — but a citizen who owns their OWN legitimate org can rename it
  // (or create it) to another org's exact display name and get a genuine
  // claim + a genuine registry hit for their own account. The fix has to be
  // that `orgName` is not merely validated but structurally incapable of
  // reaching the folder name: there is no lookup left to trick, and the
  // parameter is never read at all.
  it("ignores orgName entirely — even one crafted to collide with another org's real name — because the folder name never reads it", async () => {
    const scope = await resolveScope({
      session,
      scopeKind: "org",
      accountId: "acc-7",
      // Whatever this says, real or crafted, must have zero effect.
      orgName: "Freiwillige Feuerwehr Röbel",
    });
    assert.equal((scope as { folderName?: string }).folderName, "org-acc-7");
  });

  it("gives two different, equally-legitimate orgs two different folders, never a collision", async () => {
    const other = { ...session, groups: ["org:acc-11:owner"] };
    const a = await resolveScope({ session, scopeKind: "org", accountId: "acc-7", orgName: null });
    const b = await resolveScope({ session: other, scopeKind: "org", accountId: "acc-11", orgName: null });
    assert.notEqual((a as { folderName?: string }).folderName, (b as { folderName?: string }).folderName);
  });

  // The groups claim is the ACL. A citizen may not reach an org they do not
  // belong to by putting its id in a query string.
  it("refuses an org the session has no claim for", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: "acc-99", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an org scope with no account id", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: null, orgName: null }),
      WorkspaceAuthError,
    );
  });

  // THE FAIL-OPEN REGRESSION: orgRole is the sole gate now, precisely because
  // it validates the role suffix and a prefix-only check does not. A claim
  // with a role outside ORG_ROLES must be refused entirely — not granted
  // read via the old prefix check and then write via `role !== "member"`,
  // which is what happened when resolveScope gated on hasOrgAccess (prefix
  // only) and computed canWrite from orgRole (suffix-validating) separately:
  // hasOrgAccess passed, orgRole returned null, and `null !== "member"` was
  // true — an unrecognized role got write access.
  it("refuses (not read, not write) a claim whose role is not in ORG_ROLES", async () => {
    const contractor = { ...session, groups: ["org:acc-7:contractor"] };
    await assert.rejects(
      () => resolveScope({ session: contractor, scopeKind: "org", accountId: "acc-7", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  // resolveScope's org branch now gates on `orgRole` (which validates the
  // role suffix, not just the "org:<accountId>:" prefix), so the same
  // trailing-colon property has to hold one layer up: a claim for org
  // "acc-70" must not unlock the scope for org "acc-7".
  it("refuses an org whose claim is a numeric prefix of the requested id (acc-70 claim vs acc-7 request)", async () => {
    const superset = { ...session, groups: ["org:acc-70:member"] };
    await assert.rejects(
      () => resolveScope({ session: superset, scopeKind: "org", accountId: "acc-7", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses the other direction too (acc-7 claim vs acc-70 request)", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: "acc-70", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses a suffix of the claimed org (cc-7 from an acc-7 claim)", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: "cc-7", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an accountId differing only in case", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: "ACC-7", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses an empty-string accountId", async () => {
    await assert.rejects(
      () => resolveScope({ session, scopeKind: "org", accountId: "", orgName: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("grants org access regardless of role, e.g. an owner claim not just member", async () => {
    const owner = { ...session, groups: ["org:acc-7:owner"] };
    assert.deepEqual(
      await resolveScope({ session: owner, scopeKind: "org", accountId: "acc-7", orgName: null }),
      { kind: "org", sub: "0xabc", accountId: "acc-7", folderName: "org-acc-7", canWrite: true },
    );
  });
});

describe("ensureOrgFolder", () => {
  function fakeProvisioner() {
    const ensureGroupCalls: string[] = [];
    const ensureGroupFolderCalls: Array<{
      name: string;
      groupId: string;
      permissions?: number;
    }> = [];
    const provisioner: Provisioner = {
      async ensureUser() {
        return { created: false };
      },
      async ensureGroup(groupId: string) {
        ensureGroupCalls.push(groupId);
        return { created: false };
      },
      async ensureGroupFolder(params: {
        name: string;
        groupId: string;
        permissions?: number;
      }) {
        ensureGroupFolderCalls.push(params);
        return { folderId: 1, created: false };
      },
    };
    return { provisioner, ensureGroupCalls, ensureGroupFolderCalls };
  }

  function ctxWith(provisioner: Provisioner): import("../src/lib/workspace/context").WorkspaceContext {
    return { session, client: {} as NextcloudClient, provisioner };
  }

  it("does nothing for a personal scope", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = { kind: "personal", sub: "0xabc", canWrite: true };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.equal(ensureGroupCalls.length, 0);
    assert.equal(ensureGroupFolderCalls.length, 0);
  });

  // THE FUNCTIONAL FIX: the keystone emits org:<id>:<role> verbatim from
  // account_owners.role, and an org's creator holds role "owner" (the DB
  // default) — not "member". Binding only :member left owners locked out of
  // their own org's files. ensureOrgFolder must bind every role.
  //
  // Task 11: each bind now also carries the role's permission bitmask
  // (read=1, update=2, create=4, delete=8, share=16, all=31) — owner/admin
  // get 31 (full access), member gets 1 (read-only) — mirroring the
  // `canWrite: role !== "member"` split `resolveScope` already enforces at
  // the API layer, but applied to Nextcloud's own ACL as defense in depth.
  it("binds every org role — owner, admin, member — onto exactly scope.folderName, with owner/admin writable (31) and member read-only (1)", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = {
      kind: "org",
      sub: "0xabc",
      accountId: "acc-ensure-1",
      folderName: "org-acc-ensure-1",
      canWrite: true,
    };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.deepEqual(ensureGroupCalls, [
      "org:acc-ensure-1:owner",
      "org:acc-ensure-1:admin",
      "org:acc-ensure-1:member",
    ]);
    assert.deepEqual(ensureGroupFolderCalls, [
      { name: "org-acc-ensure-1", groupId: "org:acc-ensure-1:owner", permissions: 31 },
      { name: "org-acc-ensure-1", groupId: "org:acc-ensure-1:admin", permissions: 31 },
      { name: "org-acc-ensure-1", groupId: "org:acc-ensure-1:member", permissions: 1 },
    ]);
  });

  it("does not call the provisioner again for an account already confirmed in this process", async () => {
    const { provisioner, ensureGroupCalls, ensureGroupFolderCalls } = fakeProvisioner();
    const scope: WorkspaceScope = {
      kind: "org",
      sub: "0xabc",
      accountId: "acc-ensure-2",
      folderName: "org-acc-ensure-2",
      canWrite: true,
    };
    await ensureOrgFolder(ctxWith(provisioner), scope);
    await ensureOrgFolder(ctxWith(provisioner), scope);
    assert.equal(ensureGroupCalls.length, 3, "3 roles bound once, not 6");
    assert.equal(ensureGroupFolderCalls.length, 3);
  });
});

// THE CITIZEN GATE. The Dateien surface replaced a dashboard gated on
// "verifizierte Bürger", but that gate only ever lived in the page's JSX — a
// client-side card hiding a link. Nothing on the server checked, so the
// personal Nextcloud home was reachable by anyone holding a workspace session.
describe("resolveScope — the citizen gate on the personal scope", () => {
  const notCitizen: WorkspaceSession = {
    ...session,
    groups: ["org:acc-7:member"],
  };

  it("refuses a personal scope for a session with no citizen claim", async () => {
    await assert.rejects(
      () => resolveScope({ session: notCitizen, scopeKind: null, accountId: null }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  it("refuses it for an empty groups claim too", async () => {
    await assert.rejects(
      () =>
        resolveScope({
          session: { ...session, groups: [] },
          scopeKind: null,
          accountId: null,
        }),
      (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
    );
  });

  // Every non-"org" scopeKind falls into the personal branch, so a client
  // cannot dodge the gate by inventing one.
  it("refuses every non-org scopeKind, not just the null default", async () => {
    for (const kind of ["personal", "", "ORG", "Org", "personal ", "other"]) {
      await assert.rejects(
        () => resolveScope({ session: notCitizen, scopeKind: kind, accountId: null }),
        (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
        `for scopeKind ${JSON.stringify(kind)}`,
      );
    }
  });

  // "forbidden" (403), not "no-session" (401): this person IS signed in, and
  // 401 is the signal FileBrowser answers with an OIDC hop. Round-tripping
  // them through login would never make them a citizen — it would just loop.
  it("reports forbidden, never no-session, so the client does not start a login hop", async () => {
    await assert.rejects(
      () => resolveScope({ session: notCitizen, scopeKind: null, accountId: null }),
      (err: unknown) =>
        err instanceof WorkspaceAuthError &&
        err.reason !== "no-session" &&
        err.reason !== "expired",
    );
  });

  it("allows it for a session that does carry the claim", async () => {
    assert.deepEqual(
      await resolveScope({ session, scopeKind: null, accountId: null }),
      { kind: "personal", sub: "0xabc", canWrite: true },
    );
  });

  // The gate belongs to the PERSONAL branch alone. An org's staff are not all
  // verified citizens, and /dashboard/arbeitsbereich is gated by the
  // org:<id>:<role> claim instead — gating requireWorkspace() wholesale would
  // have locked those people out of their own org's shared folder.
  it("does NOT gate the org scope on citizenship — the org claim is that gate", async () => {
    // notCitizen's only claim is org:acc-7:member — a member, so read-only.
    assert.deepEqual(
      await resolveScope({ session: notCitizen, scopeKind: "org", accountId: "acc-7" }),
      { kind: "org", sub: "0xabc", accountId: "acc-7", folderName: "org-acc-7", canWrite: false },
    );
  });

  // A claim that merely CONTAINS "citizen" is not the citizen claim. The
  // keystone emits the exact string.
  it("is not fooled by a group that only looks like the citizen claim", async () => {
    for (const groups of [["citizens"], ["citizen:x"], ["Citizen"], ["not-citizen"], ["org:citizen:member"]]) {
      await assert.rejects(
        () =>
          resolveScope({ session: { ...session, groups }, scopeKind: null, accountId: null }),
        (err: unknown) => err instanceof WorkspaceAuthError && err.reason === "forbidden",
        `for ${JSON.stringify(groups)}`,
      );
    }
  });
});
