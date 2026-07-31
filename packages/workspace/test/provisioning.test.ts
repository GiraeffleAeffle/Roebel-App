import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextcloudError } from "../src/nextcloud";
import { GroupFolderConflictError, createProvisioner } from "../src/provisioning";

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

  // --- Gaps beyond the brief's own coverage ---
  //
  // The lookup and create calls both wrap their result in an OCS envelope
  // inside an HTTP 200. A implementation that only checks `res.ok` (as the
  // brief's reference sketch does) will silently treat ANY 200-wrapped
  // statuscode as success — including one that means "this failed" — because
  // nothing ever inspects `meta.statuscode` on the write path. The two tests
  // below pin the two ways that can go wrong for `ensureUser`'s create call:
  // a genuine failure must not be swallowed into `{ created: true }`, and a
  // "lost the race to another tab" reply (statuscode 102, same code OCS uses
  // for group-already-exists) must not be treated as a failure either.

  it("treats a concurrent-create race (statuscode 102) as success, not a thrown error", async () => {
    // Two tabs both see the 404 lookup, both race to create. The loser's
    // create call comes back "already exists" rather than "ok" — this must
    // still resolve, just reporting that THIS call didn't do the creating.
    const { fetchImpl } = stubFetch([
      { body: ocs(404, null) },
      { body: ocs(102, null) },
    ]);
    const result = await provisioner(fetchImpl).ensureUser(SUB, "Max");
    assert.deepEqual(result, { created: false });
  });

  it("throws (rather than reporting created:true) when user creation genuinely fails", async () => {
    // statuscode 104 on the *create-user* endpoint is OCS's "group does not
    // exist" (not "no permission" — that's a different code on a different
    // endpoint; the provisioning-API docs assign 104 differently per call).
    // The exact meaning doesn't change the behaviour under test here: any
    // non-100/102 statuscode is a uniform, real failure. Silently returning
    // created:true here would tell a caller the citizen has a workspace home
    // when they do not.
    const { fetchImpl } = stubFetch([
      { body: ocs(404, null) },
      { body: ocs(104, null) },
    ]);
    await assert.rejects(
      () => provisioner(fetchImpl).ensureUser(SUB, "Max"),
      (err: unknown) => err instanceof NextcloudError && err.status === 104,
    );
  });

  it("throws when the lookup itself fails with neither success nor not-found", async () => {
    // e.g. an expired admin session surfaced as an OCS-level failure rather
    // than an HTTP 401. Treating "not 404" as "exists" (as a naive `!== 404`
    // check would) turns an auth failure into a silent no-op.
    const { fetchImpl } = stubFetch([{ body: ocs(997, null) }]);
    await assert.rejects(
      () => provisioner(fetchImpl).ensureUser(SUB, "Max"),
      (err: unknown) => err instanceof NextcloudError && err.status === 997,
    );
  });

  it("throws a NextcloudError — not a JSON-parse crash — on a 200 reply that isn't OCS JSON", async () => {
    // The realistic outage shape: a reverse proxy in front of Nextcloud
    // returns its own HTML error page with a 200 (or serves a cached/static
    // page) instead of proxying through to the OCS endpoint. `res.ok` is
    // true, so this only surfaces on the JSON.parse fallback, which must
    // produce a typed, credential-free error rather than an uncaught
    // SyntaxError.
    const { fetchImpl } = stubFetch([
      { status: 200, body: "<html><body>502 Bad Gateway</body></html>" },
    ]);
    await assert.rejects(
      () => provisioner(fetchImpl).ensureUser(SUB, "Max"),
      (err: unknown) =>
        err instanceof NextcloudError &&
        err.status === 200 &&
        /non-JSON OCS reply/.test(err.message),
    );
    // The admin credentials must never leak into a thrown error's message.
    const { fetchImpl: fetchImpl2 } = stubFetch([
      { status: 200, body: "<html>not json</html>" },
    ]);
    try {
      await provisioner(fetchImpl2).ensureUser(SUB, "Max");
      assert.fail("expected ensureUser to throw");
    } catch (err) {
      assert.ok(err instanceof NextcloudError);
      assert.doesNotMatch(err.message, /pw|admin|Basic /);
    }
  });
});

describe("ensureGroupFolder", () => {
  it("reuses an existing, already-bound folder with a single listing call", async () => {
    // `groups` on the listing entry is the real OCS groupfolders shape:
    // bound group ids keyed to a permission bitmask. When it already
    // confirms our group, there is nothing left to do — no bind call.
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          "3": {
            id: 3,
            mount_point: "Org Feuerwehr",
            groups: { "org:acc-7:member": 31 },
          },
        }),
      },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 1, "group already bound — no re-bind call");
  });

  it("treats the PHP empty-array quirk (`groups: []` instead of `{}`) as not yet bound", async () => {
    // An empty PHP associative array serializes to JSON `[]`, not `{}`. A
    // check that only ever looked for an object key would misread this as
    // "no groups exist to check" and skip the bind incorrectly either way —
    // pin that `[]` is treated the same as "unknown", i.e. still bind.
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr", groups: [] } }) },
      { body: ocs(100, {}) },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 2, "`[]` must not be mistaken for the group already being present");
    assert.match(calls[1].url, /\/apps\/groupfolders\/folders\/3\/groups/);
  });

  it("creates the folder and binds the group when none exists", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, {}) }, // initial listing: nothing yet
      { body: ocs(100, { id: 9 }) }, // create -> id 9
      { body: ocs(100, { "9": { id: 9, mount_point: "Org Feuerwehr" } }) }, // re-list after create: just us
      { body: ocs(100, {}) }, // bind succeeds
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 9, created: true });
    assert.match(calls[1].url, /\/apps\/groupfolders\/folders\?/, "create call");
    assert.equal(calls[2].method, "GET", "re-lists after creating, to detect a lost race");
    assert.match(calls[3].url, /\/apps\/groupfolders\/folders\/9\/groups/);
    assert.match(calls[3].body ?? "", /group=org%3Aacc-7%3Amember/);
  });

  // --- Gap 1 (CRITICAL): partially-created folder when the group binding fails ---
  //
  // The create-folder call and the bind-group call are two separate OCS
  // requests. If the first succeeds and the second fails, a folder now
  // exists on the server with nobody able to reach it through the group.
  // A reference implementation that ignores the bind call's own envelope
  // (checking only `res.ok`) would return `{ created: true }` as if
  // everything had gone according to plan. That is the wrong failure mode
  // for a request-path operation: the caller believes provisioning
  // succeeded and moves on, and the folder is orphaned with no signal that
  // anything needs retrying.
  it("throws — and does not report created:true — when binding the group to a freshly-created folder fails", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, {}) }, // initial listing: nothing yet
      { body: ocs(100, { id: 9 }) }, // create -> id 9
      { body: ocs(100, { "9": { id: 9, mount_point: "Org Feuerwehr" } }) }, // re-list: just us
      { body: ocs(997, null) }, // bind fails
    ]);
    await assert.rejects(
      () =>
        provisioner(fetchImpl).ensureGroupFolder({
          name: "Org Feuerwehr",
          groupId: "org:acc-7:member",
        }),
      (err: unknown) => err instanceof NextcloudError && err.status === 997,
    );
    assert.equal(
      calls.length,
      4,
      "listing, create, re-list, and the failed bind — the folder-create call still happened, this is the orphan case",
    );
  });

  // The critical fix: the orphan above must not be permanent. The NEXT call
  // for the same name+group must notice the folder exists but is not bound,
  // and repair it — not just find it in the listing and declare success.
  // This is the full sequence the prior implementation never tested: create,
  // bind fails, retry, folder is now correctly bound.
  it("self-heals on retry: re-binds the group to a folder left orphaned by a prior failed bind", async () => {
    const first = stubFetch([
      { body: ocs(100, {}) },
      { body: ocs(100, { id: 9 }) },
      { body: ocs(100, { "9": { id: 9, mount_point: "Org Feuerwehr" } }) },
      { body: ocs(997, null) }, // bind fails — folder 9 now exists, ungrouped
    ]);
    await assert.rejects(() =>
      provisioner(first.fetchImpl).ensureGroupFolder({
        name: "Org Feuerwehr",
        groupId: "org:acc-7:member",
      }),
    );

    // Retry: the listing now finds folder 9 (created by the first call) with
    // no `groups` entry for us — because the bind never landed. The buggy
    // version of this code stopped at "found in the listing" and returned
    // `{ created: false }` with zero attempt to bind. The fix must notice
    // the missing binding and repair it here.
    const second = stubFetch([
      { body: ocs(100, { "9": { id: 9, mount_point: "Org Feuerwehr" } }) },
      { body: ocs(100, {}) }, // repair bind succeeds
    ]);
    const result = await provisioner(second.fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 9, created: false });
    assert.equal(
      second.calls.length,
      2,
      "listing plus the repair bind — not a silent no-op on an orphaned folder",
    );
    assert.equal(second.calls[1].method, "POST");
    assert.match(second.calls[1].url, /\/apps\/groupfolders\/folders\/9\/groups/);
    assert.match(second.calls[1].body ?? "", /group=org%3Aacc-7%3Amember/);
  });

  // --- Gap 2 (IMPORTANT): the two-tab creation race ---
  //
  // groupfolders has no server-side dedup on `mount_point` (unlike
  // users/groups, which get OCS_ALREADY_EXISTS for free) — a plain
  // check-then-act listing can't be made atomic from an HTTP client. Two
  // tabs that both miss the lookup will both create a folder for the same
  // name, ending up with two live rows (e.g. ids 10 and 11) both bound to
  // the group, and both callers reporting bare success. These tests encode
  // the race's observable effect on the wire — a second, same-named folder
  // materializing between "create" and "re-list" — rather than literally
  // racing two Promises: real concurrent execution order between two tabs
  // is a network-timing detail with no single deterministic interleaving,
  // but the reconciliation logic below must react correctly to any
  // interleaving that could occur, which is exactly what fixing the
  // listing's contents around the create call tests.
  it("converges on the lowest id and reports the duplicate when two folders already share the mount point", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          "11": { id: 11, mount_point: "Org Feuerwehr" },
          "10": {
            id: 10,
            mount_point: "Org Feuerwehr",
            groups: { "org:acc-7:member": 31 },
          },
        }),
      },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, {
      folderId: 10,
      created: false,
      duplicateFolderIds: [11],
    });
    assert.equal(
      calls.length,
      1,
      "the canonical folder (10) is already bound — no bind call, and nothing is deleted",
    );
  });

  it("detects a lost creation race via the post-create re-list and reports its own folder as the duplicate", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, {}) }, // initial listing: empty — both tabs would see this
      { body: ocs(100, { id: 11 }) }, // our own create -> id 11 (the higher id: we lose)
      {
        body: ocs(100, {
          "10": { id: 10, mount_point: "Org Feuerwehr" }, // another tab's folder, invisible to our first listing, now surfaced
          "11": { id: 11, mount_point: "Org Feuerwehr" },
        }),
      },
      { body: ocs(100, {}) }, // bind lands on the canonical folder, 10
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, {
      folderId: 10,
      created: false,
      duplicateFolderIds: [11],
    });
    assert.match(
      calls[3].url,
      /\/apps\/groupfolders\/folders\/10\/groups/,
      "binds the canonical folder (10), never the one this call created and lost the race with (11)",
    );
  });
});

// Defence in depth for the org-folder-takeover incident: the app layer now
// derives an org's mount point from its accountId alone, which is unique by
// construction, so two different orgs should never be able to collide on the
// same folder name in the first place. These tests pin a SECOND, independent
// mechanism that would also have to fail before one org's group could reach
// another org's folder: even if a caller ever handed this function a
// colliding name (a regression, a hand-built call, an admin mistake),
// ensureGroupFolder refuses to bind onto a folder a DIFFERENT org's group
// already occupies, rather than additively binding onto it.
describe("ensureGroupFolder — cross-org conflict refusal (defence in depth)", () => {
  it("refuses to bind when the matched folder already carries a different org's group", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          "3": {
            id: 3,
            mount_point: "org-acc-4",
            groups: { "org:acc-4:owner": 31 },
          },
        }),
      },
    ]);
    await assert.rejects(
      () =>
        provisioner(fetchImpl).ensureGroupFolder({
          name: "org-acc-4",
          groupId: "org:acc-11:member",
        }),
      (err: unknown) => err instanceof GroupFolderConflictError,
    );
    assert.equal(calls.length, 1, "the listing only — no bind call ever issued");
  });

  it("does not refuse a second ROLE of the SAME org — that is the normal multi-role bind", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          "3": {
            id: 3,
            mount_point: "org-acc-7",
            groups: { "org:acc-7:owner": 31 },
          },
        }),
      },
      { body: ocs(100, {}) }, // bind succeeds
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "org-acc-7",
      groupId: "org:acc-7:admin",
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 2, "listing plus the (same-org) bind — not refused");
  });

  it("does not treat an ambiguous/absent groups value as a conflict — only positive evidence refuses", async () => {
    // Same shape as the existing "creates the folder and binds the group
    // when none exists" happy path: nothing in `groups` proves a conflict,
    // so this must still succeed exactly as before the defence-in-depth
    // check was added.
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, {}) },
      { body: ocs(100, { id: 9 }) },
      { body: ocs(100, { "9": { id: 9, mount_point: "org-acc-11" } }) },
      { body: ocs(100, {}) },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "org-acc-11",
      groupId: "org:acc-11:member",
    });
    assert.deepEqual(result, { folderId: 9, created: true });
    assert.equal(calls.length, 4);
  });
});

// Task 11: defense in depth alongside the API layer's canWrite enforcement
// (Task 10) — Nextcloud's own ACL now agrees with the app's role model
// instead of leaving every bound group at the groupfolders default of full
// access. Bitmask: read=1, update=2, create=4, delete=8, share=16, all=31.
describe("ensureGroupFolder — per-role permissions bitmask", () => {
  it("binds a new admin group and sets the 31 (all) bitmask", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr", groups: [] } }) },
      { body: ocs(100, {}) }, // bind succeeds
      { body: ocs(100, {}) }, // permissions POST succeeds
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:admin",
      permissions: 31,
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].method, "POST");
    assert.match(
      calls[2].url,
      /\/apps\/groupfolders\/folders\/3\/groups\/org%3Aacc-7%3Aadmin\?format=json/,
    );
    assert.match(calls[2].body ?? "", /permissions=31/);
  });

  it("binds a new member group and sets the 1 (read-only) bitmask", async () => {
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr", groups: [] } }) },
      { body: ocs(100, {}) }, // bind succeeds
      { body: ocs(100, {}) }, // permissions POST succeeds
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
      permissions: 1,
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 3);
    assert.match(
      calls[2].url,
      /\/apps\/groupfolders\/folders\/3\/groups\/org%3Aacc-7%3Amember\?format=json/,
    );
    assert.match(calls[2].body ?? "", /permissions=1/);
  });

  it("is idempotent: skips both the bind and the permissions POST when the listing already shows the matching bitmask", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          "3": {
            id: 3,
            mount_point: "Org Feuerwehr",
            groups: { "org:acc-7:admin": 31 },
          },
        }),
      },
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:admin",
      permissions: 31,
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(
      calls.length,
      1,
      "already bound with the right bitmask — no bind call, no permissions POST",
    );
  });

  it("re-POSTs permissions on drift: bind is skipped (already bound) but a stale bitmask is corrected", async () => {
    const { calls, fetchImpl } = stubFetch([
      {
        body: ocs(100, {
          // stale: member currently carries 31 (full access) instead of 1
          "3": { id: 3, mount_point: "Org Feuerwehr", groups: { "org:acc-7:member": 31 } },
        }),
      },
      { body: ocs(100, {}) }, // permissions POST corrects it
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
      permissions: 1,
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 2, "bind skipped, but the bitmask is corrected");
    assert.equal(calls[1].method, "POST");
    assert.match(
      calls[1].url,
      /\/apps\/groupfolders\/folders\/3\/groups\/org%3Aacc-7%3Amember\?format=json/,
    );
    assert.match(calls[1].body ?? "", /permissions=1/);
  });

  it("throws — rather than reporting success — when the permissions POST genuinely fails", async () => {
    const { fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr", groups: [] } }) },
      { body: ocs(100, {}) }, // bind succeeds
      { body: ocs(997, null) }, // permissions POST fails
    ]);
    await assert.rejects(
      () =>
        provisioner(fetchImpl).ensureGroupFolder({
          name: "Org Feuerwehr",
          groupId: "org:acc-7:admin",
          permissions: 31,
        }),
      (err: unknown) => err instanceof NextcloudError && err.status === 997,
    );
  });

  it("leaves the binding's permissions untouched when the caller omits permissions entirely", async () => {
    // Backward-compatible default: existing callers that never pass
    // `permissions` must see byte-for-byte the same call sequence as before
    // Task 11 (already covered above), so this just pins that omitting it
    // does not spuriously issue a permissions call.
    const { calls, fetchImpl } = stubFetch([
      { body: ocs(100, { "3": { id: 3, mount_point: "Org Feuerwehr", groups: [] } }) },
      { body: ocs(100, {}) }, // bind succeeds
    ]);
    const result = await provisioner(fetchImpl).ensureGroupFolder({
      name: "Org Feuerwehr",
      groupId: "org:acc-7:member",
    });
    assert.deepEqual(result, { folderId: 3, created: false });
    assert.equal(calls.length, 2, "no permissions call when permissions is omitted");
  });
});

describe("ensureGroup", () => {
  it("creates a missing group and tolerates the already-exists code", async () => {
    const { fetchImpl } = stubFetch([{ body: ocs(102, null) }]);
    const result = await provisioner(fetchImpl).ensureGroup("org:acc-7:member");
    assert.deepEqual(result, { created: false });
  });

  it("reports created:true for a genuinely new group", async () => {
    // The brief's own test only exercises the 102 "already existed" branch;
    // this pins the other side of that same conditional.
    const { calls, fetchImpl } = stubFetch([{ body: ocs(100, {}) }]);
    const result = await provisioner(fetchImpl).ensureGroup("org:acc-7:member");
    assert.deepEqual(result, { created: true });
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].body ?? "", /groupid=org%3Aacc-7%3Amember/);
  });

  it("throws when group creation genuinely fails", async () => {
    // statuscode 101 is OCS's "invalid input" for group creation — a real
    // failure, not a to-be-tolerated already-exists.
    const { fetchImpl } = stubFetch([{ body: ocs(101, null) }]);
    await assert.rejects(
      () => provisioner(fetchImpl).ensureGroup("org:acc-7:member"),
      (err: unknown) => err instanceof NextcloudError && err.status === 101,
    );
  });
});
