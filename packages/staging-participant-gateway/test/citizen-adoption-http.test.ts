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

function request(body: unknown, sessionToken: string) {
  return new Request(
    "https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/citizen-adoption/challenge",
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

test("HTTP derives the wallet and session binding for an eligibility challenge instead of accepting them from the browser", async () => {
  const issued = issueSession(WALLET, NOW_SECONDS * 1_000, SESSION_KEY);
  let serviceInput: unknown = null;
  let eligibilityInput: unknown = null;
  let adoptionInput: unknown = null;
  let publicReadInput: unknown = null;
  const adoptionProjection = {
    schemaVersion: "public_citizen_adoption_projection_v1",
    participantSuggestionId: SUGGESTION_ID,
    marker: "durable-public-projection",
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
    citizenAdoption: {
      async issueEligibilityChallenge(input: unknown) {
        serviceInput = input;
        return {
          schemaVersion: "municipal_civic_eligibility_challenge_v1",
          challengeId: "1".repeat(32),
          audience: "roebel-staging-citizen-adoption",
          sessionBindingSha256: createHash("sha256")
            .update(issued.token, "utf8")
            .digest("hex"),
          walletAddress: WALLET,
          chainId: 100,
          subjectPubkey: SUBJECT_PUBKEY,
          municipalityId: "roebel-mueritz",
          policyVersion: "roebel-citizen-nft-v2-staging-2026-09",
          participantSuggestionId: SUGGESTION_ID,
          topicId:
            "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
          issuedAt: NOW_SECONDS,
          expiresAt: NOW_SECONDS + 300,
          authorityBinding: "civic_eligibility_only",
          canonicalChallenge: "signed challenge",
          message: "signed challenge",
        } as const;
      },
      async issueEligibilityReceipt(input: any) {
        eligibilityInput = input;
        if (input.walletSignature === "0xbbbb") {
          throw new Error("citizen_eligibility_active_citizen_nft_required");
        }
        return {
          schemaVersion: "municipal_civic_eligibility_issuance_v1",
          eligibilityReceipt: { receiptId: "receipt" },
          eligibilityPolicy: { policyVersion: "policy" },
          authorityBinding: "civic_eligibility_only",
        } as never;
      },
      async acceptAdoption(input: unknown) {
        adoptionInput = input;
        return adoptionProjection as never;
      },
      async readPublicAdoption(input: unknown) {
        publicReadInput = input;
        return adoptionProjection as never;
      },
    } as never,
    now: () => new Date(NOW_SECONDS * 1_000),
  });

  const response = await handler(
    request(
      {
        schemaVersion: "citizen_adoption_eligibility_challenge_request_v1",
        participantSuggestionId: SUGGESTION_ID,
        subjectPubkey: SUBJECT_PUBKEY,
      },
      issued.token,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(serviceInput, {
    walletAddress: WALLET,
    sessionBindingSha256: createHash("sha256")
      .update(issued.token, "utf8")
      .digest("hex"),
    participantSuggestionId: SUGGESTION_ID,
    subjectPubkey: SUBJECT_PUBKEY,
  });
  const payload = await response.json() as { schemaVersion: string };
  assert.equal(
    payload.schemaVersion,
    "municipal_civic_eligibility_challenge_v1",
  );

  const override = await handler(
    request(
      {
        schemaVersion: "citizen_adoption_eligibility_challenge_request_v1",
        participantSuggestionId: SUGGESTION_ID,
        subjectPubkey: SUBJECT_PUBKEY,
        walletAddress: WALLET,
        sessionBindingSha256: "f".repeat(64),
      },
      issued.token,
    ),
  );
  assert.equal(override.status, 400);

  const proofEvent = buildNoteEvent(
    new Uint8Array(32).fill(9),
    "signed challenge",
    {
      createdAt: NOW_SECONDS,
      tags: [
        ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
        ["challenge", "1".repeat(32)],
        ["e", SUGGESTION_ID, "", "eligibility-for-suggestion"],
        ["municipality", "roebel-mueritz"],
      ],
    },
  );
  const eligibility = await handler(
    new Request(
      "https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/citizen-adoption/eligibility",
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${issued.token}`,
        },
        body: JSON.stringify({
          schemaVersion: "citizen_adoption_eligibility_proof_request_v1",
          challengeId: "1".repeat(32),
          walletSignature: "0xaaaa",
          nostrProofEvent: proofEvent,
        }),
      },
    ),
  );
  assert.equal(eligibility.status, 201);
  assert.deepEqual(eligibilityInput, {
    walletAddress: WALLET,
    sessionBindingSha256: createHash("sha256")
      .update(issued.token, "utf8")
      .digest("hex"),
    challengeId: "1".repeat(32),
    walletSignature: "0xaaaa",
    nostrProofEvent: proofEvent,
  });

  const inactive = await handler(
    new Request(
      "https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/citizen-adoption/eligibility",
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${issued.token}`,
        },
        body: JSON.stringify({
          schemaVersion: "citizen_adoption_eligibility_proof_request_v1",
          challengeId: "1".repeat(32),
          walletSignature: "0xbbbb",
          nostrProofEvent: proofEvent,
        }),
      },
    ),
  );
  assert.equal(inactive.status, 403);
  assert.deepEqual(await inactive.json(), {
    error: "citizen_eligibility_active_citizen_nft_required",
  });

  const adoptionRequest = {
    schemaVersion: "citizen_topic_suggestion_adoption_request_v1",
    requestId: "20000000-0000-4000-8000-000000000004",
    idempotencyKey: "adoption-20000000-0000-4000-8000-000000000004",
    adoptionEvent: proofEvent,
  } as const;
  const adoption = await handler(
    new Request(
      "https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/citizen-adoption/adoptions",
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${issued.token}`,
        },
        body: JSON.stringify(adoptionRequest),
      },
    ),
  );
  assert.equal(adoption.status, 200);
  assert.deepEqual(adoptionInput, adoptionRequest);
  assert.deepEqual(await adoption.json(), adoptionProjection);

  const publicRead = await handler(
    new Request(
      `https://participant-gateway.staging.agentcart.eu/api/staging-participant/v1/citizen-adoption/by-suggestion/${SUGGESTION_ID}/adopter/${SUBJECT_PUBKEY}`,
    ),
  );
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicReadInput, {
    participantSuggestionId: SUGGESTION_ID,
    adopterPubkey: SUBJECT_PUBKEY,
  });
  assert.deepEqual(await publicRead.json(), adoptionProjection);

  const reservedStatus = await handler(
    new Request(
      `https://participant-gateway.staging.agentcart.eu/api/civic/v1/eligibility/status/${"e".repeat(64)}`,
    ),
  );
  assert.equal(reservedStatus.status, 503);
  assert.deepEqual(await reservedStatus.json(), {
    error: "citizen_eligibility_status_not_activated",
  });
});
