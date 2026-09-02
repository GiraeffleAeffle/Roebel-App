import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRestrictedSupabaseSyntheticCitizenAdoptionAdapter,
  restrictedSyntheticCitizenAdoptionRpcNames,
} from "../src/synthetic-citizen-adoption-supabase-adapter.ts";

const MUNICIPALITY = "roebel-mueritz";
const SUGGESTION = "a".repeat(64);
const ADOPTER = "b".repeat(64);
const EVENT = "c".repeat(64);
const CONTRACT = "0x0be374808a567c9088ac8208b90a4239432b3220";

const challenge = {
  schemaVersion: "staging_test_citizen_pass_v1",
  challengeId: "1".repeat(32),
  audience: "roebel-staging-synthetic-citizen-adoption",
  chainId: 100,
  testCitizenNftContract: CONTRACT,
  subjectPubkey: ADOPTER,
  municipalityId: MUNICIPALITY,
  policyVersion: "roebel-test-citizen-nft-v2-staging-2026-09",
  participantSuggestionId: SUGGESTION,
  topicId: `urn:stadtstack:topic:municipality:${MUNICIPALITY}:test`,
  issuedAt: 1_788_264_000,
  expiresAt: 1_788_264_300,
  environment: "staging",
  testOnly: true,
  authorityBinding: "none",
  canonicalChallenge: "{}",
  message: "{}",
} as const;

const projection = {
  schemaVersion: "public_synthetic_citizen_adoption_projection_v1",
  participantSuggestionId: SUGGESTION,
  proofEvent: { id: EVENT },
  tracer: {
    schemaVersion: "synthetic_citizen_adoption_tracer_v1",
    municipalityId: MUNICIPALITY,
    adopterPubkey: ADOPTER,
  },
  acceptanceReceipt: {
    schemaVersion: "synthetic_citizen_adoption_tracer_acceptance_v1",
    municipalityId: MUNICIPALITY,
  },
  labels: {
    citizenship: "Test-Bürger-Pass – keine reale Bürgerberechtigung",
  },
  entryState: "synthetic_journey_preview_only",
  environment: "staging",
  testOnly: true,
  authorityBinding: "none",
  submittedToCivicWorkflow: false,
  civicCaseCreated: false,
  administrativeEndorsement: false,
  bindingVote: false,
  councilDecision: false,
  treasuryEffect: false,
  paymentEffect: false,
} as const;

test("synthetic storage adapter calls only its five fixed Vault-checked RPCs", async () => {
  const calls: Array<{ rpc: string; body: Record<string, unknown>; headers: Headers }> = [];
  const adapter = createRestrictedSupabaseSyntheticCitizenAdoptionAdapter({
    url: "https://example.supabase.co",
    anonKey: "public-anon-key-which-is-long-enough",
    rpcSecret: "r".repeat(32),
    municipalityId: MUNICIPALITY,
    fetch: async (url, init) => {
      const rpc = new URL(String(url)).pathname.split("/").at(-1)!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ rpc, body, headers: new Headers(init?.headers) });
      if (rpc === restrictedSyntheticCitizenAdoptionRpcNames.issueChallenge) {
        return new Response(JSON.stringify(body.p_challenge), { status: 200 });
      }
      if (rpc === restrictedSyntheticCitizenAdoptionRpcNames.consumeChallenge) {
        return new Response(JSON.stringify(challenge), { status: 200 });
      }
      if (rpc === restrictedSyntheticCitizenAdoptionRpcNames.acceptTracer) {
        return new Response(JSON.stringify(body.p_public_projection), { status: 200 });
      }
      return new Response(JSON.stringify(projection), { status: 200 });
    },
  });

  await adapter.issue({
    challenge,
    walletAddress: "0x1111111111111111111111111111111111111111",
    sessionBindingSha256: "2".repeat(64),
  });
  await adapter.consume({
    challengeId: challenge.challengeId,
    walletAddress: "0x1111111111111111111111111111111111111111",
    sessionBindingSha256: "2".repeat(64),
    consumedAt: challenge.issuedAt,
  });
  await adapter.resolveReplay({
    requestId: "00000000-0000-4000-8000-000000000001",
    idempotencyKeySha256: "3".repeat(64),
    requestChecksum: "4".repeat(64),
    proofEventId: EVENT,
  });
  await adapter.accept({
    requestId: "00000000-0000-4000-8000-000000000001",
    idempotencyKeySha256: "3".repeat(64),
    requestChecksum: "4".repeat(64),
    receivedAt: 1_788_264_000,
    maxEventClockSkewSeconds: 300,
    proofEvent: { id: EVENT } as never,
    privateEligibilityEvidence: {
      active: true,
      chainId: 100,
      contractAddress: CONTRACT,
      finalizedBlockNumber: 12_345n,
      finalizedBlockHash: `0x${"5".repeat(64)}`,
    },
    projection: projection as never,
  });
  await adapter.readPublic({
    participantSuggestionId: SUGGESTION,
    adopterPubkey: ADOPTER,
  });

  assert.deepEqual(calls.map(({ rpc }) => rpc), Object.values(
    restrictedSyntheticCitizenAdoptionRpcNames,
  ));
  for (const call of calls) {
    assert.equal(call.headers.get("x-staging-participant-rpc-secret"), "r".repeat(32));
    assert.equal(call.headers.get("authorization"), "Bearer public-anon-key-which-is-long-enough");
    assert.equal(JSON.stringify(call.body).includes("service_role"), false);
  }
  assert.deepEqual(calls[3]!.body.p_private_eligibility_evidence, {
    active: true,
    chainId: 100,
    contractAddress: CONTRACT,
    finalizedBlockNumber: "12345",
    finalizedBlockHash: `0x${"5".repeat(64)}`,
  });
});
