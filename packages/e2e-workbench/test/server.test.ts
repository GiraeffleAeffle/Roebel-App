import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublicKeyHex } from "@netizen-labs/nostr";
import { parseWorkbenchConfig, startWorkbench } from "../src/server";

const one = "11".repeat(32);
const two = "22".repeat(32);
const mecky = getPublicKeyHex(Uint8Array.from(Buffer.from("33".repeat(32), "hex")));

function environment() {
  return {
    SYNTHETIC_CITIZENS_JSON: JSON.stringify([
      { id: "citizen-anna", name: "Anna (synthetisch)", secretKeyHex: one },
      { id: "citizen-omar", name: "Omar (synthetisch)", secretKeyHex: two },
    ]),
    MECKY_PUBKEY: mecky,
    CASE_STEWARD_TOKEN: "x".repeat(40),
    CITIZEN_RELAY_URL: "ws://citizen-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    AGENT_RELAY_URL: "ws://agent-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_CONTROL_BASE_URL: "http://stadtstack-control.stadtstack-roebel-e2e.svc.cluster.local:18081",
    STADTSTACK_PUBLIC_BASE_URL: "http://stadtstack-public.stadtstack-roebel-e2e.svc.cluster.local:18080",
    WORKBENCH_BIND_HOST: "127.0.0.1",
    WORKBENCH_PORT: "0",
  };
}

describe("Röbel E2E workbench boundary", () => {
  it("accepts only the exact isolated service topology and two synthetic citizens", () => {
    const config = parseWorkbenchConfig(environment());
    assert.equal(config.personas.length, 2);
    assert.notEqual(config.personas[0]?.publicKey, config.personas[1]?.publicKey);
    assert.equal(config.agentRelayUrl.includes("agent-relay.stadtstack-roebel-e2e"), true);
    assert.throws(() => parseWorkbenchConfig({ ...environment(), CITIZEN_RELAY_URL: "wss://relay.roebel.app" }));
    assert.throws(() => parseWorkbenchConfig({ ...environment(), SYNTHETIC_CITIZENS_JSON: "[]" }));
  });

  it("accepts the owned staging-preview namespace but rejects every production relay and arbitrary namespace", () => {
    const staging = Object.fromEntries(
      Object.entries(environment()).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replaceAll("stadtstack-roebel-e2e", "stadtstack-roebel-web-preview") : value,
      ]),
    );
    assert.equal(parseWorkbenchConfig(staging).citizenRelayUrl.includes("stadtstack-roebel-web-preview"), true);
    assert.throws(() => parseWorkbenchConfig({ ...staging, CITIZEN_RELAY_URL: "wss://relay.roebel.app" }));
    assert.throws(() => parseWorkbenchConfig({ ...staging, CITIZEN_RELAY_URL: "ws://citizen-relay.default.svc.cluster.local:18081" }));
  });

  it("serves a local-only accessible workflow UI without exposing private keys", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = { query: async () => [], publish: async () => ({ ok: true, message: "stored" }), close: () => {} };
    const running = await startWorkbench(config, { citizenRelay: relay, agentRelay: relay });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const html = await fetch(origin).then((response) => response.text());
      assert.match(html, /Bürgerdiskussion/);
      assert.match(html, /Pi 0\.84\.1/);
      assert.doesNotMatch(html, new RegExp(one));
      const publicConfig = await fetch(`${origin}/api/config`).then((response) => response.json()) as { personas: Array<Record<string, unknown>> };
      assert.equal(publicConfig.personas.length, 2);
      assert.equal(publicConfig.personas.some((entry) => "secretKeyHex" in entry), false);
    } finally {
      await running.close();
    }
  });

  it("serves the workflow beneath the staging ingress prefix without root-relative API leaks", async () => {
    const config = parseWorkbenchConfig(environment());
    const relay = { query: async () => [], publish: async () => ({ ok: true, message: "stored" }), close: () => {} };
    const running = await startWorkbench(config, { citizenRelay: relay, agentRelay: relay });
    try {
      const origin = `http://127.0.0.1:${running.port}`;
      const response = await fetch(`${origin}/stadtstack-test/`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /const base='\/stadtstack-test'/);
      assert.match(html, /api\(base\+'\/api\/config'/);
      assert.doesNotMatch(html, /api\('\/api\/config'/);

      const publicConfig = await fetch(`${origin}/stadtstack-test/api/config`).then((entry) => entry.json()) as { authorityBinding: string };
      assert.equal(publicConfig.authorityBinding, "none");
      const health = await fetch(`${origin}/stadtstack-test/healthz`).then((entry) => entry.json()) as { mode: string };
      assert.equal(health.mode, "synthetic-e2e");
    } finally {
      await running.close();
    }
  });
});
