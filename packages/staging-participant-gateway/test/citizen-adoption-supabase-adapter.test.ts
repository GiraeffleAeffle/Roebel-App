import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAgentNoteEvent,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  getPublicKeyHex,
} from "@netizen-labs/nostr";

import {
  createRestrictedSupabaseCitizenAdoptionAdapter,
  restrictedCitizenAdoptionRpcNames,
} from "../src/citizen-adoption-supabase-adapter.ts";

const RPC_CONFIG = {
  url: "https://example.supabase.co",
  anonKey: "public-anon-key-which-is-long-enough",
  rpcSecret: "r".repeat(32),
  municipalityId: "roebel-mueritz",
} as const;

const CHALLENGE = {
  schemaVersion: "municipal_civic_eligibility_challenge_v1",
  challengeId: "1".repeat(32),
  audience: "roebel-staging-citizen-adoption",
  sessionBindingSha256: "2".repeat(64),
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 100,
  subjectPubkey: "3".repeat(64),
  municipalityId: "roebel-mueritz",
  policyVersion: "roebel-citizen-nft-v2-staging-2026-09",
  participantSuggestionId: "4".repeat(64),
  topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
  issuedAt: 1_788_264_000,
  expiresAt: 1_788_264_300,
  authorityBinding: "civic_eligibility_only",
  canonicalChallenge: "{\"closed\":true}",
  message: "{\"closed\":true}",
} as const;

const ELIGIBILITY_RECEIPT = {
  schemaVersion: "municipal_civic_eligibility_receipt_v1",
  eligibilityCore: {
    municipalityId: "roebel-mueritz",
    eligibilityClass: "municipal_civic_participation",
    subjectPubkey: CHALLENGE.subjectPubkey,
    participantSuggestionId: CHALLENGE.participantSuggestionId,
    topicId: CHALLENGE.topicId,
    policyVersion: CHALLENGE.policyVersion,
    issuer: "roebel-staging-citizen-verifier",
    issuedAt: CHALLENGE.issuedAt + 10,
    expiresAt: CHALLENGE.issuedAt + 910,
    authorityBinding: "civic_eligibility_only",
  },
  receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${"6".repeat(64)}`,
  payloadChecksum: "6".repeat(64),
  statusRef:
    "https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility/status/" +
    "6".repeat(64),
  proof: {
    algorithm: "Ed25519",
    keyId: "roebel-staging-eligibility-issuer-2026-09",
    signature: "A".repeat(86),
  },
} as const;

function publishedParticipantSuggestion() {
  const participantSecret = new Uint8Array(32).fill(41);
  const meckySecret = new Uint8Array(32).fill(42);
  const meckyPubkey = getPublicKeyHex(meckySecret);
  const sourcePost = buildNoteEvent(participantSecret, "Treffpunkt", {
    createdAt: CHALLENGE.issuedAt - 4,
  });
  const discussion = buildCivicTopicPromotionEvent(participantSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId: CHALLENGE.topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: meckyPubkey,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: CHALLENGE.issuedAt - 3,
  });
  const answer = buildAgentNoteEvent({
    name: "mecky",
    nodeId: "roebel",
    secretKey: meckySecret,
    publicKey: meckyPubkey,
    npub: "npub1test",
  }, "Geprüfte Antwort", {
    createdAt: CHALLENGE.issuedAt - 2,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
      ["municipality", "roebel-mueritz"],
      ["topic", CHALLENGE.topicId],
      [
        "evidence",
        `sha256:${"c".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });
  return {
    discussion,
    suggestion: buildParticipantTopicSuggestion(participantSecret, {
      binding: {
        municipalityId: "roebel-mueritz",
        topicId: CHALLENGE.topicId,
      },
      sourcePost,
      sourceDiscussion: discussion,
      sourceAnswer: answer,
      agentPubkey: meckyPubkey,
      title: "Treffpunkt prüfen",
      summary: "Die Optionen sollen menschlich geprüft werden.",
      createdAt: CHALLENGE.issuedAt - 1,
    }),
  };
}

function adoptionLedgerFixture() {
  const { suggestion } = publishedParticipantSuggestion();
  const adopterSecret = new Uint8Array(32).fill(43);
  const adopterPubkey = getPublicKeyHex(adopterSecret);
  const adoptionEvent = buildNoteEvent(adopterSecret, JSON.stringify({
    participantSuggestionId: suggestion.suggestionId,
    eligibilityReceiptId: ELIGIBILITY_RECEIPT.receiptId,
  }), { createdAt: CHALLENGE.issuedAt + 20 });
  const adoptionId =
    `urn:stadtstack:citizen-topic-suggestion-adoption:${"9".repeat(64)}`;
  const adoption = {
    schemaVersion: "citizen_adopted_topic_suggestion_v1",
    adoptionId,
    signerPubkey: adopterPubkey,
    participantSuggestionId: suggestion.suggestionId,
    eligibilityReceiptId: ELIGIBILITY_RECEIPT.receiptId,
    adoption: {
      schemaVersion: "public_citizen_topic_suggestion_adoption_v1",
      adoptionId,
      municipalityId: "roebel-mueritz",
      topicId: suggestion.draft.topicId,
      participantSuggestionId: suggestion.suggestionId,
      participantSuggestionRef: `nostr://event/${suggestion.suggestionId}`,
      participantPubkey: suggestion.signerPubkey,
      sourceDiscussionId: suggestion.draft.sourceDiscussionId,
      sourceAnswerReceiptId: suggestion.draft.sourceAnswerReceiptId,
      adopterPubkey,
      eligibilityReceiptId: ELIGIBILITY_RECEIPT.receiptId,
      eligibilityReceiptChecksum: ELIGIBILITY_RECEIPT.payloadChecksum,
      title: suggestion.draft.title,
      summary: suggestion.draft.summary,
      entryState: "case_steward_review_required",
      authorityBinding: "civic_eligibility_only",
      submittedToCivicWorkflow: false,
    },
    event: adoptionEvent,
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
  } as const;
  const acceptanceReceipt = {
    schemaVersion: "citizen_topic_suggestion_adoption_acceptance_receipt_v1",
    adoptionId,
    adoptionEventId: adoptionEvent.id,
    municipalityId: "roebel-mueritz",
    topicId: suggestion.draft.topicId,
    participantSuggestionId: suggestion.suggestionId,
    adopterPubkey,
    eligibilityReceiptId: ELIGIBILITY_RECEIPT.receiptId,
    requestChecksum: "a".repeat(64),
    eventCreatedAt: adoptionEvent.created_at,
    receivedAt: CHALLENGE.issuedAt + 21,
    policyVersion: CHALLENGE.policyVersion,
    status: "accepted",
    authorityBinding: "civic_eligibility_only",
    receiptChecksum: "b".repeat(64),
  } as const;
  const projection = {
    schemaVersion: "public_citizen_adoption_projection_v1",
    participantSuggestionId: suggestion.suggestionId,
    adoptionEvent,
    eligibilityReceipt: ELIGIBILITY_RECEIPT,
    acceptanceReceipt,
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
    administrativeEndorsement: false,
    bindingVote: false,
    councilDecision: false,
    treasuryEffect: false,
    paymentEffect: false,
  } as const;
  return { adoption, acceptanceReceipt, projection };
}

test("issues the exact durable challenge through one fixed secret-bound RPC", async () => {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(CHALLENGE), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });

  assert.deepEqual(await adapter.issue(CHALLENGE), CHALLENGE);
  assert.deepEqual(calls.map(({ url, body }) => ({ url, body })), [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.issueChallenge}`,
    body: { p_challenge: CHALLENGE },
  }]);
  assert.equal(calls[0]?.headers.get("apikey"), RPC_CONFIG.anonKey);
  assert.equal(
    calls[0]?.headers.get("authorization"),
    `Bearer ${RPC_CONFIG.anonKey}`,
  );
  assert.equal(
    calls[0]?.headers.get("x-staging-participant-rpc-secret"),
    RPC_CONFIG.rpcSecret,
  );
});

test("consumes the exact session-bound challenge through one fixed RPC", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(CHALLENGE), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });

  assert.deepEqual(await adapter.consume({
    challengeId: CHALLENGE.challengeId,
    walletAddress: CHALLENGE.walletAddress,
    sessionBindingSha256: CHALLENGE.sessionBindingSha256,
    consumedAt: CHALLENGE.issuedAt + 10,
  }), CHALLENGE);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.consumeChallenge}`,
    body: {
      p_challenge_id: CHALLENGE.challengeId,
      p_wallet_address: CHALLENGE.walletAddress,
      p_session_binding_sha256: CHALLENGE.sessionBindingSha256,
      p_consumed_at: String(CHALLENGE.issuedAt + 10),
    },
  }]);
});

test("normalizes missing, used, expired, and mismatched challenge failures", async () => {
  for (const databaseFailure of [
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_MISSING",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_USED",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_EXPIRED",
    "STAGING_PARTICIPANT_CITIZEN_CHALLENGE_MISMATCH",
  ]) {
    const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
      ...RPC_CONFIG,
      fetch: async () => new Response(
        JSON.stringify({ message: databaseFailure }),
        { status: 400 },
      ),
      resolveSuggestionThread: async () => null,
    });
    await assert.rejects(adapter.consume({
      challengeId: CHALLENGE.challengeId,
      walletAddress: CHALLENGE.walletAddress,
      sessionBindingSha256: CHALLENGE.sessionBindingSha256,
      consumedAt: CHALLENGE.issuedAt + 10,
    }), /citizen_eligibility_challenge_invalid/u);
  }
});

test("stores private finalized evidence but returns only the public-safe receipt", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(ELIGIBILITY_RECEIPT), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });
  const privateEligibilityEvidence = {
    active: true,
    chainId: 100,
    contractAddress: "0x59aa26f499d7c2b3ec2c8524ed06f54fc4e85de5",
    finalizedBlockNumber: 12_345n,
    finalizedBlockHash: `0x${"8".repeat(64)}`,
  } as const;

  assert.deepEqual(await adapter.store({
    challenge: CHALLENGE,
    receipt: ELIGIBILITY_RECEIPT,
    privateEligibilityEvidence,
  }), ELIGIBILITY_RECEIPT);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.storeEligibilityReceipt}`,
    body: {
      p_challenge_id: CHALLENGE.challengeId,
      p_receipt: ELIGIBILITY_RECEIPT,
      p_private_eligibility_evidence: {
        ...privateEligibilityEvidence,
        finalizedBlockNumber: "12345",
      },
    },
  }]);
  assert.equal("privateEligibilityEvidence" in ELIGIBILITY_RECEIPT, false);
});

test("resolves only one exact public-safe eligibility receipt", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(ELIGIBILITY_RECEIPT), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });

  assert.deepEqual(await adapter.resolve({
    receiptId: ELIGIBILITY_RECEIPT.receiptId,
  }), ELIGIBILITY_RECEIPT);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.resolveEligibilityReceipt}`,
    body: { p_receipt_id: ELIGIBILITY_RECEIPT.receiptId },
  }]);
});

test("resolves a published suggestion through its durable root and exact workbench thread", async () => {
  const { discussion, suggestion } = publishedParticipantSuggestion();
  const rpcCalls: Array<{ url: string; body: unknown }> = [];
  const threadCalls: string[] = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      rpcCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        municipality_id: "roebel-mueritz",
        suggestion_id: suggestion.suggestionId,
        discussion_root_id: discussion.id,
        source_author_pubkey: suggestion.signerPubkey,
      }), { status: 200 });
    },
    resolveSuggestionThread: async ({ discussionRootId }) => {
      threadCalls.push(discussionRootId);
      return {
        schemaVersion: "roebel_staging_argument_thread_v1",
        rootEvent: discussion,
        suggestion,
        authorityBinding: "none",
      };
    },
  });

  assert.deepEqual(await adapter.resolveParticipantSuggestion({
    participantSuggestionId: suggestion.suggestionId,
  }), suggestion);
  assert.deepEqual(rpcCalls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.resolveSuggestionRoot}`,
    body: {
      p_municipality_id: "roebel-mueritz",
      p_suggestion_id: suggestion.suggestionId,
    },
  }]);
  assert.deepEqual(threadCalls, [discussion.id]);
});

test("accepts the exact adoption tuple through one atomic ledger RPC", async () => {
  const fixture = adoptionLedgerFixture();
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(fixture.projection), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });
  const input = {
    requestId: "20000000-0000-4000-8000-000000000004",
    idempotencyKeySha256: "c".repeat(64),
    requestChecksum: fixture.acceptanceReceipt.requestChecksum,
    receivedAt: fixture.acceptanceReceipt.receivedAt,
    maxEventClockSkewSeconds: 300,
    adoption: fixture.adoption,
    eligibilityReceipt: ELIGIBILITY_RECEIPT,
    acceptanceReceipt: fixture.acceptanceReceipt,
  } as const;

  assert.deepEqual(await adapter.accept(input), fixture.projection);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.acceptAdoption}`,
    body: {
      p_municipality_id: "roebel-mueritz",
      p_request_id: input.requestId,
      p_idempotency_key_sha256: input.idempotencyKeySha256,
      p_request_checksum: input.requestChecksum,
      p_received_at: String(input.receivedAt),
      p_max_event_clock_skew_seconds: "300",
      p_adoption: fixture.adoption,
      p_eligibility_receipt: ELIGIBILITY_RECEIPT,
      p_acceptance_receipt: fixture.acceptanceReceipt,
    },
  }]);
});

test("an exact late retry resolves the original durable projection", async () => {
  const fixture = adoptionLedgerFixture();
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(fixture.projection), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });
  const input = {
    requestId: "20000000-0000-4000-8000-000000000004",
    idempotencyKeySha256: "c".repeat(64),
    requestChecksum: fixture.acceptanceReceipt.requestChecksum,
    adoptionEventId: fixture.projection.adoptionEvent.id,
  } as const;

  assert.deepEqual(await adapter.resolveReplay(input), fixture.projection);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.resolveReplay}`,
    body: {
      p_municipality_id: "roebel-mueritz",
      p_request_id: input.requestId,
      p_idempotency_key_sha256: input.idempotencyKeySha256,
      p_request_checksum: input.requestChecksum,
      p_adoption_event_id: input.adoptionEventId,
    },
  }]);
});

test("reads the public projection by the exact suggestion and adopter tuple", async () => {
  const fixture = adoptionLedgerFixture();
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
    ...RPC_CONFIG,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(fixture.projection), { status: 200 });
    },
    resolveSuggestionThread: async () => null,
  });
  const input = {
    participantSuggestionId: fixture.projection.participantSuggestionId,
    adopterPubkey: fixture.acceptanceReceipt.adopterPubkey,
  } as const;

  assert.deepEqual(await adapter.readPublic(input), fixture.projection);
  assert.deepEqual(calls, [{
    url: `https://example.supabase.co/rest/v1/rpc/${restrictedCitizenAdoptionRpcNames.readPublicAdoption}`,
    body: {
      p_municipality_id: "roebel-mueritz",
      p_participant_suggestion_id: input.participantSuggestionId,
      p_adopter_pubkey: input.adopterPubkey,
    },
  }]);
  assert.equal(
    JSON.stringify(fixture.projection).includes("finalizedBlock"),
    false,
  );
  assert.equal(JSON.stringify(fixture.projection).includes("walletAddress"), false);
});

test("normalizes tuple, request, idempotency, and event conflicts explicitly", async () => {
  const fixture = adoptionLedgerFixture();
  for (const databaseFailure of [
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_TUPLE_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_REQUEST_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_IDEMPOTENCY_CONFLICT",
    "STAGING_PARTICIPANT_CITIZEN_ADOPTION_EVENT_CONFLICT",
  ]) {
    const adapter = createRestrictedSupabaseCitizenAdoptionAdapter({
      ...RPC_CONFIG,
      fetch: async () => new Response(
        JSON.stringify({ message: databaseFailure }),
        { status: 400 },
      ),
      resolveSuggestionThread: async () => null,
    });
    await assert.rejects(adapter.accept({
      requestId: "20000000-0000-4000-8000-000000000004",
      idempotencyKeySha256: "c".repeat(64),
      requestChecksum: fixture.acceptanceReceipt.requestChecksum,
      receivedAt: fixture.acceptanceReceipt.receivedAt,
      maxEventClockSkewSeconds: 300,
      adoption: fixture.adoption,
      eligibilityReceipt: ELIGIBILITY_RECEIPT,
      acceptanceReceipt: fixture.acceptanceReceipt,
    }), /citizen_adoption_idempotency_conflict/u);
  }
});
