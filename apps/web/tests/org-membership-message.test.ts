import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOrgMessage, hashPayload, MAX_MESSAGE_AGE_SECONDS } from "../src/lib/org-membership/message";

describe("org-membership message", () => {
  it("builds the versioned message with lowercased wallet", () => {
    const msg = buildOrgMessage("accept_invite", "0xABCDEF0000000000000000000000000000000001", 1753900000, { inviteId: "i-1" });
    assert.match(msg, /^roebel-org-v1:accept_invite:0xabcdef0000000000000000000000000000000001:1753900000:[0-9a-f]{64}$/);
  });
  it("payload hash is key-order independent", () => {
    assert.equal(hashPayload({ a: 1, b: "x" }), hashPayload({ b: "x", a: 1 }));
  });
  it("different payloads produce different hashes", () => {
    assert.notEqual(hashPayload({ inviteId: "i-1" }), hashPayload({ inviteId: "i-2" }));
  });
  it("exports the replay window", () => {
    assert.equal(MAX_MESSAGE_AGE_SECONDS, 300);
  });
});
