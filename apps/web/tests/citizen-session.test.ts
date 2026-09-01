import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createCitizenSession,
  type CitizenCredential,
} from "../src/lib/citizen-session/session";
import { createThirdwebCitizenSession } from "../src/lib/citizen-session/thirdweb-adapter";
import {
  NOSTR_KEY_DERIVATION_MESSAGE,
  buildAgentNoteEvent,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  getPublicKeyHex,
  verifyBindingEvent,
  verifyEvent,
} from "@netizen-labs/nostr";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"42".repeat(65)}`;

function credential(
  overrides: Partial<CitizenCredential> = {}
): CitizenCredential {
  return {
    kind: "thirdweb_smart_account",
    address: ADDRESS,
    chainId: 100,
    signMessage: async () => SIGNATURE,
    ...overrides,
  };
}

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

test("exposes a provider-neutral immutable citizen snapshot", () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });

  assert.deepEqual(session.snapshot, {
    schemaVersion: "roebel_citizen_session_v1",
    status: "authenticated",
    memberId: null,
    appAccountId: "account-1",
    credential: {
      kind: "thirdweb_smart_account",
      address: ADDRESS,
      chainId: 100,
    },
    assurance: {
      authentication: "provider_authenticated",
      authorization: "legacy_wallet_projection",
      recovery: "provider_managed",
    },
    capabilities: ["message_signing", "nostr_signing"],
  });
  assert.ok(Object.isFrozen(session.snapshot));
  assert.equal("provider" in session.snapshot, false);
});

test("derives the Nostr identity once and signs ordinary posts without exposing the key", async () => {
  let signatureCalls = 0;
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential({
      signMessage: async () => {
        signatureCalls += 1;
        return SIGNATURE;
      },
    }),
    memberId: null,
  });

  const first = await session.signPublicPost({
    content: "Normaler Beitrag",
    createdAt: 10,
  });
  const second = await session.signPublicPost({
    content: "Noch ein Beitrag",
    createdAt: 11,
  });

  assert.equal(signatureCalls, 1);
  assert.equal(first.kind, 1);
  assert.equal(first.tags.length, 0);
  assert.equal(first.content, "Normaler Beitrag");
  assert.equal(second.pubkey, first.pubkey);
  assert.equal(verifyEvent(first), true);
  assert.equal(verifyEvent(second), true);
  assert.equal("secretKey" in session, false);
});

test("signs the exact server-issued civic eligibility challenge with the derived Nostr identity", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const subjectPubkey = await session.getNostrPubkey();
  const challengeCore = {
    schemaVersion: "municipal_civic_eligibility_challenge_v1" as const,
    challengeId: "1".repeat(32),
    audience: "roebel-staging-citizen-adoption" as const,
    sessionBindingSha256: "3".repeat(64),
    walletAddress: ADDRESS,
    chainId: 100 as const,
    subjectPubkey,
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-civic-eligibility-2026-09",
    participantSuggestionId: "2".repeat(64),
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    issuedAt: 1_777_777_777,
    expiresAt: 1_777_778_077,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const challenge = {
    ...challengeCore,
    canonicalChallenge: stableJson(challengeCore),
    message: stableJson(challengeCore),
  };

  const event = await session.signCitizenEligibilityChallenge(challenge);

  assert.equal(verifyEvent(event), true);
  assert.equal(event.pubkey, subjectPubkey);
  assert.equal(event.created_at, challenge.issuedAt);
  assert.equal(event.content, challenge.message);
  assert.deepEqual(event.tags, [
    ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
    ["challenge", challenge.challengeId],
    ["e", challenge.participantSuggestionId, "", "eligibility-for-suggestion"],
    ["municipality", challenge.municipalityId],
  ]);
  assert.equal("secretKey" in session, false);
});

test("refuses a civic eligibility challenge whose bounded server fields are tampered", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const subjectPubkey = await session.getNostrPubkey();
  const core = {
    schemaVersion: "municipal_civic_eligibility_challenge_v1" as const,
    challengeId: "1".repeat(32),
    audience: "roebel-staging-citizen-adoption" as const,
    sessionBindingSha256: "3".repeat(64),
    walletAddress: ADDRESS,
    chainId: 100 as const,
    subjectPubkey,
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-civic-eligibility-2026-09",
    participantSuggestionId: "2".repeat(64),
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    issuedAt: 1_777_777_777,
    expiresAt: 1_777_778_077,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const canonicalChallenge = stableJson(core);
  const challenge = { ...core, canonicalChallenge, message: canonicalChallenge };
  const recanonicalizedWrongWallet = {
    ...core,
    walletAddress: "0x2222222222222222222222222222222222222222",
  };
  const cases = [
    { ...challenge, sessionBindingSha256: "4".repeat(64) },
    { ...challenge, policyVersion: "tampered-policy" },
    { ...challenge, topicId: `${core.topicId}:tampered` },
    { ...challenge, message: `${canonicalChallenge} ` },
    { ...challenge, expiresAt: core.issuedAt },
    {
      ...recanonicalizedWrongWallet,
      canonicalChallenge: stableJson(recanonicalizedWrongWallet),
      message: stableJson(recanonicalizedWrongWallet),
    },
  ];

  for (const candidate of cases) {
    await assert.rejects(
      () => session.signCitizenEligibilityChallenge(candidate),
      /citizen_eligibility_challenge_invalid/
    );
  }
});

test("creates a mutual wallet and Nostr admission proof without exposing either secret", async () => {
  const messages: string[] = [];
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential({
      signMessage: async ({ message }) => {
        messages.push(message);
        return SIGNATURE;
      },
    }),
    memberId: null,
  });

  const proof = await session.createAdmissionProof({ createdAt: 12 });

  assert.equal(messages[0], NOSTR_KEY_DERIVATION_MESSAGE);
  assert.equal(messages[1], proof.statement);
  assert.equal(proof.walletSignature, SIGNATURE);
  assert.equal(proof.bindingEvent.content, proof.statement);
  assert.deepEqual(verifyBindingEvent(proof.bindingEvent, ADDRESS), {
    valid: true,
    account: ADDRESS,
    pubkey: proof.bindingEvent.pubkey,
    npub: proof.statement.split("npub=")[1],
  });
  assert.equal("secretKey" in proof, false);
  assert.equal("derivationSignature" in proof, false);
});

test("adds only explicit Nostr mentions to an ordinary signed post", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const mecky = "ab".repeat(32);
  const post = await session.signPublicPost({
    content: "@Mecky, was ist dazu bekannt?",
    createdAt: 13,
    mentionPubkeys: [mecky, mecky],
  });

  assert.deepEqual(post.tags, [["p", mecky]]);
  assert.equal(verifyEvent(post), true);
});

test("binds an ordinary signed post to the immutable Röbel app post it mirrors", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const post = await session.signPublicPost({
    content: "Die Querung an der Marienfelder Straße ist unübersichtlich.",
    createdAt: 14,
    sourceAppPostId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61",
  });

  assert.deepEqual(post.tags, [
    ["source-app-post", "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61"],
  ]);
  assert.equal(verifyEvent(post), true);
});

test("signs an ordinary app conversation mention without civic authority tags", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const mention = await session.signConversationMention({
    content: "@Mecky, welche geprüften Informationen gibt es dazu?",
    createdAt: 15,
    agentPubkey: "ab".repeat(32),
    sourceAppPostId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61",
    sourceAppCommentId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a62",
  });

  assert.deepEqual(mention.tags, [
    ["p", "ab".repeat(32)],
    ["source-app-post", "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61"],
    ["source-app-comment", "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a62"],
    ["t", "roebel-app-conversation"],
  ]);
  assert.equal(verifyEvent(mention), true);
  assert.equal(
    mention.tags.some((tag) => tag[0] === "topic"),
    false
  );
  assert.equal(
    mention.tags.some((tag) => tag[0] === "case"),
    false
  );
  assert.equal(
    mention.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
});

test("promotes only the authenticated citizen's signed source post", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const sourcePost = await session.signPublicPost({
    content: "Hinweis",
    createdAt: 20,
  });
  const promoted = await session.promotePublicPost({
    sourcePost,
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche geprüften Informationen liegen vor?",
    createdAt: 21,
  });

  assert.equal(promoted.pubkey, sourcePost.pubkey);
  assert.equal(verifyEvent(promoted), true);
  assert.deepEqual(
    promoted.tags.find((tag) => tag[0] === "source-post"),
    ["source-post", sourcePost.id]
  );
  assert.deepEqual(
    promoted.tags.find((tag) => tag[0] === "topic"),
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    ]
  );
});

test("starts a signed civic topic without creating a CivicCase binding", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const sourcePost = await session.signPublicPost({
    content: "Uns fehlt ein gemeinsamer Treffpunkt.",
    createdAt: 30,
    sourceAppPostId: "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61",
  });

  const promoted = await session.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt in Röbel",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche geprüften Informationen liegen dazu vor?",
    createdAt: 31,
  });

  assert.equal(verifyEvent(promoted), true);
  assert.equal(
    promoted.tags.some((tag) => tag[0] === "case"),
    false
  );
  assert.equal(
    promoted.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
});

test("signs a participant's argument without exposing either citizen key", async () => {
  const author = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const participant = createCitizenSession({
    appAccountId: "account-2",
    credential: credential({
      address: "0x2222222222222222222222222222222222222222",
      signMessage: async () => `0x${"43".repeat(65)}`,
    }),
    memberId: null,
  });
  const sourcePost = await author.signPublicPost({
    content: "Uns fehlt ein gemeinsamer Treffpunkt.",
    createdAt: 40,
    sourceAppPostId: "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61",
  });
  const root = await author.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: "ab".repeat(32),
    content: "@Mecky, welche Optionen gibt es?",
    createdAt: 41,
  });
  const argument = await participant.signCivicArgument({
    rootEvent: root,
    parentEvent: root,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    stance: "con",
    content: "Betrieb und Zugänglichkeit müssen dauerhaft geklärt sein.",
    createdAt: 42,
  });

  assert.notEqual(argument.pubkey, root.pubkey);
  assert.equal(verifyEvent(argument), true);
  assert.equal(
    argument.tags.some((tag) => tag[0] === "case"),
    false
  );
});

test("signs a topic proposal that still awaits separate human case admission", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const meckySecret = new Uint8Array(32).fill(55);
  const meckyPubkey = getPublicKeyHex(meckySecret);
  const sourcePost = await session.signPublicPost({
    content: "Uns fehlt ein gemeinsamer Treffpunkt.",
    createdAt: 50,
  });
  const discussion = await session.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: meckyPubkey,
    content: "@Mecky, welche geprüften Optionen gibt es?",
    createdAt: 51,
  });
  const answer = buildNoteEvent(meckySecret, "Geprüfte Antwort", {
    createdAt: 52,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"b".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });

  const signed = await session.signTopicSuggestion({
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: meckyPubkey,
    title: "Offenen Treffpunkt prüfen",
    summary: "Die öffentlich diskutierten Optionen sollen geprüft werden.",
    createdAt: 53,
  });

  assert.equal(verifyEvent(signed.event), true);
  assert.equal(signed.signerPubkey, discussion.pubkey);
  assert.equal(signed.entryState, "awaiting_human_case_admission");
  assert.equal(signed.submittedToCivicWorkflow, false);
  assert.equal(signed.event.tags.some((tag) => tag[0] === "case"), false);
  assert.equal("secretKey" in signed, false);
});

test("signs one exact eligible-citizen adoption without creating civic effects", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    credential: credential(),
    memberId: null,
  });
  const adopterProbe = await session.signPublicPost({
    content: "Bürger-Schlüssel ableiten",
    createdAt: 60,
  });
  const participantSecret = new Uint8Array(32).fill(61);
  const meckySecret = new Uint8Array(32).fill(62);
  const meckyPubkey = getPublicKeyHex(meckySecret);
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(participantSecret, "Treffpunkt", {
    createdAt: 60,
  });
  const discussion = buildCivicTopicPromotionEvent(participantSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: meckyPubkey,
    content: "@Mecky, welche geprüften Optionen gibt es?",
    createdAt: 61,
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
      createdAt: 62,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
        ["municipality", "roebel-mueritz"],
        ["topic", topicId],
        [
          "evidence",
          `sha256:${"b".repeat(64)}`,
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
      title: "Offenen Treffpunkt prüfen",
      summary: "Die öffentlich diskutierten Optionen sollen geprüft werden.",
      createdAt: 63,
    }
  );
  const eligibilityCore = {
    municipalityId: "roebel-mueritz",
    eligibilityClass: "municipal_civic_participation" as const,
    subjectPubkey: adopterProbe.pubkey,
    participantSuggestionId: participantSuggestion.suggestionId,
    topicId,
    policyVersion: "roebel-civic-eligibility-2026-08",
    issuer: "roebel-citizen-verifier",
    issuedAt: 64,
    expiresAt: 90,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const eligibilityChecksum = checksum(eligibilityCore);
  const statusBaseUrl = "https://eligibility.roebel.example/status";
  const eligibilityReceipt = {
    schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
    eligibilityCore,
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${eligibilityChecksum}`,
    payloadChecksum: eligibilityChecksum,
    statusRef: `${statusBaseUrl}/${eligibilityChecksum}`,
    proof: {
      algorithm: "test-detached-v1",
      keyId: "roebel-citizen-verifier-2026-08",
      signature: "cHJvb2Y",
    },
  };
  const eligibilityPolicy = {
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-civic-eligibility-2026-08",
    issuer: "roebel-citizen-verifier",
    statusBaseUrl,
    verifiedAt: 65,
    verifyReceiptProof: () => true,
  };

  const adoption = await session.signCitizenTopicSuggestionAdoption({
    participantSuggestion,
    eligibilityReceipt,
    eligibilityPolicy,
    createdAt: 66,
  });

  assert.equal(verifyEvent(adoption.event), true);
  assert.equal(adoption.signerPubkey, adopterProbe.pubkey);
  assert.equal(
    adoption.participantSuggestionId,
    participantSuggestion.event.id
  );
  assert.equal(adoption.eligibilityReceiptId, eligibilityReceipt.receiptId);
  assert.equal(adoption.entryState, "case_steward_review_required");
  assert.equal(adoption.authorityBinding, "civic_eligibility_only");
  assert.equal(adoption.submittedToCivicWorkflow, false);
  assert.equal(
    adoption.event.tags.some((tag) =>
      [
        "case",
        "stadtstack-case",
        "vote",
        "governance",
        "treasury",
        "payment",
        "openDesk",
      ].includes(tag[0] ?? "")
    ),
    false
  );
  assert.equal("secretKey" in adoption, false);
});

test("fails closed when the provider returns a malformed signature", async () => {
  const session = createCitizenSession({
    appAccountId: null,
    credential: credential({ signMessage: async () => "not-a-signature" }),
    memberId: null,
  });

  await assert.rejects(
    () => session.signPublicPost({ content: "Nicht signierbar", createdAt: 1 }),
    /citizen_session_signature_invalid/
  );
});

test("adapts Thirdweb structurally without exposing its SDK to civic callers", async () => {
  const messages: string[] = [];
  const session = createThirdwebCitizenSession({
    account: {
      address: ADDRESS,
      signMessage: async ({ message }) => {
        messages.push(message);
        return SIGNATURE;
      },
    },
    appAccountId: "account-1",
    memberId: null,
  });

  assert.equal(session.snapshot.credential.kind, "thirdweb_smart_account");
  assert.equal(session.snapshot.credential.chainId, 100);
  assert.equal(await session.signMessage("Beweis"), SIGNATURE);
  assert.deepEqual(messages, ["Beweis"]);

  const coreSource = readFileSync(
    new URL("../src/lib/citizen-session/session.ts", import.meta.url),
    "utf8"
  );
  const adapterSource = readFileSync(
    new URL("../src/lib/citizen-session/thirdweb-adapter.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(coreSource, /from ["']thirdweb/);
  assert.doesNotMatch(adapterSource, /from ["']thirdweb/);
});
