import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextcloudError } from "../src/nextcloud";
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
    // statuscode 104 is OCS's "no permission" — a real failure carried inside
    // an HTTP 200. Silently returning created:true here would tell a caller
    // the citizen has a workspace home when they do not.
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

  // --- Gap: partially-created folder when the group binding fails ---
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
      { body: ocs(100, {}) },
      { body: ocs(100, { id: 9 }) },
      { body: ocs(997, null) },
    ]);
    await assert.rejects(
      () =>
        provisioner(fetchImpl).ensureGroupFolder({
          name: "Org Feuerwehr",
          groupId: "org:acc-7:member",
        }),
      (err: unknown) => err instanceof NextcloudError && err.status === 997,
    );
    assert.equal(calls.length, 3, "the folder-create call still happened — this is the orphan case");
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
