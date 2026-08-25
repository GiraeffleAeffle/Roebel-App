import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindingStatement,
  buildBindingEvent,
  buildNoteEvent,
  deriveAgentIdentity,
  deriveNostrIdentity,
  type NostrEvent,
} from "@netizen-labs/nostr";

import { emptyHistory } from "../../agent-watcher/src/bounds.ts";
import { watchOnce } from "../../agent-watcher/src/watcher.ts";
import { parseWorkbenchConfig, startWorkbench } from "../../e2e-workbench/src/server.ts";
import {
  createPrivateWorkbenchMeckyMirrorAdapter,
  PRIVATE_WORKBENCH_URL,
} from "../src/workbench-adapter.ts";

test("a participant signed post reaches the real workbench, watcher, and ordinary feed projection", async () => {
  const agent = deriveAgentIdentity(
    "participant-mirror-real-workbench-watcher-test-entropy-0123456789",
    "roebel-staging",
    "mecky",
  );
  const participant = deriveNostrIdentity("0x" + "5".repeat(130));
  const wallet = "0x1111111111111111111111111111111111111111";
  const sourcePostId = "10000000-0000-4000-8000-000000000001";
  const citizenEvents: NostrEvent[] = [];
  const agentEvents: NostrEvent[] = [];
  const relay = (events: NostrEvent[]) => ({
    query: async () => events,
    publish: async (event: NostrEvent) => {
      if (!events.some((entry) => entry.id === event.id)) events.push(event);
      return { ok: true, message: "stored" };
    },
    close: () => {},
  });
  const running = await startWorkbench(parseWorkbenchConfig({
    WORKBENCH_MODE: "public-signed-only",
    MECKY_PUBKEY: agent.publicKey,
    CITIZEN_RELAY_ADMISSION_TOKEN: "r".repeat(40),
    GNOSIS_RPC_URL: "https://rpc.gnosischain.com",
    CITIZEN_RELAY_URL: "ws://citizen-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    AGENT_RELAY_URL: "ws://agent-relay.stadtstack-roebel-e2e.svc.cluster.local:18081",
    WORKBENCH_BIND_HOST: "127.0.0.1",
    WORKBENCH_PORT: "0",
  }), {
    citizenRelay: relay(citizenEvents),
    agentRelay: relay(agentEvents),
    admitPubkey: async (pubkey) => assert.equal(pubkey, participant.publicKey),
    verifyWalletSignature: async ({ address }) => address.toLowerCase() === wallet,
  });
  try {
    const bindingEvent = buildBindingEvent(participant.secretKey, wallet, { createdAt: 1_787_659_199 });
    const event = buildNoteEvent(participant.secretKey, "@Mecky, welche geprüften Informationen liegen vor?", {
      createdAt: 1_787_659_200,
      tags: [["p", agent.publicKey], ["source-app-post", sourcePostId]],
    });
    const adapter = createPrivateWorkbenchMeckyMirrorAdapter({
      url: PRIVATE_WORKBENCH_URL,
      admissionHeader: { name: "x-stadtstack-e2e", value: "1" },
      // The adapter still sees only its pinned in-cluster URL. This test
      // transport redirects that exact test request to the real ephemeral
      // workbench; production receives no caller-selectable transport URL.
      fetch: async (url, init) => {
        const target = new URL(String(url));
        assert.equal(target.origin + "/", PRIVATE_WORKBENCH_URL);
        return fetch(`http://127.0.0.1:${running.port}${target.pathname}`, init);
      },
    });
    const result = await adapter.mirrorPost({
      admissionProof: {
        schemaVersion: "roebel_citizen_admission_proof_v1",
        credential: { kind: "passkey_safe", address: wallet, chainId: 100 },
        statement: bindingStatement({ account: wallet, npub: participant.npub }),
        walletSignature: "0xaaaa",
        bindingEvent,
      },
      event,
    });
    assert.equal(result.eventId, event.id);
    assert.deepEqual(citizenEvents.map((entry) => entry.id), [event.id]);

    const watched = await watchOnce({
      agent,
      history: emptyHistory(),
      relayUrl: "ws://citizen",
      replyRelayUrl: "ws://agent",
      now: () => 1_787_659_240,
      think: async () => "Nach den geprüften Staging-Quellen ist noch keine Entscheidung dokumentiert.",
      makeClient: (url) => url === "ws://citizen" ? relay(citizenEvents) : relay(agentEvents),
    });
    assert.equal(watched.answered, 1);
    assert.equal(agentEvents.length, 1);
    assert.deepEqual(agentEvents[0]?.tags.filter((tag) => tag[0] === "source-app-post"), [
      ["source-app-post", sourcePostId],
    ]);

    const feed = await fetch(`http://127.0.0.1:${running.port}/api/feed?profile=public`).then(
      (response) => response.json(),
    ) as { posts: Array<{ id: string; sourceAppPostId: string | null; meckyAnswered: boolean }> };
    assert.deepEqual(feed.posts.find((post) => post.id === event.id), {
      id: event.id,
      sourceAppPostId: sourcePostId,
      meckyAnswered: true,
    });
  } finally {
    await running.close();
  }
});
