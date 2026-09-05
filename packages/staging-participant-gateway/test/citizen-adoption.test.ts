import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { test } from "node:test";
import {
  buildAgentNoteEvent,
  buildCitizenTopicSuggestionAdoption,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  createMunicipalCivicEligibilityReceiptProofVerifier,
  getPublicKeyHex,
  municipalCivicEligibilityReceiptProofPublicKey,
  type MunicipalCivicEligibilityStatusV1,
} from "@netizen-labs/nostr";

import {
  createCitizenAdoptionService,
  type CitizenEligibilityReceiptStore,
} from "../src/citizen-adoption.ts";
import { createCitizenEligibilityStatusResolver } from "../src/citizen-eligibility-status.ts";
import { createStagingParticipantGatewayHandler } from "../src/http.ts";
import type { PinnedCitizenNftEligibilityEvidence } from "@netizen-labs/relay-sync";

const WALLET = "0x1111111111111111111111111111111111111111";
const PARTICIPANT_SECRET = new Uint8Array(32).fill(41);
const ADOPTER_SECRET = new Uint8Array(32).fill(43);
const MECKY_SECRET = new Uint8Array(32).fill(42);
const MECKY_PUBKEY = getPublicKeyHex(MECKY_SECRET);
const ISSUER_PRIVATE_KEY = new Uint8Array(32).fill(7);
const NOW_SECONDS = 1_788_264_000;

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

function serviceFixture(options: {
  active?: boolean;
  tamperedSuggestion?: boolean;
  eligibilityError?: string;
} = {}) {
  const suggestion = participantSuggestion();
  const resolvedSuggestion = options.tamperedSuggestion
    ? {
        ...suggestion,
        event: { ...suggestion.event, sig: "0".repeat(128) },
      }
    : suggestion;
  let issuedChallenge: Awaited<ReturnType<
    ReturnType<typeof createCitizenAdoptionService>["issueEligibilityChallenge"]
  >> | null = null;
  let walletVerification: unknown = null;
  let storedReceipt: Parameters<CitizenEligibilityReceiptStore["store"]>[0] | null = null;
  let challengeConsumed = false;
  let adoptionAcceptCalls = 0;
  let acceptedProjection: any = null;
  let acceptedReplay: any = null;
  let publicReadOverride: any = undefined;
  let nowSeconds = NOW_SECONDS;
  const service = createCitizenAdoptionService({
    policy: {
      municipalityId: "roebel-mueritz",
      policyVersion: "roebel-citizen-nft-v2-staging-2026-09",
      issuer: "roebel-staging-citizen-verifier",
      statusBaseUrl:
        "https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility/status",
      challengeTtlSeconds: 300,
      receiptTtlSeconds: 900,
      maxEventClockSkewSeconds: 300,
    },
    issuer: {
      keyId: "roebel-staging-eligibility-issuer-2026-09",
      privateKey: ISSUER_PRIVATE_KEY,
    },
    sources: {
      async resolveParticipantSuggestion({ participantSuggestionId }) {
        return participantSuggestionId === suggestion.suggestionId
          ? resolvedSuggestion
          : null;
      },
    },
    challenges: {
      async issue(challenge) {
        issuedChallenge = challenge;
        return challenge;
      },
      async consume(input) {
        if (
          !issuedChallenge ||
          challengeConsumed ||
          input.challengeId !== issuedChallenge.challengeId ||
          input.walletAddress !== issuedChallenge.walletAddress ||
          input.sessionBindingSha256 !== issuedChallenge.sessionBindingSha256 ||
          input.consumedAt >= issuedChallenge.expiresAt
        ) {
          throw new Error("citizen_eligibility_challenge_invalid");
        }
        challengeConsumed = true;
        return issuedChallenge;
      },
    },
    walletVerifier: {
      async verifyWalletSignature(input) {
        walletVerification = input;
        return true;
      },
    },
    eligibilityVerifier: {
      async verifyActiveCitizen() {
        if (options.eligibilityError) {
          throw new Error(options.eligibilityError);
        }
        return {
          active: options.active ?? true,
          chainId: 100,
          contractAddress:
            "0x59aa26f499d7c2b3ec2c8524ed06f54fc4e85de5",
          finalizedBlockNumber: 12_345n,
          finalizedBlockHash: `0x${"b".repeat(64)}`,
        } as const;
      },
    },
    receipts: {
      async store(input) {
        storedReceipt = input;
        return input.receipt;
      },
      async resolve() {
        return storedReceipt?.receipt ?? null;
      },
    },
    ledger: {
      async resolveReplay(input) {
        if (!acceptedProjection) return null;
        if (
          acceptedReplay.requestId === input.requestId &&
          acceptedReplay.idempotencyKeySha256 === input.idempotencyKeySha256 &&
          acceptedReplay.requestChecksum === input.requestChecksum &&
          acceptedReplay.adoptionEventId === input.adoptionEventId
        ) {
          return acceptedProjection;
        }
        throw new Error("citizen_adoption_idempotency_conflict");
      },
      async accept(input: any) {
        adoptionAcceptCalls += 1;
        acceptedReplay = {
          requestId: input.requestId,
          idempotencyKeySha256: input.idempotencyKeySha256,
          requestChecksum: input.requestChecksum,
          adoptionEventId: input.adoption.event.id,
        };
        acceptedProjection = Object.freeze({
          schemaVersion: "public_citizen_adoption_projection_v1",
          participantSuggestionId:
            input.adoption.participantSuggestionId,
          adoptionEvent: input.adoption.event,
          eligibilityReceipt: input.eligibilityReceipt,
          acceptanceReceipt: input.acceptanceReceipt,
          entryState: "case_steward_review_required",
          authorityBinding: "civic_eligibility_only",
          submittedToCivicWorkflow: false,
          administrativeEndorsement: false,
          bindingVote: false,
          councilDecision: false,
          treasuryEffect: false,
          paymentEffect: false,
        });
        return acceptedProjection;
      },
      async readPublic() {
        return publicReadOverride === undefined
          ? acceptedProjection
          : publicReadOverride;
      },
    },
    now: () => new Date(nowSeconds * 1_000),
    randomId: () => "1".repeat(32),
  });
  return {
    service,
    suggestion,
    getIssuedChallenge: () => issuedChallenge,
    getWalletVerification: () => walletVerification,
    getStoredReceipt: () => storedReceipt,
    getAdoptionAcceptCalls: () => adoptionAcceptCalls,
    setNow: (value: number) => { nowSeconds = value; },
    setPublicReadProjection: (value: unknown) => {
      publicReadOverride = value;
    },
  };
}

async function statusFixture() {
  const setup = serviceFixture();
  const sessionBindingSha256 = "2".repeat(64);
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET, sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const issuance = await setup.service.issueEligibilityReceipt({
    walletAddress: WALLET, sessionBindingSha256, challengeId: challenge.challengeId,
    walletSignature: "0xaaaa",
    nostrProofEvent: buildNoteEvent(ADOPTER_SECRET, challenge.message, {
      createdAt: challenge.issuedAt,
      tags: [
        ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
        ["challenge", challenge.challengeId],
        ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
        ["municipality", "roebel-mueritz"],
      ],
    }),
  });
  const { municipalityId, policyVersion, issuer, statusBaseUrl } = issuance.eligibilityPolicy;
  const policy = { municipalityId, policyVersion, issuer, statusBaseUrl };
  const receipt = issuance.eligibilityReceipt;
  let record: unknown = { receipt, walletAddress: WALLET };
  let currentTime = NOW_SECONDS + 20;
  let check: () => Promise<PinnedCitizenNftEligibilityEvidence> = async () => ({
    ...setup.getStoredReceipt()!.privateEligibilityEvidence,
    finalizedBlockNumber: 12_400n,
  });
  let checks = 0;
  const resolver = createCitizenEligibilityStatusResolver({
    policy, issuer: { keyId: issuance.eligibilityPolicy.proof.keyId, privateKey: ISSUER_PRIVATE_KEY },
    receipts: { async resolveForStatus(input) {
      assert.deepEqual(input, { receiptId: receipt.receiptId, municipalityId, policyVersion });
      return record as never;
    } },
    eligibilityVerifier: { async verifyActiveCitizen(input) {
      assert.deepEqual(input, { address: WALLET });
      checks += 1;
      return check();
    } },
    now: () => new Date(currentTime * 1_000),
    timeoutMs: 8_000,
  });
  const handler = (activated = true) => createStagingParticipantGatewayHandler({
    config: {
      origin: new URL(statusBaseUrl).origin,
      sessionHmacKey: "k".repeat(32), inviteSha256: "c".repeat(64),
      allowedWallets: [WALLET], cookieSecure: true, meckyPubkey: MECKY_PUBKEY,
      topicPolicy: {
        municipalityId, topicNamespace: `urn:stadtstack:topic:municipality:${municipalityId}`,
        sourceConversationTopic: "roebel-app-conversation", policyVersion: "staging-participant-topic-v1",
      },
    },
    data: {} as never, verifier: {} as never, mirror: {} as never,
    citizenEligibilityStatus: activated ? resolver : undefined,
  });
  return {
    receipt, policy, resolver, handler,
    key: issuance.eligibilityPolicy.proof.publicKey,
    stored: setup.getStoredReceipt()!,
    setRecord: (value: unknown) => { record = value; },
    setNow: (value: number) => { currentTime = value; },
    setCheck: (value: typeof check) => { check = value; },
    checks: () => checks,
    adoptionWrites: setup.getAdoptionAcceptCalls,
  };
}

function verifyStatusWithNode(status: MunicipalCivicEligibilityStatusV1, publicKey: string) {
  const canonical = (value: object) => JSON.stringify(value, Object.keys(value).sort());
  assert.equal(status.statusChecksum, createHash("sha256").update(canonical(status.statusCore)).digest("hex"));
  const proofInput = {
    domain: "municipal-civic-eligibility-status/v1",
    schemaVersion: "municipal_civic_eligibility_status_v1",
    statusChecksum: status.statusChecksum,
  };
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]),
    format: "der", type: "spki",
  });
  assert.equal(verifySignature(null, Buffer.from(canonical(proofInput)), key, Buffer.from(status.proof.signature, "base64url")), true);
}

test("HTTP rechecks an issued receipt for each nonce and returns only independently verifiable public status", async () => {
  const setup = await statusFixture();
  const handler = setup.handler();
  const firstNonce = "a".repeat(64);
  const getStatus = (nonce: string) => handler(new Request(setup.receipt.statusRef, {
    headers: { "x-stadtstack-status-nonce": nonce },
  }));
  const first = await getStatus(firstNonce);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const active = await first.json() as MunicipalCivicEligibilityStatusV1;
  assert.deepEqual(Object.keys(active).sort(), ["proof", "statusChecksum", "statusCore"]);
  assert.deepEqual(active.statusCore, {
    schemaVersion: "municipal_civic_eligibility_status_v1",
    receiptId: setup.receipt.receiptId, payloadChecksum: setup.receipt.payloadChecksum,
    policyVersion: setup.policy.policyVersion, state: "active",
    effectiveAt: NOW_SECONDS + 20, observedAt: NOW_SECONDS + 20,
    audience: "stadtstack-case-steward-admission", requestNonce: firstNonce,
  });
  verifyStatusWithNode(active, setup.key);
  const serialized = JSON.stringify(active);
  assert.equal(serialized.includes(WALLET), false);
  for (const privateField of ["walletAddress", "subjectPubkey", "privateEligibilityEvidence", "finalizedBlockNumber", "sessionBindingSha256"])
    assert.equal(serialized.includes(privateField), false, privateField);

  setup.setCheck(async () => ({ ...setup.stored.privateEligibilityEvidence, active: false }));
  setup.setNow(NOW_SECONDS + 30);
  const secondNonce = "b".repeat(64);
  const revoked = await (await getStatus(secondNonce)).json() as MunicipalCivicEligibilityStatusV1;
  assert.equal(revoked.statusCore.state, "revoked");
  assert.equal(revoked.statusCore.requestNonce, secondNonce);
  assert.notEqual(revoked.statusChecksum, active.statusChecksum);
  verifyStatusWithNode(revoked, setup.key);
  assert.equal(setup.checks(), 2);
  assert.equal(setup.adoptionWrites(), 0);
  assert.equal(setup.stored.receipt, setup.receipt);
});

test("status HTTP stays disabled without composition and bounds the configured read surface", async () => {
  const setup = await statusFixture();
  const request = () => new Request(setup.receipt.statusRef, { headers: { "x-stadtstack-status-nonce": "a".repeat(64) } });
  assert.equal((await setup.handler(false)(request())).status, 503);
  const handler = setup.handler();
  assert.equal((await handler(new Request(setup.receipt.statusRef))).status, 400);
  assert.equal((await handler(new Request(setup.receipt.statusRef, { method: "POST" }))).status, 405);
  assert.equal((await handler(new Request(`${setup.receipt.statusRef}?walletAddress=${WALLET}`))).status, 404);
  assert.equal((await handler(new Request(setup.receipt.statusRef, { headers: { origin: "https://untrusted.example" } }))).status, 403);
  setup.setRecord(null);
  assert.equal((await handler(request())).status, 404);
  setup.setRecord({ receipt: setup.receipt, walletAddress: WALLET });
  for (const error of ["rpc_offline", "chain_mismatch", "deployment_mismatch", "block_reorged"]) {
    setup.setCheck(async () => { throw new Error(`private detail: ${error} ${WALLET}`); });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "citizen_eligibility_status_unavailable" });
  }
});

test("status rejects invalid receipts, synthetic inputs and caller-selected holders before chain access", async () => {
  const setup = await statusFixture();
  const input = { payloadChecksum: setup.receipt.payloadChecksum, requestNonce: "a".repeat(64) };
  for (const changed of [
    { ...setup.receipt, schemaVersion: "synthetic_citizen_adoption_tracer_v1" },
    { ...setup.receipt, walletAddress: WALLET },
    { ...setup.receipt, payloadChecksum: "d".repeat(64) },
    { ...setup.receipt, statusRef: "https://untrusted.example/status" },
    { ...setup.receipt, eligibilityCore: { ...setup.receipt.eligibilityCore, municipalityId: "another-city" } },
    { ...setup.receipt, proof: { ...setup.receipt.proof, signature: "a".repeat(86) } },
    { ...setup.receipt, proof: { ...setup.receipt.proof, keyId: "unknown-issuer" } },
  ]) {
    setup.setRecord({ receipt: changed, walletAddress: WALLET });
    await assert.rejects(setup.resolver.resolve(input), /citizen_eligibility_status_receipt_invalid/);
  }
  setup.setRecord({ receipt: setup.receipt, walletAddress: WALLET });
  for (const changed of [ { ...input, walletAddress: WALLET }, { ...input, requestNonce: "short" } ])
    await assert.rejects(setup.resolver.resolve(changed), /citizen_eligibility_status_request_invalid/);
  setup.setNow(setup.receipt.eligibilityCore.expiresAt);
  await assert.rejects(setup.resolver.resolve(input), /citizen_eligibility_status_receipt_expired/);
  assert.equal(setup.checks(), 0);
});

test("status fails closed when a receipt expires during verification or an adapter returns indeterminate evidence", async () => {
  const setup = await statusFixture();
  const input = { payloadChecksum: setup.receipt.payloadChecksum, requestNonce: "a".repeat(64) };
  setup.setCheck(async () => {
    setup.setNow(setup.receipt.eligibilityCore.expiresAt);
    return setup.stored.privateEligibilityEvidence;
  });
  await assert.rejects(setup.resolver.resolve(input), /citizen_eligibility_status_receipt_expired/);
  setup.setNow(NOW_SECONDS + 20);
  setup.setCheck(async () => ({ ...setup.stored.privateEligibilityEvidence, active: null } as never));
  await assert.rejects(setup.resolver.resolve(input), /citizen_eligibility_status_evidence_invalid/);
});

test("a stalled status check times out without returning a late signed observation", async (t) => {
  const setup = await statusFixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: PinnedCitizenNftEligibilityEvidence) => void;
  let reached!: () => void;
  const checking = new Promise<void>((resolve) => { reached = resolve; });
  setup.setCheck(() => { reached(); return new Promise((resolve) => { finish = resolve; }); });
  const response = setup.handler()(new Request(setup.receipt.statusRef, {
    headers: { "x-stadtstack-status-nonce": "a".repeat(64) },
  }));
  await checking;
  t.mock.timers.tick(8_000);
  const failed = await response;
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "citizen_eligibility_status_unavailable" });
  finish(setup.stored.privateEligibilityEvidence);
  assert.equal(setup.adoptionWrites(), 0);
});

test("issues one session-bound challenge for the exact signed participant suggestion", async () => {
  const setup = serviceFixture();
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256: "2".repeat(64),
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });

  assert.equal(challenge.schemaVersion, "municipal_civic_eligibility_challenge_v1");
  assert.equal(challenge.challengeId, "1".repeat(32));
  assert.equal(challenge.participantSuggestionId, setup.suggestion.suggestionId);
  assert.equal(challenge.topicId, setup.suggestion.draft.topicId);
  assert.equal(challenge.subjectPubkey, getPublicKeyHex(ADOPTER_SECRET));
  assert.equal(challenge.walletAddress, WALLET);
  assert.equal(challenge.chainId, 100);
  assert.equal(challenge.issuedAt, NOW_SECONDS);
  assert.equal(challenge.expiresAt, NOW_SECONDS + 300);
  assert.equal(challenge.message, challenge.canonicalChallenge);
  assert.match(challenge.message, /"authorityBinding":"civic_eligibility_only"/u);
  assert.doesNotMatch(challenge.message, /Case|vote|treasury|payment/iu);
  assert.deepEqual(setup.getIssuedChallenge(), challenge);
  assert.equal(setup.getStoredReceipt(), null);
  assert.equal(setup.getAdoptionAcceptCalls(), 0);
});

test("refuses to issue eligibility for a resolver-shaped but invalid participant signature", async () => {
  const setup = serviceFixture({ tamperedSuggestion: true });
  await assert.rejects(
    setup.service.issueEligibilityChallenge({
      walletAddress: WALLET,
      sessionBindingSha256: "2".repeat(64),
      subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
      participantSuggestionId: setup.suggestion.suggestionId,
    }),
    /citizen_adoption_participant_suggestion_unavailable/,
  );
  assert.equal(setup.getIssuedChallenge(), null);
});

test("an inactive CitizenNFT wallet receives no receipt and causes no adoption effect", async () => {
  const setup = serviceFixture({ active: false });
  const sessionBindingSha256 = "2".repeat(64);
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
      ["municipality", "roebel-mueritz"],
    ],
  });

  await assert.rejects(
    setup.service.issueEligibilityReceipt({
      walletAddress: WALLET,
      sessionBindingSha256,
      challengeId: challenge.challengeId,
      walletSignature: "0xaaaa",
      nostrProofEvent,
    }),
    /citizen_eligibility_active_citizen_nft_required/,
  );
  assert.equal(setup.getStoredReceipt(), null);
  assert.equal(setup.getAdoptionAcceptCalls(), 0);
});

test("chain and finality failures issue no eligibility receipt or adoption", async () => {
  for (const failure of [
    "citizen_nft_eligibility_chain_mismatch",
    "citizen_nft_eligibility_finality_unavailable",
    "citizen_nft_eligibility_deployment_mismatch",
    "citizen_nft_eligibility_response_invalid",
    "citizen_nft_eligibility_block_reorged",
  ]) {
    const setup = serviceFixture({ eligibilityError: failure });
    const sessionBindingSha256 = "2".repeat(64);
    const challenge = await setup.service.issueEligibilityChallenge({
      walletAddress: WALLET,
      sessionBindingSha256,
      subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
      participantSuggestionId: setup.suggestion.suggestionId,
    });
    const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
      createdAt: challenge.issuedAt,
      tags: [
        ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
        ["challenge", challenge.challengeId],
        ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
        ["municipality", "roebel-mueritz"],
      ],
    });

    await assert.rejects(
      setup.service.issueEligibilityReceipt({
        walletAddress: WALLET,
        sessionBindingSha256,
        challengeId: challenge.challengeId,
        walletSignature: "0xaaaa",
        nostrProofEvent,
      }),
      /citizen_eligibility_verification_unavailable/u,
    );
    assert.equal(setup.getStoredReceipt(), null, failure);
    assert.equal(setup.getAdoptionAcceptCalls(), 0, failure);
  }
});

test("the eligibility challenge is one-time, unexpired, and bound to its exact session wallet", async () => {
  const setup = serviceFixture();
  const sessionBindingSha256 = "2".repeat(64);
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
      ["municipality", "roebel-mueritz"],
    ],
  });
  const proof = {
    walletAddress: WALLET,
    sessionBindingSha256,
    challengeId: challenge.challengeId,
    walletSignature: "0xaaaa",
    nostrProofEvent,
  } as const;

  await assert.rejects(
    setup.service.issueEligibilityReceipt({
      ...proof,
      sessionBindingSha256: "3".repeat(64),
    }),
    /citizen_eligibility_challenge_invalid/u,
  );
  await assert.rejects(
    setup.service.issueEligibilityReceipt({
      ...proof,
      walletAddress: "0x2222222222222222222222222222222222222222",
    }),
    /citizen_eligibility_challenge_invalid/u,
  );
  await setup.service.issueEligibilityReceipt(proof);
  await assert.rejects(
    setup.service.issueEligibilityReceipt(proof),
    /citizen_eligibility_challenge_invalid/u,
  );

  const expired = serviceFixture();
  const expiredChallenge = await expired.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: expired.suggestion.suggestionId,
  });
  expired.setNow(NOW_SECONDS + 301);
  await assert.rejects(
    expired.service.issueEligibilityReceipt({
      walletAddress: WALLET,
      sessionBindingSha256,
      challengeId: expiredChallenge.challengeId,
      walletSignature: "0xaaaa",
      nostrProofEvent: buildNoteEvent(
        ADOPTER_SECRET,
        expiredChallenge.message,
        {
          createdAt: expiredChallenge.issuedAt,
          tags: [
            ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
            ["challenge", expiredChallenge.challengeId],
            ["e", expired.suggestion.suggestionId, "", "eligibility-for-suggestion"],
            ["municipality", "roebel-mueritz"],
          ],
        },
      ),
    }),
    /citizen_eligibility_challenge_invalid/u,
  );
  assert.equal(expired.getStoredReceipt(), null);
});

test("consumes the dual-signed challenge and issues only a public-safe eligibility receipt", async () => {
  const setup = serviceFixture();
  const sessionBindingSha256 = "2".repeat(64);
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
      ["municipality", "roebel-mueritz"],
    ],
  });

  const issuance = await setup.service.issueEligibilityReceipt({
    walletAddress: WALLET,
    sessionBindingSha256,
    challengeId: challenge.challengeId,
    walletSignature: "0xaaaa",
    nostrProofEvent,
  });

  assert.equal(issuance.schemaVersion, "municipal_civic_eligibility_issuance_v1");
  assert.equal(
    issuance.eligibilityReceipt.eligibilityCore.subjectPubkey,
    nostrProofEvent.pubkey,
  );
  assert.equal(
    issuance.eligibilityReceipt.eligibilityCore.participantSuggestionId,
    setup.suggestion.suggestionId,
  );
  assert.equal(
    issuance.eligibilityReceipt.eligibilityCore.authorityBinding,
    "civic_eligibility_only",
  );
  assert.equal(issuance.eligibilityReceipt.eligibilityCore.expiresAt, NOW_SECONDS + 900);
  assert.doesNotMatch(
    JSON.stringify(issuance),
    /0x1111111111111111111111111111111111111111|finalizedBlock|contractAddress/iu,
  );
  assert.deepEqual(setup.getWalletVerification(), {
    address: WALLET,
    message: challenge.message,
    signature: "0xaaaa",
  });
  assert.equal(
    createMunicipalCivicEligibilityReceiptProofVerifier({
      publicKey: municipalCivicEligibilityReceiptProofPublicKey(
        ISSUER_PRIVATE_KEY,
      ),
      keyId: "roebel-staging-eligibility-issuer-2026-09",
    })(
      {
        domain: "municipal-civic-eligibility-receipt/v1",
        schemaVersion: "municipal_civic_eligibility_receipt_v1",
        receiptId: issuance.eligibilityReceipt.receiptId,
        payloadChecksum: issuance.eligibilityReceipt.payloadChecksum,
        statusRef: issuance.eligibilityReceipt.statusRef,
      },
      issuance.eligibilityReceipt.proof,
    ),
    true,
  );
  assert.ok(setup.getStoredReceipt(), "private block evidence is stored, not published");
});

test("accepts one immutable adoption and returns the original acceptance on an exact late retry", async () => {
  const setup = serviceFixture();
  const sessionBindingSha256 = "2".repeat(64);
  const challenge = await setup.service.issueEligibilityChallenge({
    walletAddress: WALLET,
    sessionBindingSha256,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: setup.suggestion.suggestionId,
  });
  const nostrProofEvent = buildNoteEvent(ADOPTER_SECRET, challenge.message, {
    createdAt: challenge.issuedAt,
    tags: [
      ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
      ["challenge", challenge.challengeId],
      ["e", setup.suggestion.suggestionId, "", "eligibility-for-suggestion"],
      ["municipality", "roebel-mueritz"],
    ],
  });
  const issuance = await setup.service.issueEligibilityReceipt({
    walletAddress: WALLET,
    sessionBindingSha256,
    challengeId: challenge.challengeId,
    walletSignature: "0xaaaa",
    nostrProofEvent,
  });
  const adoption = buildCitizenTopicSuggestionAdoption(ADOPTER_SECRET, {
    participantSuggestion: setup.suggestion,
    eligibilityReceipt: issuance.eligibilityReceipt,
    eligibilityPolicy: {
      municipalityId: issuance.eligibilityPolicy.municipalityId,
      policyVersion: issuance.eligibilityPolicy.policyVersion,
      issuer: issuance.eligibilityPolicy.issuer,
      statusBaseUrl: issuance.eligibilityPolicy.statusBaseUrl,
      verifiedAt: issuance.eligibilityPolicy.verifiedAt,
      verifyReceiptProof:
        createMunicipalCivicEligibilityReceiptProofVerifier({
          publicKey: issuance.eligibilityPolicy.proof.publicKey,
          keyId: issuance.eligibilityPolicy.proof.keyId,
        }),
    },
    createdAt: NOW_SECONDS,
  });
  const request = {
    schemaVersion: "citizen_topic_suggestion_adoption_request_v1" as const,
    requestId: "20000000-0000-4000-8000-000000000004",
    idempotencyKey: "adoption-20000000-0000-4000-8000-000000000004",
    adoptionEvent: adoption.event,
  };

  const accepted = await setup.service.acceptAdoption(request);
  assert.equal(accepted.acceptanceReceipt.status, "accepted");
  assert.equal(
    accepted.entryState,
    "case_steward_review_required",
  );
  assert.equal(accepted.submittedToCivicWorkflow, false);
  assert.equal(accepted.administrativeEndorsement, false);
  assert.equal(accepted.bindingVote, false);
  assert.equal(accepted.councilDecision, false);
  assert.equal(accepted.treasuryEffect, false);
  assert.equal(accepted.paymentEffect, false);

  const afterReload = await setup.service.readPublicAdoption({
    participantSuggestionId: setup.suggestion.suggestionId,
    adopterPubkey: adoption.signerPubkey,
  });
  assert.deepEqual(afterReload, accepted);

  const tamperedProjections = [
    {
      ...structuredClone(accepted),
      unexpectedAuthorityField: "case-ready",
    },
    {
      ...structuredClone(accepted),
      adoptionEvent: {
        ...structuredClone(accepted.adoptionEvent),
        sig: "0".repeat(128),
      },
    },
    {
      ...structuredClone(accepted),
      eligibilityReceipt: {
        ...structuredClone(accepted.eligibilityReceipt),
        proof: {
          ...structuredClone(accepted.eligibilityReceipt.proof),
          signature: "tampered",
        },
      },
    },
    {
      ...structuredClone(accepted),
      acceptanceReceipt: {
        ...structuredClone(accepted.acceptanceReceipt),
        receiptChecksum: "f".repeat(64),
      },
    },
    {
      ...structuredClone(accepted),
      submittedToCivicWorkflow: true,
    },
  ];
  for (const tampered of tamperedProjections) {
    setup.setPublicReadProjection(tampered);
    await assert.rejects(
      setup.service.readPublicAdoption({
        participantSuggestionId: setup.suggestion.suggestionId,
        adopterPubkey: adoption.signerPubkey,
      }),
      /citizen_adoption_public_projection_invalid/,
    );
  }
  setup.setPublicReadProjection(undefined);

  setup.setNow(NOW_SECONDS + 3_600);
  const retry = await setup.service.acceptAdoption(request);
  assert.deepEqual(retry, accepted);
  assert.equal(setup.getAdoptionAcceptCalls(), 1);

  const conflictingEvent = buildNoteEvent(
    ADOPTER_SECRET,
    adoption.event.content,
    {
      createdAt: adoption.event.created_at + 1,
      tags: adoption.event.tags,
    },
  );
  await assert.rejects(
    setup.service.acceptAdoption({
      ...request,
      adoptionEvent: conflictingEvent,
    }),
    /citizen_adoption_idempotency_conflict/,
  );
  assert.equal(setup.getAdoptionAcceptCalls(), 1);
});
