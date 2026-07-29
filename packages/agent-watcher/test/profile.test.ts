import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentOf, deriveAgentIdentity, isAgentEvent, verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { announceAgentProfile } from "../src/profile";

const MECKY = deriveAgentIdentity("a-node-secret-with-plenty-of-entropy-0123456789", "roebel", "mecky");

function harness(result: { ok: boolean; message: string } = { ok: true, message: "" }) {
  const published: NostrEvent[] = [];
  const logs: string[] = [];
  let closed = 0;
  return {
    published,
    logs,
    closed: () => closed,
    deps: {
      agent: MECKY,
      relayUrl: "ws://relay",
      metadata: { name: "Mecky", about: "KI-Assistent" },
      log: (m: string) => logs.push(m),
      makeClient: () => ({
        publish: async (event: NostrEvent) => {
          published.push(event);
          return result;
        },
        close: () => {
          closed += 1;
        },
      }),
    },
  };
}

describe("announceAgentProfile", () => {
  it("publishes a signed, verifiable kind 0 for the agent", async () => {
    const h = harness();
    const ok = await announceAgentProfile(h.deps);

    assert.equal(ok, true);
    assert.equal(h.published.length, 1);
    const event = h.published[0];
    assert.equal(event.kind, 0);
    assert.equal(event.pubkey, MECKY.publicKey);
    assert.equal(verifyEvent(event), true);
  });

  it("labels the profile as machine-authored, which is the whole point", async () => {
    const h = harness();
    await announceAgentProfile(h.deps);

    const event = h.published[0];
    // NIP-24 `bot` is what a generic Nostr client reads...
    assert.equal(JSON.parse(event.content).bot, true);
    // ...and the agent tag is what names which agent, on which node.
    assert.equal(isAgentEvent(event), true);
    assert.deepEqual(agentOf(event), { name: "mecky", nodeId: "roebel" });
  });

  it("carries the supplied display metadata", async () => {
    const h = harness();
    await announceAgentProfile(h.deps);

    const content = JSON.parse(h.published[0].content);
    assert.equal(content.name, "Mecky");
    assert.equal(content.about, "KI-Assistent");
  });

  it("reports a relay rejection without throwing", async () => {
    // The realistic cause is the agent's key missing from the allow-list — a real
    // misconfiguration, so it must be named rather than swallowed.
    const h = harness({ ok: false, message: "blocked: not on allow-list" });
    const ok = await announceAgentProfile(h.deps);

    assert.equal(ok, false);
    assert.ok(h.logs.some((l) => l.includes("not on allow-list")));
  });

  it("survives a relay that throws, because a missed introduction is not an outage", async () => {
    const h = harness();
    const ok = await announceAgentProfile({
      ...h.deps,
      makeClient: () => ({
        publish: async () => {
          throw new Error("connection refused");
        },
        close: () => {},
      }),
    });

    assert.equal(ok, false);
    assert.ok(h.logs.some((l) => l.includes("connection refused")));
  });

  it("closes the socket on both success and failure", async () => {
    const good = harness();
    await announceAgentProfile(good.deps);
    assert.equal(good.closed(), 1);

    const bad = harness({ ok: false, message: "nope" });
    await announceAgentProfile(bad.deps);
    assert.equal(bad.closed(), 1);
  });
});
