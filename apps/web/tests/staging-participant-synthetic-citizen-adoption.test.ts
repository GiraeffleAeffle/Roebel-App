import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildAgentNoteEvent,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  getPublicKeyHex,
} from "@netizen-labs/nostr";

import {
  loadCachedSyntheticAdopterPubkey,
  loadPublicSyntheticCitizenAdoption,
  recoverSyntheticCitizenAdoption,
  saveCachedSyntheticAdopterPubkey,
  STAGING_TEST_CITIZEN_NFT_ADDRESS,
  SyntheticCitizenAdoptionClientError,
  traceSyntheticCitizenAdoption,
} from "../src/lib/staging-participant/synthetic-citizen-adoption.ts";

const PARTICIPANT_SECRET = new Uint8Array(32).fill(41);
const ADOPTER_SECRET = new Uint8Array(32).fill(43);
const MECKY_SECRET = new Uint8Array(32).fill(42);
const NOW = 1_788_264_000;
const originalFetch = globalThis.fetch;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function suggestion() {
  const meckyPubkey = getPublicKeyHex(MECKY_SECRET);
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:test-thema";
  const sourcePost = buildNoteEvent(PARTICIPANT_SECRET, "Quelle", {
    createdAt: NOW - 4,
  });
  const discussion = buildCivicTopicPromotionEvent(PARTICIPANT_SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Test-Thema",
    agentPubkey: meckyPubkey,
    content: "@Mecky Was ist geprüft?",
    createdAt: NOW - 3,
  });
  const answer = buildAgentNoteEvent(
    {
      name: "mecky",
      nodeId: "roebel",
      secretKey: MECKY_SECRET,
      publicKey: meckyPubkey,
      npub: "npub1test",
    },
    "Geprüfte Antwort",
    {
      createdAt: NOW - 2,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
        ["municipality", "roebel-mueritz"],
        ["topic", topicId],
        ["evidence", `sha256:${"c".repeat(64)}`, "https://example.test/source"],
      ],
    },
  );
  return buildParticipantTopicSuggestion(PARTICIPANT_SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: meckyPubkey,
    title: "Test prüfen",
    summary: "Nur im Staging testen.",
    createdAt: NOW - 1,
  });
}

function challenge(participantSuggestion = suggestion()) {
  const core = {
    schemaVersion: "staging_test_citizen_pass_v1" as const,
    challengeId: "1".repeat(32),
    audience: "roebel-staging-synthetic-citizen-adoption" as const,
    chainId: 100 as const,
    testCitizenNftContract: STAGING_TEST_CITIZEN_NFT_ADDRESS,
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-test-citizen-nft-v2-staging-2026-09",
    participantSuggestionId: participantSuggestion.suggestionId,
    topicId: participantSuggestion.draft.topicId,
    issuedAt: NOW,
    expiresAt: NOW + 300,
    environment: "staging" as const,
    testOnly: true as const,
    authorityBinding: "none" as const,
  };
  const canonicalChallenge = stableJson(core);
  return { ...core, canonicalChallenge, message: canonicalChallenge };
}

function projection(participantSuggestion: ReturnType<typeof suggestion>, proofEvent: ReturnType<typeof buildNoteEvent>) {
  const adopterPubkey = proofEvent.pubkey;
  const tracer = {
    schemaVersion: "synthetic_citizen_adoption_tracer_v1",
    tracerId: `urn:stadtstack:synthetic-citizen-adoption-tracer:${"d".repeat(64)}`,
    municipalityId: "roebel-mueritz",
    topicId: participantSuggestion.draft.topicId,
    participantSuggestionId: participantSuggestion.suggestionId,
    participantSuggestionRef: `nostr://event/${participantSuggestion.suggestionId}`,
    participantPubkey: participantSuggestion.signerPubkey,
    sourceDiscussionId: participantSuggestion.draft.sourceDiscussionId,
    sourceAnswerReceiptId: participantSuggestion.draft.sourceAnswerReceiptId,
    adopterPubkey,
    proofEventId: proofEvent.id,
    title: participantSuggestion.draft.title,
    summary: participantSuggestion.draft.summary,
    entryState: "synthetic_journey_preview_only",
    environment: "staging",
    testOnly: true,
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  } as const;
  return {
    schemaVersion: "public_synthetic_citizen_adoption_projection_v1",
    participantSuggestionId: participantSuggestion.suggestionId,
    proofEvent,
    tracer,
    acceptanceReceipt: {
      schemaVersion: "synthetic_citizen_adoption_tracer_acceptance_v1",
      tracerId: tracer.tracerId,
      proofEventId: proofEvent.id,
      municipalityId: tracer.municipalityId,
      topicId: tracer.topicId,
      participantSuggestionId: tracer.participantSuggestionId,
      adopterPubkey,
      requestChecksum: "e".repeat(64),
      eventCreatedAt: proofEvent.created_at,
      receivedAt: proofEvent.created_at,
      policyVersion: "roebel-test-citizen-nft-v2-staging-2026-09",
      status: "accepted_for_synthetic_preview",
      environment: "staging",
      testOnly: true,
      authorityBinding: "none",
      receiptChecksum: "f".repeat(64),
    },
    labels: {
      citizenship: "Test-Bürger-Pass – keine reale Bürgerberechtigung",
      civicWorkflow: "Nur synthetische Vorschau – kein CivicCase und keine Verwaltungsbefürwortung",
      governance: "Keine bindende Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung",
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
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "window");
});

test("browser signs the exact test-pass challenge and receives only a synthetic projection", async () => {
  const participantSuggestion = suggestion();
  const pass = challenge(participantSuggestion);
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/challenge")) {
      return new Response(JSON.stringify(pass), { status: 200 });
    }
    return new Response(JSON.stringify(projection(
      participantSuggestion,
      body.nostrProofEvent as ReturnType<typeof buildNoteEvent>,
    )), { status: 200 });
  };
  const result = await traceSyntheticCitizenAdoption({
    participantSuggestion,
    session: {
      async getNostrPubkey() { return getPublicKeyHex(ADOPTER_SECRET); },
      async signMessage(message) {
        assert.equal(message, pass.message);
        return "0x1234";
      },
      async signSyntheticCitizenPassChallenge(input) {
        assert.deepEqual(input, pass);
        return buildNoteEvent(ADOPTER_SECRET, input.message, {
          createdAt: input.issuedAt,
          tags: [
            ["schema", "staging_test_citizen_pass_proof_v1"],
            ["challenge", input.challengeId],
            ["e", input.participantSuggestionId, "", "synthetic-adoption-test"],
            ["municipality", input.municipalityId],
            ["test-only", "true"],
          ],
        });
      },
    },
  });
  assert.equal(result.authorityBinding, "none");
  assert.equal(result.civicCaseCreated, false);
  assert.equal(Object.hasOwn(result, "eligibilityReceipt"), false);
  assert.equal(Object.hasOwn(result, "adoptionEvent"), false);
  assert.deepEqual(calls.map(({ url }) => url), [
    "/api/staging-participant/v1/synthetic-citizen-adoption/challenge",
    "/api/staging-participant/v1/synthetic-citizen-adoption/tracers",
  ]);
  assert.equal(calls[1]!.body.schemaVersion, "synthetic_citizen_adoption_tracer_request_v1");
});

test("browser rejects wrong contract, cross-signer proof and nested projection drift", async () => {
  const participantSuggestion = suggestion();
  const pass = challenge(participantSuggestion);
  const session = {
    async getNostrPubkey() { return getPublicKeyHex(ADOPTER_SECRET); },
    async signMessage() { return "0x1234"; },
    async signSyntheticCitizenPassChallenge(input: typeof pass) {
      return buildNoteEvent(ADOPTER_SECRET, input.message, { createdAt: input.issuedAt });
    },
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...pass,
    testCitizenNftContract: "0x2222222222222222222222222222222222222222",
  }), { status: 200 });
  await assert.rejects(
    traceSyntheticCitizenAdoption({ participantSuggestion, session }),
    (cause: unknown) => cause instanceof SyntheticCitizenAdoptionClientError &&
      cause.code === "synthetic_citizen_adoption_challenge_invalid",
  );

  let proofEvent = buildNoteEvent(ADOPTER_SECRET, pass.message, { createdAt: pass.issuedAt });
  globalThis.fetch = async (url) => String(url).endsWith("/challenge")
    ? new Response(JSON.stringify(pass), { status: 200 })
    : new Response(JSON.stringify({
        ...projection(participantSuggestion, proofEvent),
        proofEvent: buildNoteEvent(new Uint8Array(32).fill(44), pass.message, {
          createdAt: pass.issuedAt,
        }),
      }), { status: 200 });
  await assert.rejects(
    traceSyntheticCitizenAdoption({ participantSuggestion, session: {
      ...session,
      async signSyntheticCitizenPassChallenge() { return proofEvent; },
    } }),
    /synthetic_citizen_adoption_acceptance_invalid/u,
  );

  globalThis.fetch = async (url) => String(url).endsWith("/challenge")
    ? new Response(JSON.stringify(pass), { status: 200 })
    : new Response(JSON.stringify({
        ...projection(participantSuggestion, proofEvent),
        tracer: { ...projection(participantSuggestion, proofEvent).tracer, extra: true },
      }), { status: 200 });
  await assert.rejects(
    traceSyntheticCitizenAdoption({ participantSuggestion, session: {
      ...session,
      async signSyntheticCitizenPassChallenge() { return proofEvent; },
    } }),
    /synthetic_citizen_adoption_acceptance_invalid/u,
  );
});

test("synthetic adopter hint is session-scoped and isolated by account", () => {
  const sessionValues = new Map<string, string>();
  const localValues = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
      },
      localStorage: {
        getItem: (key: string) => localValues.get(key) ?? null,
        setItem: (key: string, value: string) => localValues.set(key, value),
      },
    },
  });
  const wallet = "0x1111111111111111111111111111111111111111";
  const pubkey = getPublicKeyHex(ADOPTER_SECRET);
  saveCachedSyntheticAdopterPubkey(wallet, pubkey);
  assert.equal(loadCachedSyntheticAdopterPubkey(wallet), pubkey);
  assert.equal(sessionValues.size, 1);
  assert.equal(localValues.size, 0);

  assert.equal(loadCachedSyntheticAdopterPubkey("0x2222222222222222222222222222222222222222"), null);
  sessionValues.clear();
  assert.equal(loadCachedSyntheticAdopterPubkey(wallet), null);
});

function recoveryFixture() {
  const participantSuggestion = suggestion();
  const pass = challenge(participantSuggestion);
  const proof = buildNoteEvent(ADOPTER_SECRET, pass.message, { createdAt: pass.issuedAt });
  const saved = projection(participantSuggestion, proof);
  const session = {
    snapshot: { credential: { address: "0x1111111111111111111111111111111111111111" } },
    async getNostrPubkey() { return proof.pubkey; },
  } as Parameters<typeof recoverSyntheticCitizenAdoption>[1];
  return { participantSuggestion, proof, saved, session };
}

test("a fresh tab recovers the saved receipt with one GET and no new test-pass signature", async () => {
  const { participantSuggestion, proof, saved, session } = recoveryFixture();
  const hints = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: {
      getItem: (key: string) => hints.get(key) ?? null,
      setItem: (key: string, value: string) => hints.set(key, value),
    } },
  });
  assert.equal(loadCachedSyntheticAdopterPubkey(session.snapshot.credential.address), null);
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    reads += 1;
    assert.equal(String(url), `/api/staging-participant/v1/synthetic-citizen-adoption/by-suggestion/${participantSuggestion.suggestionId}/adopter/${proof.pubkey}`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store");
    return new Response(JSON.stringify(saved));
  };
  const recovered = await recoverSyntheticCitizenAdoption(participantSuggestion.suggestionId, session);
  assert.deepEqual(recovered, saved);
  assert.equal(reads, 1);
  assert.equal(loadCachedSyntheticAdopterPubkey(session.snapshot.credential.address), proof.pubkey);
  assert.equal(recovered?.civicCaseCreated, false);
  assert.equal(recovered?.authorityBinding, "none");
});

test("recovery distinguishes absence from outage and never accepts another account's receipt", async () => {
  const { participantSuggestion, saved, session } = recoveryFixture();
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal(await recoverSyntheticCitizenAdoption(participantSuggestion.suggestionId, session), null);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(
    recoverSyntheticCitizenAdoption(participantSuggestion.suggestionId, session),
    /synthetic_citizen_adoption_projection_unavailable/u,
  );
  globalThis.fetch = async () => new Response(JSON.stringify(saved));
  await assert.rejects(
    recoverSyntheticCitizenAdoption(participantSuggestion.suggestionId, {
      ...session,
      async getNostrPubkey() { return getPublicKeyHex(PARTICIPANT_SECRET); },
    }),
    /synthetic_citizen_adoption_projection_invalid/u,
  );
  await assert.rejects(
    loadPublicSyntheticCitizenAdoption("../invalid", saved.proofEvent.pubkey),
    /synthetic_citizen_adoption_public_read_invalid/u,
  );
  assert.equal(loadCachedSyntheticAdopterPubkey(session.snapshot.credential.address), null);
});

test("blocked browser storage does not invalidate a verified saved receipt", async () => {
  const { participantSuggestion, saved, session } = recoveryFixture();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get sessionStorage() { throw new Error("storage blocked"); } },
  });
  globalThis.fetch = async () => new Response(JSON.stringify(saved));
  assert.deepEqual(await recoverSyntheticCitizenAdoption(participantSuggestion.suggestionId, session), saved);
});
