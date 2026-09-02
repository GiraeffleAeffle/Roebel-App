import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildNoteEvent } from "@netizen-labs/nostr";

import { createStagingParticipantGatewayHandler } from "../src/http.ts";
import { issueSession, SESSION_COOKIE } from "../src/protocol.ts";

const ORIGIN = "https://roebel-web.staging.agentcart.eu";
const WALLET = "0x1111111111111111111111111111111111111111";
const SESSION_KEY = "k".repeat(32);
const SUBJECT_PUBKEY = "a".repeat(64);
const SUGGESTION_ID = "b".repeat(64);
const NOW_SECONDS = 1_788_264_000;

function post(path: string, body: unknown, sessionToken: string) {
  return new Request(
    `https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/${path}`,
    {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${sessionToken}`,
      },
      body: JSON.stringify(body),
    },
  );
}

test("HTTP keeps the synthetic test-pass challenge, tracer and public read on separate routes", async () => {
  const issued = issueSession(WALLET, NOW_SECONDS * 1_000, SESSION_KEY);
  const sessionBindingSha256 = createHash("sha256")
    .update(issued.token, "utf8")
    .digest("hex");
  let challengeInput: unknown = null;
  let tracerInput: unknown = null;
  let publicReadInput: unknown = null;
  const challenge = {
    schemaVersion: "staging_test_citizen_pass_v1",
    challengeId: "1".repeat(32),
    message: "synthetic test pass challenge",
  } as const;
  const projection = {
    schemaVersion: "public_synthetic_citizen_adoption_projection_v1",
    participantSuggestionId: SUGGESTION_ID,
    environment: "staging",
    testOnly: true,
    authorityBinding: "none",
  } as const;
  const handler = createStagingParticipantGatewayHandler({
    config: {
      origin: ORIGIN,
      sessionHmacKey: SESSION_KEY,
      inviteSha256: "c".repeat(64),
      allowedWallets: [WALLET],
      cookieSecure: true,
      meckyPubkey: "d".repeat(64),
      topicPolicy: {
        municipalityId: "roebel-mueritz",
        topicNamespace: "urn:stadtstack:topic:municipality:roebel-mueritz",
        sourceConversationTopic: "roebel-app-conversation",
        policyVersion: "staging-participant-topic-v1",
      },
    },
    verifier: { async verifyWalletSignature() { return true; } },
    data: {} as never,
    mirror: {} as never,
    syntheticCitizenAdoption: {
      async preflight() {
        throw new Error("not_used_by_public_route_test");
      },
      async issueChallenge(input: unknown) {
        challengeInput = input;
        return challenge as never;
      },
      async acceptTracer(input: unknown) {
        tracerInput = input;
        return projection as never;
      },
      async readPublicTracer(input: unknown) {
        publicReadInput = input;
        return projection as never;
      },
    },
    now: () => new Date(NOW_SECONDS * 1_000),
  });

  const challengeResponse = await handler(post(
    "synthetic-citizen-adoption/challenge",
    {
      schemaVersion: "synthetic_citizen_adoption_challenge_request_v1",
      participantSuggestionId: SUGGESTION_ID,
      subjectPubkey: SUBJECT_PUBKEY,
    },
    issued.token,
  ));
  assert.equal(challengeResponse.status, 200);
  assert.deepEqual(challengeInput, {
    walletAddress: WALLET,
    sessionBindingSha256,
    participantSuggestionId: SUGGESTION_ID,
    subjectPubkey: SUBJECT_PUBKEY,
  });

  const proofEvent = buildNoteEvent(
    new Uint8Array(32).fill(9),
    "synthetic test pass challenge",
    { createdAt: NOW_SECONDS },
  );
  const request = {
    schemaVersion: "synthetic_citizen_adoption_tracer_request_v1",
    requestId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "synthetic-adoption.request-1",
    challengeId: "1".repeat(32),
    walletSignature: "0x1234",
    nostrProofEvent: proofEvent,
  } as const;
  const tracerResponse = await handler(post(
    "synthetic-citizen-adoption/tracers",
    request,
    issued.token,
  ));
  assert.equal(tracerResponse.status, 200);
  assert.deepEqual(tracerInput, {
    walletAddress: WALLET,
    sessionBindingSha256,
    request,
  });
  assert.deepEqual(await tracerResponse.json(), projection);

  const publicRead = await handler(new Request(
    `https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/synthetic-citizen-adoption/by-suggestion/${SUGGESTION_ID}/adopter/${SUBJECT_PUBKEY}`,
  ));
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicReadInput, {
    participantSuggestionId: SUGGESTION_ID,
    adopterPubkey: SUBJECT_PUBKEY,
  });
  assert.deepEqual(await publicRead.json(), projection);

  const syntheticOnRealRoute = await handler(post(
    "citizen-adoption/adoptions",
    request,
    issued.token,
  ));
  assert.equal(syntheticOnRealRoute.status, 400);
  assert.deepEqual(await syntheticOnRealRoute.json(), {
    error: "citizen_adoption_request_invalid",
  });
});
