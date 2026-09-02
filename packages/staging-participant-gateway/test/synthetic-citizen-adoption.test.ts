import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAgentNoteEvent,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  getPublicKeyHex,
} from "@netizen-labs/nostr";

import { createCitizenAdoptionService } from "../src/citizen-adoption.ts";
import { createSyntheticCitizenAdoptionService } from "../src/synthetic-citizen-adoption.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const PARTICIPANT_SECRET = new Uint8Array(32).fill(41);
const ADOPTER_SECRET = new Uint8Array(32).fill(43);
const MECKY_SECRET = new Uint8Array(32).fill(42);
const MECKY_PUBKEY = getPublicKeyHex(MECKY_SECRET);
const NOW_SECONDS = 1_788_264_000;
const TEST_CITIZEN_NFT = "0x0be374808a567c9088ac8208b90a4239432b3220";
const TEST_CITIZEN_NFT_CODE_HASH =
  "0x481949efe62483d881190ec16e7ac6ffd796b0e601ea952507fa6eee1986bafb";

function participantSuggestion() {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(PARTICIPANT_SECRET, "Treffpunkt", {
    createdAt: NOW_SECONDS - 4,
  });
  const discussion = buildCivicTopicPromotionEvent(PARTICIPANT_SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY_PUBKEY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: NOW_SECONDS - 3,
  });
  const answer = buildAgentNoteEvent(
    {
      name: "mecky",
      nodeId: "roebel",
      secretKey: MECKY_SECRET,
      publicKey: MECKY_PUBKEY,
      npub: "npub1test",
    },
    "Geprüfte Antwort",
    {
      createdAt: NOW_SECONDS - 2,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
        ["municipality", "roebel-mueritz"],
        ["topic", topicId],
        [
          "evidence",
          `sha256:${"c".repeat(64)}`,
          "https://stadtstack.example/public/reviewed-source",
        ],
      ],
    },
  );
  return buildParticipantTopicSuggestion(PARTICIPANT_SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY_PUBKEY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: NOW_SECONDS - 1,
  });
}

function fixture(options: {
  active?: boolean;
  eligibilityError?: string;
  contractAddress?: string;
} = {}) {
  const suggestion = participantSuggestion();
  let issued: any = null;
  let consumed = false;
  let accepted: any = null;
  let replayClaim: any = null;
  let acceptCalls = 0;
  let publicReadOverride: any = undefined;
  const service = createSyntheticCitizenAdoptionService({
    policy: {
      municipalityId: "roebel-mueritz",
      policyVersion: "roebel-test-citizen-nft-v2-staging-2026-09",
      testCitizenNftAddress: TEST_CITIZEN_NFT,
      testCitizenNftRuntimeCodeKeccak256: TEST_CITIZEN_NFT_CODE_HASH,
      challengeTtlSeconds: 300,
      maxEventClockSkewSeconds: 300,
    },
    sources: {
      async resolveParticipantSuggestion({ participantSuggestionId }) {
        return participantSuggestionId === suggestion.suggestionId
          ? suggestion
          : null;
      },
    },
    challenges: {
      async issue(input) {
        issued = input;
        return input.challenge;
      },
      async consume() {
        if (!issued || consumed) throw new Error("challenge_invalid");
        consumed = true;
        return issued.challenge;
      },
    },
    walletVerifier: {
      async verifyWalletSignature() {
        return true;
      },
    },
    eligibilityVerifier: {
      async verifyActiveCitizen() {
        if (options.eligibilityError) throw new Error(options.eligibilityError);
        return {
          active: options.active ?? true,
          chainId: 100,
          contractAddress: options.contractAddress ?? TEST_CITIZEN_NFT,
          finalizedBlockNumber: 12_345n,
          finalizedBlockHash: `0x${"b".repeat(64)}`,
        } as const;
      },
    },
    ledger: {
      async resolveReplay(input) {
        if (!accepted) return null;
        if (
          replayClaim.requestId === input.requestId &&
          replayClaim.idempotencyKeySha256 === input.idempotencyKeySha256 &&
          replayClaim.requestChecksum === input.requestChecksum &&
          replayClaim.proofEventId === input.proofEventId
        ) {
          return accepted;
        }
        throw new Error("synthetic_citizen_adoption_idempotency_conflict");
      },
      async accept(input: any) {
        acceptCalls += 1;
        accepted = input.projection;
        replayClaim = {
          requestId: input.requestId,
          idempotencyKeySha256: input.idempotencyKeySha256,
          requestChecksum: input.requestChecksum,
          proofEventId: input.proofEvent.id,
        };
        return accepted;
      },
      async readPublic() {
        return publicReadOverride === undefined ? accepted : publicReadOverride;
      },
    },
    now: () => new Date(NOW_SECONDS * 1_000),
    randomId: () => "1".repeat(32),
  });
  return {
    service,
    suggestion,
    getIssued: () => issued,
    getAcceptCalls: () => acceptCalls,
    setPublicRead: (value: unknown) => {
      publicReadOverride = value;
    },
  };
}

async function signedRequest(
  setup: ReturnType<typeof fixture>,
  requestId = "00000000-0000-4000-8000-000000000099",
) {
  const subjectPubkey = getPublicKeyHex(ADOPTER_SECRET);
  const challenge = await setup.service.issueChallenge({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    subjectPubkey,
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "staging_test_citizen_pass_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", challenge.participantSuggestionId, "", "synthetic-adoption-test"],
      ["municipality", challenge.municipalityId],
      ["test-only", "true"],
    ],
  });
  return {
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    request: {
      schemaVersion: "synthetic_citizen_adoption_tracer_request_v1" as const,
      requestId,
      idempotencyKey: `synthetic-adoption.${requestId}`,
      challengeId: challenge.challengeId,
      walletSignature: "0x1234",
      nostrProofEvent,
    },
  };
}

test("issues a public-safe, session-bound test-pass challenge for one immutable suggestion", async () => {
  const setup = fixture();
  const challenge = await setup.service.issueChallenge({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });

  assert.equal(challenge.schemaVersion, "staging_test_citizen_pass_v1");
  assert.equal(challenge.challengeId, "1".repeat(32));
  assert.equal(challenge.audience, "roebel-staging-synthetic-citizen-adoption");
  assert.equal(challenge.participantSuggestionId, setup.suggestion.suggestionId);
  assert.equal(challenge.subjectPubkey, getPublicKeyHex(ADOPTER_SECRET));
  assert.equal(challenge.testCitizenNftContract, TEST_CITIZEN_NFT);
  assert.equal(challenge.environment, "staging");
  assert.equal(challenge.testOnly, true);
  assert.equal(challenge.authorityBinding, "none");
  assert.equal(challenge.message, challenge.canonicalChallenge);
  assert.doesNotMatch(challenge.message, new RegExp(WALLET, "iu"));
  assert.doesNotMatch(challenge.message, /sessionBinding|name|address|postcode|document/iu);
  assert.deepEqual(setup.getIssued(), {
    challenge,
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
  });
});

test("rejects an inactive holder without storing a synthetic tracer", async () => {
  const setup = fixture({ active: false });
  const challenge = await setup.service.issueChallenge({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "staging_test_citizen_pass_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", challenge.participantSuggestionId, "", "synthetic-adoption-test"],
      ["municipality", challenge.municipalityId],
      ["test-only", "true"],
    ],
  });

  await assert.rejects(
    setup.service.acceptTracer({
      walletAddress: WALLET,
      sessionBindingSha256: "2".repeat(64),
      request: {
        schemaVersion: "synthetic_citizen_adoption_tracer_request_v1",
        requestId: "00000000-0000-4000-8000-000000000002",
        idempotencyKey: "synthetic-adoption.request-2",
        challengeId: challenge.challengeId,
        walletSignature: "0x1234",
        nostrProofEvent,
      },
    }),
    (cause: unknown) =>
      cause instanceof Error && cause.message === "synthetic_test_citizen_pass_required",
  );
  assert.equal(setup.getAcceptCalls(), 0);
});

test("fails closed when the pinned verifier reports code-hash or finality failure", async () => {
  for (const eligibilityError of [
    "citizen_nft_eligibility_deployment_mismatch",
    "citizen_nft_eligibility_finality_unavailable",
  ]) {
    const setup = fixture({ eligibilityError });
    const request = await signedRequest(setup);
    await assert.rejects(
      setup.service.acceptTracer(request),
      (cause: unknown) =>
        cause instanceof Error &&
        cause.message === "synthetic_test_citizen_pass_verification_unavailable",
    );
    assert.equal(setup.getAcceptCalls(), 0);
  }
});

test("rejects evidence from any contract other than the configured test deployment", async () => {
  const setup = fixture({
    contractAddress: "0x2222222222222222222222222222222222222222",
  });
  await assert.rejects(
    setup.service.acceptTracer(await signedRequest(setup)),
    (cause: unknown) =>
      cause instanceof Error &&
      cause.message === "synthetic_test_citizen_pass_evidence_invalid",
  );
  assert.equal(setup.getAcceptCalls(), 0);
});

test("returns the exact first projection for an idempotent retry", async () => {
  const setup = fixture();
  const request = await signedRequest(setup);
  const first = await setup.service.acceptTracer(request);
  const replay = await setup.service.acceptTracer(request);
  assert.deepEqual(replay, first);
  assert.equal(setup.getAcceptCalls(), 1);
});

test("validates the signed, no-authority public projection before returning it", async () => {
  const setup = fixture();
  const accepted = await setup.service.acceptTracer(await signedRequest(setup));
  const loaded = await setup.service.readPublicTracer({
    participantSuggestionId: setup.suggestion.suggestionId,
    adopterPubkey: accepted.tracer.adopterPubkey,
  });
  assert.deepEqual(loaded, accepted);

  setup.setPublicRead({ ...accepted, submittedToCivicWorkflow: true });
  await assert.rejects(
    setup.service.readPublicTracer({
      participantSuggestionId: setup.suggestion.suggestionId,
      adopterPubkey: accepted.tracer.adopterPubkey,
    }),
    (cause: unknown) =>
      cause instanceof Error &&
      cause.message === "synthetic_citizen_adoption_public_projection_invalid",
  );
});

test("the real ADR-0023 service rejects the synthetic request schema before any write", async () => {
  const real = createCitizenAdoptionService({
    policy: {
      municipalityId: "roebel-mueritz",
      policyVersion: "roebel-citizen-nft-v2-staging-2026-09",
      issuer: "roebel-staging-citizen-verifier",
      statusBaseUrl: "https://roebel.example/api/civic/v1/eligibility/status",
      challengeTtlSeconds: 300,
      receiptTtlSeconds: 900,
      maxEventClockSkewSeconds: 300,
    },
    issuer: { keyId: "real-issuer", privateKey: new Uint8Array(32).fill(9) },
    sources: { async resolveParticipantSuggestion() { return null; } },
    challenges: {
      async issue(value) { return value; },
      async consume() { throw new Error("must_not_run"); },
    },
    walletVerifier: { async verifyWalletSignature() { throw new Error("must_not_run"); } },
    eligibilityVerifier: { async verifyActiveCitizen() { throw new Error("must_not_run"); } },
    receipts: {
      async store(input) { return input.receipt; },
      async resolve() { return null; },
    },
    ledger: {
      async resolveReplay() { throw new Error("must_not_run"); },
      async accept() { throw new Error("must_not_run"); },
      async readPublic() { return null; },
    },
  });
  const synthetic = await signedRequest(fixture());
  await assert.rejects(
    real.acceptAdoption(synthetic.request as never),
    (cause: unknown) =>
      cause instanceof Error && cause.message === "citizen_adoption_request_invalid",
  );
});

test("accepts a finalized active test pass into an explicitly non-authoritative public tracer", async () => {
  const setup = fixture();
  const subjectPubkey = getPublicKeyHex(ADOPTER_SECRET);
  const challenge = await setup.service.issueChallenge({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    subjectPubkey,
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "staging_test_citizen_pass_proof_v1"],
      ["challenge", challenge.challengeId],
      [
        "e",
        challenge.participantSuggestionId,
        "",
        "synthetic-adoption-test",
      ],
      ["municipality", challenge.municipalityId],
      ["test-only", "true"],
    ],
  });

  const projection = await setup.service.acceptTracer({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    request: {
      schemaVersion: "synthetic_citizen_adoption_tracer_request_v1",
      requestId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "synthetic-adoption.request-1",
      challengeId: challenge.challengeId,
      walletSignature: "0x1234",
      nostrProofEvent,
    },
  });

  assert.equal(
    projection.schemaVersion,
    "public_synthetic_citizen_adoption_projection_v1",
  );
  assert.equal(projection.tracer.schemaVersion, "synthetic_citizen_adoption_tracer_v1");
  assert.equal(projection.tracer.participantSuggestionId, setup.suggestion.suggestionId);
  assert.equal(projection.tracer.adopterPubkey, subjectPubkey);
  assert.equal(projection.tracer.proofEventId, nostrProofEvent.id);
  assert.equal(projection.tracer.entryState, "synthetic_journey_preview_only");
  assert.equal(projection.acceptanceReceipt.environment, "staging");
  assert.equal(projection.acceptanceReceipt.testOnly, true);
  assert.equal(projection.authorityBinding, "none");
  assert.equal(projection.submittedToCivicWorkflow, false);
  assert.equal(projection.civicCaseCreated, false);
  assert.equal(projection.administrativeEndorsement, false);
  assert.equal(projection.bindingVote, false);
  assert.equal(projection.councilDecision, false);
  assert.equal(projection.treasuryEffect, false);
  assert.equal(projection.paymentEffect, false);
  assert.match(projection.labels.citizenship, /keine reale Bürgerberechtigung/u);
  assert.match(projection.labels.civicWorkflow, /kein CivicCase/u);
  assert.match(projection.labels.governance, /keine.*Abstimmung.*Treasury/iu);
  assert.equal(Object.hasOwn(projection, "eligibilityReceipt"), false);
  assert.equal(Object.hasOwn(projection, "adoptionEvent"), false);
  assert.equal(setup.getAcceptCalls(), 1);
});
