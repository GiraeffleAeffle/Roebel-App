import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshGroupsFromUserinfo, mergeRefreshedSession } from "../src/lib/workspace/context";

const base = { sub: "0xabc", groups: ["citizen", "org:a-1:member"], accessToken: "old", refreshToken: "r", expiresAt: 1 };
const tokens = { accessToken: "new", refreshToken: "r2", expiresAt: 999 };

describe("mergeRefreshedSession", () => {
  it("adopts fresh groups when userinfo succeeded", () => {
    const s = mergeRefreshedSession(base, tokens, ["citizen"]);
    assert.deepEqual(s.groups, ["citizen"]);           // org:a-1 revoked → gone
    assert.equal(s.accessToken, "new");
  });
  it("keeps old groups when userinfo failed (null)", () => {
    assert.deepEqual(mergeRefreshedSession(base, tokens, null).groups, base.groups);
  });
  // Present-and-empty is a legitimate revocation answer — a citizen who now
  // belongs to zero groups — and must overwrite, not be mistaken for "no
  // answer". Distinguishing this from an absent claim is freshGroupsFromUserinfo's
  // job (see below); this only confirms mergeRefreshedSession itself treats
  // [] as adopt-worthy, same as any other non-null value.
  it("overwrites to [] when the fresh answer is present-and-empty, not treated as no-answer", () => {
    assert.deepEqual(mergeRefreshedSession(base, tokens, []).groups, []);
  });
});

// THE IMPORTANT FIX: groupsFrom conflates absent-with-empty — it returns []
// both when userinfo has no `groups` key at all and when the key is present
// but empty. Feeding that straight into the refresh branch would silently
// wipe org/citizen access on any userinfo response missing the key (a
// keystone variant, or a malformed 200) — exactly the lockout this task
// exists to prevent. freshGroupsFromUserinfo distinguishes the two so only a
// claim that is actually present overwrites the session's groups.
describe("freshGroupsFromUserinfo", () => {
  it("returns null when the groups key is absent — must NOT read as revoke-everything", () => {
    assert.equal(freshGroupsFromUserinfo({ sub: "0xabc" }, "0xabc"), null);
  });
  it("returns null when userinfo describes a different sub than the session", () => {
    assert.equal(
      freshGroupsFromUserinfo({ sub: "0xdef", groups: ["citizen"] }, "0xabc"),
      null,
    );
  });
  it("returns [] when the claim is present and genuinely empty — a real revocation answer", () => {
    assert.deepEqual(freshGroupsFromUserinfo({ sub: "0xabc", groups: [] }, "0xabc"), []);
  });
  it("returns the list when the claim is present and non-empty", () => {
    assert.deepEqual(
      freshGroupsFromUserinfo({ sub: "0xabc", groups: ["citizen"] }, "0xabc"),
      ["citizen"],
    );
  });
  it("matches sub case-insensitively, like the rest of the session's sub comparisons", () => {
    assert.deepEqual(
      freshGroupsFromUserinfo({ sub: "0xABC", groups: ["citizen"] }, "0xabc"),
      ["citizen"],
    );
  });
});
