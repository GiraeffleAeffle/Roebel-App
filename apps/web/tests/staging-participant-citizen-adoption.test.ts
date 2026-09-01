import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  buildAgentNoteEvent,
  buildCitizenTopicSuggestionAdoption,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  getPublicKeyHex,
  municipalCivicEligibilityReceiptProofPublicKey,
  signMunicipalCivicEligibilityReceiptProof,
} from "@netizen-labs/nostr";

import {
  adoptStagingParticipantSuggestion,
  CitizenAdoptionClientError,
  loadPublicCitizenAdoption,
  type PublicCitizenAdoptionProjection,
} from "../src/lib/staging-participant/citizen-adoption.ts";

const originalFetch = globalThis.fetch;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function citizenAdoptionFixture(
  adopterByte = 4,
  baseTime = Math.floor(Date.now() / 1_000) - 5
) {
  const participantSecret = new Uint8Array(32).fill(2);
  const meckySecret = new Uint8Array(32).fill(3);
  const adopterSecret = new Uint8Array(32).fill(adopterByte);
  const meckyPubkey = getPublicKeyHex(meckySecret);
  const topicId = "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt";
  const sourcePost = buildNoteEvent(participantSecret, "Treffpunkt", {
    createdAt: baseTime,
  });
  const discussion = buildCivicTopicPromotionEvent(participantSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Treffpunkt",
    agentPubkey: meckyPubkey,
    content: "@Mecky, welche geprüften Optionen gibt es?",
    createdAt: baseTime + 1,
  });
  const answer = buildAgentNoteEvent(
    {
      name: "mecky",
      nodeId: "roebel",
      secretKey: meckySecret,
      publicKey: meckyPubkey,
      npub: "npub1test",
    },
    "Geprüfte Antwort",
    {
      createdAt: baseTime + 2,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", `urn:stadtstack:mecky-answer:${"6".repeat(64)}`],
        ["municipality", "roebel-mueritz"],
        ["topic", topicId],
        [
          "evidence",
          `sha256:${"7".repeat(64)}`,
          "https://stadtstack.example/public/reviewed-source",
        ],
      ],
    }
  );
  const participantSuggestion = buildParticipantTopicSuggestion(
    participantSecret,
    {
      binding: { municipalityId: "roebel-mueritz", topicId },
      sourcePost,
      sourceDiscussion: discussion,
      sourceAnswer: answer,
      agentPubkey: meckyPubkey,
      title: "Treffpunkt prüfen",
      summary: "Die Optionen sollen nachvollziehbar geprüft werden.",
      createdAt: baseTime + 3,
    }
  );
  const eligibilityCore = {
    municipalityId: "roebel-mueritz",
    eligibilityClass: "municipal_civic_participation" as const,
    subjectPubkey: getPublicKeyHex(adopterSecret),
    participantSuggestionId: participantSuggestion.suggestionId,
    topicId,
    policyVersion: "roebel-civic-eligibility-2026-09",
    issuer: "roebel-citizen-verifier",
    issuedAt: baseTime + 4,
    expiresAt: baseTime + 304,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const eligibilityChecksum = checksum(eligibilityCore);
  const statusBaseUrl =
    "https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility";
  const proofInput = {
    domain: "municipal-civic-eligibility-receipt/v1" as const,
    schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${eligibilityChecksum}`,
    payloadChecksum: eligibilityChecksum,
    statusRef: `${statusBaseUrl}/${eligibilityChecksum}`,
  };
  const issuerPrivateKey = new Uint8Array(32).fill(5);
  const issuerKeyId = "roebel-citizen-verifier-2026-09";
  const eligibilityReceipt = {
    schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
    eligibilityCore,
    receiptId: proofInput.receiptId,
    payloadChecksum: eligibilityChecksum,
    statusRef: proofInput.statusRef,
    proof: signMunicipalCivicEligibilityReceiptProof(proofInput, {
      privateKey: issuerPrivateKey,
      keyId: issuerKeyId,
    }),
  };
  const adoption = buildCitizenTopicSuggestionAdoption(adopterSecret, {
    participantSuggestion,
    eligibilityReceipt,
    eligibilityPolicy: {
      municipalityId: "roebel-mueritz",
      policyVersion: "roebel-civic-eligibility-2026-09",
      issuer: "roebel-citizen-verifier",
      statusBaseUrl,
      verifiedAt: baseTime + 5,
      verifyReceiptProof: () => true,
    },
    createdAt: baseTime + 5,
  });
  const requestChecksum = checksum({
    schemaVersion: "citizen_topic_suggestion_adoption_request_v1",
    adoptionEvent: adoption.event,
  });
  const acceptanceCore = {
    schemaVersion:
      "citizen_topic_suggestion_adoption_acceptance_receipt_v1" as const,
    adoptionId: adoption.adoptionId,
    adoptionEventId: adoption.event.id,
    municipalityId: "roebel-mueritz",
    topicId,
    participantSuggestionId: participantSuggestion.suggestionId,
    adopterPubkey: adoption.signerPubkey,
    eligibilityReceiptId: eligibilityReceipt.receiptId,
    requestChecksum,
    eventCreatedAt: adoption.event.created_at,
    receivedAt: adoption.event.created_at,
    policyVersion: "roebel-civic-eligibility-2026-09",
    status: "accepted" as const,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const projection: PublicCitizenAdoptionProjection = {
    schemaVersion: "public_citizen_adoption_projection_v1",
    participantSuggestionId: participantSuggestion.suggestionId,
    adoptionEvent: adoption.event,
    eligibilityReceipt,
    acceptanceReceipt: {
      ...acceptanceCore,
      receiptChecksum: checksum(acceptanceCore),
    },
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
    administrativeEndorsement: false,
    bindingVote: false,
    councilDecision: false,
    treasuryEffect: false,
    paymentEffect: false,
  };
  return {
    adopterSecret,
    participantSuggestion,
    projection,
    issuance: {
      schemaVersion: "municipal_civic_eligibility_issuance_v1" as const,
      eligibilityReceipt,
      eligibilityPolicy: {
        schemaVersion: "municipal_civic_eligibility_public_policy_v1" as const,
        municipalityId: "roebel-mueritz",
        policyVersion: "roebel-civic-eligibility-2026-09",
        issuer: "roebel-citizen-verifier",
        statusBaseUrl,
        verifiedAt: baseTime + 5,
        proof: {
          algorithm: "Ed25519" as const,
          keyId: issuerKeyId,
          publicKey:
            municipalCivicEligibilityReceiptProofPublicKey(issuerPrivateKey),
        },
      },
      authorityBinding: "civic_eligibility_only" as const,
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("reloads the public citizen adoption from the credential-free suggestion projection", async () => {
  const { projection: expected } = citizenAdoptionFixture();
  let requested: { path: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    requested = { path: String(input), init };
    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const projection = await loadPublicCitizenAdoption(
    expected.participantSuggestionId,
    expected.adoptionEvent.pubkey
  );

  assert.deepEqual(projection, expected);
  assert.equal(
    requested?.path,
    `/api/staging-participant/v1/citizen-adoption/by-suggestion/${expected.participantSuggestionId}/adopter/${expected.adoptionEvent.pubkey}`
  );
  assert.equal(requested?.init?.cache, "no-store");
  assert.equal(requested?.init?.credentials, "same-origin");
  assert.equal(requested?.init?.method, undefined);
});

test("a user-initiated retry recovers the durable adoption when browser storage is empty", async () => {
  const fixture = citizenAdoptionFixture();
  const subjectPubkey = fixture.projection.adoptionEvent.pubkey;
  let challengeRequests = 0;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    paths.push(path);
    if (path.endsWith("/challenge")) challengeRequests += 1;
    return new Response(JSON.stringify(fixture.projection), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const session = {
    async getNostrPubkey() {
      return subjectPubkey;
    },
    async signMessage() {
      throw new Error("wallet_signature_must_not_be_requested");
    },
    async signCitizenEligibilityChallenge() {
      throw new Error("nostr_challenge_must_not_be_requested");
    },
    async signCitizenTopicSuggestionAdoption() {
      throw new Error("adoption_signature_must_not_be_requested");
    },
  };

  const recovered = await adoptStagingParticipantSuggestion({
    participantSuggestion: fixture.participantSuggestion,
    session,
  });

  assert.deepEqual(recovered, fixture.projection);
  assert.deepEqual(paths, [
    `/api/staging-participant/v1/citizen-adoption/by-suggestion/${fixture.participantSuggestion.suggestionId}/adopter/${subjectPubkey}`,
  ]);
  assert.equal(challengeRequests, 0);
});

test("the active citizen signs the exact wallet, Nostr, and immutable adoption sequence", async () => {
  const fixture = citizenAdoptionFixture();
  const subjectPubkey = fixture.projection.adoptionEvent.pubkey;
  const issuedAt = fixture.issuance.eligibilityReceipt.eligibilityCore.issuedAt;
  const challengeCore = {
    schemaVersion: "municipal_civic_eligibility_challenge_v1" as const,
    challengeId: "1".repeat(32),
    audience: "roebel-staging-citizen-adoption" as const,
    sessionBindingSha256: "2".repeat(64),
    walletAddress: "0x1111111111111111111111111111111111111111",
    chainId: 100 as const,
    subjectPubkey,
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-civic-eligibility-2026-09",
    participantSuggestionId: fixture.participantSuggestion.suggestionId,
    topicId: fixture.participantSuggestion.draft.topicId,
    issuedAt: issuedAt - 1,
    expiresAt: issuedAt + 299,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const challenge = {
    ...challengeCore,
    canonicalChallenge: stableJson(challengeCore),
    message: stableJson(challengeCore),
  };
  const walletMessages: string[] = [];
  const nostrChallenges: unknown[] = [];
  let adoptionInput: Record<string, unknown> | undefined;
  const session = {
    async getNostrPubkey() {
      return subjectPubkey;
    },
    async signMessage(message: string) {
      walletMessages.push(message);
      return `0x${"12".repeat(65)}`;
    },
    async signCitizenEligibilityChallenge(input: typeof challenge) {
      nostrChallenges.push(input);
      return buildNoteEvent(fixture.adopterSecret, input.message, {
        createdAt: input.issuedAt,
        tags: [
          ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
          ["challenge", input.challengeId],
          [
            "e",
            input.participantSuggestionId,
            "",
            "eligibility-for-suggestion",
          ],
          ["municipality", input.municipalityId],
        ],
      });
    },
    async signCitizenTopicSuggestionAdoption(input: Record<string, unknown>) {
      adoptionInput = input;
      return { event: fixture.projection.adoptionEvent } as never;
    },
  };
  const calls: Array<{ path: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { path: String(input), init: init ?? {} };
    calls.push(call);
    if (call.path.includes("/by-suggestion/")) {
      return new Response(null, { status: 404 });
    }
    if (call.path.endsWith("/challenge")) {
      return new Response(JSON.stringify(challenge), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (call.path.endsWith("/eligibility")) {
      return new Response(JSON.stringify(fixture.issuance), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(fixture.projection), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const accepted = await adoptStagingParticipantSuggestion({
    participantSuggestion: fixture.participantSuggestion,
    session,
  });

  assert.deepEqual(accepted, fixture.projection);
  assert.deepEqual(walletMessages, [challenge.message]);
  assert.deepEqual(nostrChallenges, [challenge]);
  assert.equal(
    typeof (
      adoptionInput?.eligibilityPolicy as { verifyReceiptProof?: unknown }
    )?.verifyReceiptProof,
    "function"
  );
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      `/api/staging-participant/v1/citizen-adoption/by-suggestion/${fixture.participantSuggestion.suggestionId}/adopter/${subjectPubkey}`,
      "/api/staging-participant/v1/citizen-adoption/challenge",
      "/api/staging-participant/v1/citizen-adoption/eligibility",
      "/api/staging-participant/v1/citizen-adoption/adoptions",
    ]
  );
  const bodies = calls.slice(1).map(
    (call) => JSON.parse(String(call.init.body)) as Record<string, unknown>
  );
  assert.deepEqual(bodies[0], {
    schemaVersion: "citizen_adoption_eligibility_challenge_request_v1",
    participantSuggestionId: fixture.participantSuggestion.suggestionId,
    subjectPubkey,
  });
  assert.deepEqual(Object.keys(bodies[1]).sort(), [
    "challengeId",
    "nostrProofEvent",
    "schemaVersion",
    "walletSignature",
  ]);
  assert.equal(
    bodies[1].schemaVersion,
    "citizen_adoption_eligibility_proof_request_v1"
  );
  assert.deepEqual(Object.keys(bodies[2]).sort(), [
    "adoptionEvent",
    "idempotencyKey",
    "requestId",
    "schemaVersion",
  ]);
  assert.equal(
    bodies[2].schemaVersion,
    "citizen_topic_suggestion_adoption_request_v1"
  );
  assert.equal("walletAddress" in bodies[0], false);
  assert.equal("walletAddress" in bodies[1], false);
  assert.equal("walletAddress" in bodies[2], false);
  assert.doesNotMatch(JSON.stringify(bodies), /privateKey|secretKey/u);
  assert.equal(calls[0]?.init.method, undefined);
  assert.equal(calls[0]?.init.credentials, "same-origin");
  assert.equal(calls[0]?.init.cache, "no-store");
  for (const call of calls.slice(1)) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }
});

test("an inactive CitizenNFT is a distinct prerequisite and never reaches adoption", async () => {
  const fixture = citizenAdoptionFixture();
  const subjectPubkey = fixture.projection.adoptionEvent.pubkey;
  const issuedAt = fixture.issuance.eligibilityReceipt.eligibilityCore.issuedAt;
  const challengeCore = {
    schemaVersion: "municipal_civic_eligibility_challenge_v1" as const,
    challengeId: "1".repeat(32),
    audience: "roebel-staging-citizen-adoption" as const,
    sessionBindingSha256: "2".repeat(64),
    walletAddress: "0x1111111111111111111111111111111111111111",
    chainId: 100 as const,
    subjectPubkey,
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-civic-eligibility-2026-09",
    participantSuggestionId: fixture.participantSuggestion.suggestionId,
    topicId: fixture.participantSuggestion.draft.topicId,
    issuedAt: issuedAt - 1,
    expiresAt: issuedAt + 299,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const challenge = {
    ...challengeCore,
    canonicalChallenge: stableJson(challengeCore),
    message: stableJson(challengeCore),
  };
  let adoptionSignatures = 0;
  const session = {
    async getNostrPubkey() {
      return subjectPubkey;
    },
    async signMessage() {
      return `0x${"12".repeat(65)}`;
    },
    async signCitizenEligibilityChallenge(input: typeof challenge) {
      return buildNoteEvent(fixture.adopterSecret, input.message, {
        createdAt: input.issuedAt,
        tags: [
          ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
          ["challenge", input.challengeId],
          [
            "e",
            input.participantSuggestionId,
            "",
            "eligibility-for-suggestion",
          ],
          ["municipality", input.municipalityId],
        ],
      });
    },
    async signCitizenTopicSuggestionAdoption() {
      adoptionSignatures += 1;
      return { event: fixture.projection.adoptionEvent } as never;
    },
  };
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("/by-suggestion/")) {
      return new Response(null, { status: 404 });
    }
    if (path.endsWith("/challenge")) {
      return new Response(JSON.stringify(challenge), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        error: "citizen_eligibility_active_citizen_nft_required",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      }
    );
  };

  await assert.rejects(
    () =>
      adoptStagingParticipantSuggestion({
        participantSuggestion: fixture.participantSuggestion,
        session,
      }),
    (cause) =>
      cause instanceof CitizenAdoptionClientError &&
      cause.code === "citizen_eligibility_active_citizen_nft_required" &&
      cause.httpStatus === 403
  );
  assert.deepEqual(paths, [
    `/api/staging-participant/v1/citizen-adoption/by-suggestion/${fixture.participantSuggestion.suggestionId}/adopter/${subjectPubkey}`,
    "/api/staging-participant/v1/citizen-adoption/challenge",
    "/api/staging-participant/v1/citizen-adoption/eligibility",
  ]);
  assert.equal(adoptionSignatures, 0);
});

test("reload is scoped to the exact citizen when two people adopt one suggestion", async () => {
  const baseTime = Math.floor(Date.now() / 1_000) - 5;
  const first = citizenAdoptionFixture(4, baseTime).projection;
  const second = citizenAdoptionFixture(6, baseTime).projection;
  assert.equal(first.participantSuggestionId, second.participantSuggestionId);
  assert.notEqual(first.adoptionEvent.pubkey, second.adoptionEvent.pubkey);
  globalThis.fetch = async (input) => {
    const path = String(input);
    const projection = path.endsWith(`/adopter/${first.adoptionEvent.pubkey}`)
      ? first
      : second;
    return new Response(JSON.stringify(projection), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(
    await loadPublicCitizenAdoption(
      first.participantSuggestionId,
      first.adoptionEvent.pubkey
    ),
    first
  );
  assert.deepEqual(
    await loadPublicCitizenAdoption(
      second.participantSuggestionId,
      second.adoptionEvent.pubkey
    ),
    second
  );
});

test("reload rejects a tampered adoption acceptance instead of showing verified", async () => {
  const expected = citizenAdoptionFixture().projection;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ...expected,
        acceptanceReceipt: {
          ...expected.acceptanceReceipt,
          receiptChecksum: "f".repeat(64),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  await assert.rejects(
    () =>
      loadPublicCitizenAdoption(
        expected.participantSuggestionId,
        expected.adoptionEvent.pubkey
      ),
    (cause) =>
      cause instanceof CitizenAdoptionClientError &&
      cause.code === "citizen_adoption_public_projection_invalid"
  );
});
