import assert from "node:assert/strict";
import { it } from "node:test";

import { buildCivicDiscussionEvent, deriveNostrSecretKey } from "@netizen-labs/nostr";

import { createStadtstackNostrIntakeClient } from "../src/stadtstack-control";

const citizen = deriveNostrSecretKey(`0x${"7a".repeat(65)}`);

it("posts the exact signed discussion through the actor-bound internal route", async () => {
  const event = buildCivicDiscussionEvent(citizen, {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: "a".repeat(64),
    content: "@Mecky Was sagen die geprüften Unterlagen?",
    createdAt: 1_786_454_400,
  });
  const calls: { input: URL | RequestInfo; init?: RequestInit }[] = [];
  const client = createStadtstackNostrIntakeClient({
    baseUrl: "http://stadtstack-control.stadtstack-system.svc.cluster.local:18081",
    actorToken: `token-${"x".repeat(40)}`,
    fetch: async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        caseVersion: 2,
        eventIds: ["a".repeat(64), "b".repeat(64)],
        journalHeadChecksum: `sha256:${"c".repeat(64)}`,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const receipt = await client.ingestDiscussion(event, ["wss://relay.roebel.app"]);

  assert.deepEqual(receipt, {
    caseVersion: 2,
    eventIds: ["a".repeat(64), "b".repeat(64)],
    journalHeadChecksum: `sha256:${"c".repeat(64)}`,
  });
  assert.equal(String(calls[0]!.input), "http://stadtstack-control.stadtstack-system.svc.cluster.local:18081/v1/nostr/discussions");
  assert.deepEqual(calls[0]!.init?.headers, {
    authorization: `Bearer token-${"x".repeat(40)}`,
    "content-type": "application/json",
    "x-stadtstack-actor-id": "roebel:nostr-ingestor",
  });
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    event,
    relayRefs: ["wss://relay.roebel.app"],
  });
});

it("fails closed on public HTTP targets, unknown response shapes, and non-success status", async () => {
  assert.throws(() => createStadtstackNostrIntakeClient({
    baseUrl: "http://example.org",
    actorToken: `token-${"x".repeat(40)}`,
  }), /stadtstack_control_url_invalid/);

  const invalid = createStadtstackNostrIntakeClient({
    baseUrl: "https://stadtstack.example.org",
    actorToken: `token-${"x".repeat(40)}`,
    fetch: async () => new Response(JSON.stringify({ caseVersion: 2, admitted: true }), { status: 200 }),
  });
  const event = buildCivicDiscussionEvent(citizen, {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: "a".repeat(64),
    content: "@Mecky Test",
    createdAt: 1_786_454_400,
  });
  await assert.rejects(invalid.ingestDiscussion(event, []), /stadtstack_control_response_invalid/);

  const rejected = createStadtstackNostrIntakeClient({
    baseUrl: "https://stadtstack.example.org",
    actorToken: `token-${"x".repeat(40)}`,
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(rejected.ingestDiscussion(event, []), /stadtstack_control_unavailable/);
});
