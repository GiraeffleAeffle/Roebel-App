import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

// supabase-invites.ts imports the Supabase client singleton (../lib/supabase),
// which throws at import time if NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY aren't set. Stub them before the dynamic
// import in `before()` below so this test doesn't depend on real credentials
// being present in the environment — normalizeInviteRpcRow never touches the
// network. Dynamic (not static) import is required: it must run after the
// env vars are set, and top-level await isn't available under this file's
// CJS transform.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";

let normalizeInviteRpcRow: (data: unknown) => unknown;

before(async () => {
  ({ normalizeInviteRpcRow } = await import("../src/lib/supabase-invites"));
});

describe("normalizeInviteRpcRow", () => {
  it("treats an all-NULL composite row (unknown token) as not-found", () => {
    // What get_invite_by_token actually returns for a token with no match:
    // `returns invite_tokens` is a single-row composite, not SETOF, so
    // PostgREST hands back a truthy object with every column null instead
    // of null itself.
    assert.equal(
      normalizeInviteRpcRow({
        id: null,
        account_id: null,
        role: null,
        invited_by: null,
        invited_wallet: null,
        token: null,
        status: null,
        expires_at: null,
        created_at: null,
      }),
      null
    );
  });

  it("returns a real row untouched when id is present", () => {
    const row = { id: "invite-1", token: "abc", status: "pending" };
    assert.deepEqual(normalizeInviteRpcRow(row), row);
  });

  it("returns null for a literal null result", () => {
    assert.equal(normalizeInviteRpcRow(null), null);
  });

  it("unwraps an array result defensively (in case the RPC ever becomes SETOF)", () => {
    const row = { id: "invite-2", token: "xyz" };
    assert.deepEqual(normalizeInviteRpcRow([row]), row);
  });

  it("treats an empty array as not-found", () => {
    assert.equal(normalizeInviteRpcRow([]), null);
  });
});
