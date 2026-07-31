import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRefreshedSession } from "../src/lib/workspace/context";

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
});
