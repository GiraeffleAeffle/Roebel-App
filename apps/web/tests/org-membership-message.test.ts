import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildOrgMessage, hashPayload, MAX_MESSAGE_AGE_SECONDS } from "../src/lib/org-membership/message";
import { requestBody } from "../src/lib/org-membership/client";

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
  it("sorts keys ordinally (byte order), not locale-aware", () => {
    // Ordinal: "B" (0x42) < "a" (0x61). Locale-aware collation would put "a" first.
    const expectedHash = createHash("sha256").update('{"B":2,"a":1}').digest("hex");
    assert.equal(hashPayload({ a: 1, B: 2 }), expectedHash);
    const msg = buildOrgMessage("leave", "0xABCDEF0000000000000000000000000000000001", 1753900000, { a: 1, B: 2 });
    const msgManual = buildOrgMessage("leave", "0xABCDEF0000000000000000000000000000000001", 1753900000, Object.fromEntries([["B",2],["a",1]]));
    assert.equal(msg, msgManual);
  });
});

it("requestBody signs the canonical message and echoes fields", async () => {
  const fake = { address: "0xABCDEF0000000000000000000000000000000001",
                 signMessage: async ({ message }: { message: string }) => `sig:${message.slice(0, 20)}` };
  const body = await requestBody(fake, "leave", { accountId: "a-1" }, 1753900000);
  assert.equal(body.action, "leave");
  assert.equal(body.wallet, "0xabcdef0000000000000000000000000000000001");
  assert.equal(body.timestampSec, 1753900000);
  assert.match(body.signature, /^sig:roebel-org-v1:leave/);
});
