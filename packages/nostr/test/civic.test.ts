import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  buildAgentNoteEvent,
  buildCivicArgumentEvent,
  buildParticipantTopicSuggestion,
  buildCitizenSignedTopicSuggestion,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildCivicTopicPromotionEvent,
  buildCitizenTopicSuggestionAdoption,
  buildNoteEvent,
  getPublicKeyHex,
  verifyCitizenSignedTopicSuggestion,
  verifyParticipantTopicSuggestion,
  verifyCitizenTopicSuggestionAdoption,
  verifyCivicTopicPromotionEvent,
  verifyEvent,
  type PublicParticipantTopicSuggestionDraftV1,
} from "../src/index";

const SECRET = new Uint8Array(32).fill(41);
const MECKY_SECRET = new Uint8Array(32).fill(42);
const MECKY = getPublicKeyHex(MECKY_SECRET);
const MECKY_AGENT = {
  name: "mecky",
  nodeId: "roebel",
  secretKey: MECKY_SECRET,
  publicKey: MECKY,
  npub: "npub1test",
};
const RECEIPT = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;

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

function citizenAdoptionFixture(options: {
  municipalityId?: string;
  topicSlug?: string;
  participantSecret?: Uint8Array;
  adopterSecret?: Uint8Array;
  policyVersion?: string;
  issuedAt?: number;
  verifiedAt?: number;
  expiresAt?: number;
  verifyReceiptProof?: (
    input: unknown,
    proof: { signature: string }
  ) => boolean;
} = {}) {
  const participantSecret = options.participantSecret ?? SECRET;
  const adopterSecret = options.adopterSecret ?? new Uint8Array(32).fill(43);
  const municipalityId = options.municipalityId ?? "roebel-mueritz";
  const topicId = `urn:stadtstack:topic:municipality:${municipalityId}:${options.topicSlug ?? "offener-treffpunkt"}`;
  const sourcePost = buildNoteEvent(participantSecret, "Treffpunkt", {
    createdAt: 800,
  });
  const discussion = buildCivicTopicPromotionEvent(participantSecret, {
    sourcePost,
    municipalityId,
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 801,
  });
  const answer = buildAgentNoteEvent(MECKY_AGENT, "Geprüfte Antwort", {
    createdAt: 802,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", municipalityId],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"c".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });
  const suggestion = buildParticipantTopicSuggestion(participantSecret, {
    binding: { municipalityId, topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: 803,
  });
  const policyVersion =
    options.policyVersion ?? `${municipalityId}-civic-eligibility-2026-08`;
  const issuer = `${municipalityId}-citizen-verifier`;
  const eligibilityCore = {
    municipalityId,
    eligibilityClass: "municipal_civic_participation" as const,
    subjectPubkey: getPublicKeyHex(adopterSecret),
    participantSuggestionId: suggestion.suggestionId,
    topicId,
    policyVersion,
    issuer,
    issuedAt: options.issuedAt ?? 803,
    expiresAt: options.expiresAt ?? 900,
    authorityBinding: "civic_eligibility_only" as const,
  };
  const payloadChecksum = checksum(eligibilityCore);
  const statusBaseUrl = `https://eligibility.${municipalityId}.example/status`;
  const eligibilityReceipt = {
    schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
    eligibilityCore,
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${payloadChecksum}`,
    payloadChecksum,
    statusRef: `${statusBaseUrl}/${payloadChecksum}`,
    proof: {
      algorithm: "test-detached-v1",
      keyId: `${municipalityId}-citizen-verifier-2026-08`,
      signature: "cHJvb2Y",
    },
  };
  const eligibilityPolicy = {
    municipalityId,
    policyVersion,
    issuer,
    statusBaseUrl,
    verifiedAt: options.verifiedAt ?? 850,
    verifyReceiptProof: options.verifyReceiptProof ?? (() => true),
  };
  return {
    participantSecret,
    adopterSecret,
    sourcePost,
    discussion,
    answer,
    suggestion,
    eligibilityReceipt,
    eligibilityPolicy,
    topicId,
  };
}

test("an ordinary signed post remains immutable when its author promotes it into a civic topic", () => {
  const sourcePost = buildNoteEvent(
    SECRET,
    "Auf der Marienfelder Straße fehlt eine gut einsehbare Querung.",
    { createdAt: 1_786_463_900 }
  );
  const sourceSnapshot = structuredClone(sourcePost);

  const promotion = buildCivicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    agentPubkey: MECKY,
    content:
      "@Mecky Welche geprueften Informationen helfen bei einer gemeinsamen Abwaegung?",
    createdAt: 1_786_464_000,
  });

  assert.deepEqual(sourcePost, sourceSnapshot);
  assert.equal(verifyEvent(promotion), true);
  assert.notEqual(promotion.id, sourcePost.id);
  assert.equal(promotion.pubkey, sourcePost.pubkey);
  assert.deepEqual(promotion.tags, [
    ["p", MECKY],
    ["q", sourcePost.id, "", sourcePost.pubkey],
    ["source-post", sourcePost.id],
    ["t", "stadtstack-civic-discussion"],
    ["municipality", "roebel-mueritz"],
    ["case", "marienfelder-strasse"],
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    ],
    [
      "stadtstack-case",
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    ],
    ["stance", "root"],
    ["argument-root", "self"],
  ]);
});

test("a human starts a civic topic discussion before any CivicCase exists", () => {
  const sourcePost = buildNoteEvent(
    SECRET,
    "In Röbel fehlt ein offener Treffpunkt für unterschiedliche Generationen.",
    {
      createdAt: 1_786_463_900,
      tags: [["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"]],
    }
  );

  const promotion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt in Röbel",
    agentPubkey: MECKY,
    content:
      "@Mecky Welche geprüften Informationen helfen uns bei der Diskussion?",
    createdAt: 1_786_464_000,
  });

  assert.equal(verifyEvent(promotion), true);
  assert.deepEqual(promotion.tags, [
    ["p", MECKY],
    ["q", sourcePost.id, "", sourcePost.pubkey],
    ["source-post", sourcePost.id],
    ["t", "stadtstack-civic-discussion"],
    ["municipality", "roebel-mueritz"],
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    ],
    ["topic-title", "Offener Treffpunkt in Röbel"],
    ["stance", "root"],
    ["argument-root", "self"],
  ]);
  assert.equal(promotion.tags.some((tag) => tag[0] === "case"), false);
  assert.equal(
    promotion.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
});

test("an author can attach one selected app conversation to a civic topic promotion", () => {
  const sourcePost = buildNoteEvent(
    SECRET,
    "In Röbel fehlt ein offener Treffpunkt für unterschiedliche Generationen.",
    {
      createdAt: 1_786_463_900,
      tags: [["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"]],
    }
  );
  const mention = buildNoteEvent(
    SECRET,
    "@Mecky Welche geprüften Informationen helfen uns bei der Diskussion?",
    { createdAt: 1_786_463_910 }
  );
  const reply = buildNoteEvent(MECKY_SECRET, "Geprüfte Antwort", {
    createdAt: 1_786_463_920,
  });

  const promotion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt in Röbel",
    agentPubkey: MECKY,
    content:
      "@Mecky Welche geprüften Informationen helfen uns bei der Diskussion?",
    conversationSource: {
      kind: "selected_conversation",
      sourceAppPostId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61",
      sourceAppCommentId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a62",
      mentionEventId: mention.id,
      replyEventId: reply.id,
      receiptId: RECEIPT,
    },
    createdAt: 1_786_464_000,
  });

  assert.equal(verifyEvent(promotion), true);
  assert.deepEqual(promotion.tags, [
    ["p", MECKY],
    ["q", sourcePost.id, "", sourcePost.pubkey],
    ["source-post", sourcePost.id],
    ["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"],
    ["source-app-comment", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a62"],
    ["source-conversation-mention", mention.id],
    ["source-mecky-reply", reply.id],
    ["source-mecky-receipt", RECEIPT],
    ["t", "stadtstack-civic-discussion"],
    ["municipality", "roebel-mueritz"],
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    ],
    ["topic-title", "Offener Treffpunkt in Röbel"],
    ["stance", "root"],
    ["argument-root", "self"],
  ]);
  assert.equal(
    promotion.tags.filter((tag) => tag[0].startsWith("source-")).length,
    6
  );
  assert.equal(promotion.tags.some((tag) => tag[0] === "case"), false);
  assert.equal(
    promotion.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
  assert.deepEqual(
    verifyCivicTopicPromotionEvent({
      event: promotion,
      sourcePost,
      municipalityId: "roebel-mueritz",
      agentPubkey: MECKY,
    }),
    {
      topicId:
        "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
      topicTitle: "Offener Treffpunkt in Röbel",
      conversationSource: {
        kind: "selected_conversation",
        sourceAppPostId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61",
        sourceAppCommentId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a62",
        mentionEventId: mention.id,
        replyEventId: reply.id,
        receiptId: RECEIPT,
      },
    }
  );

  const authoritySmugglingAttempt = buildNoteEvent(SECRET, promotion.content, {
    createdAt: promotion.created_at,
    tags: [...promotion.tags, ["stadtstack-case", "unauthorized-case"]],
  });
  assert.equal(
    verifyCivicTopicPromotionEvent({
      event: authoritySmugglingAttempt,
      sourcePost,
      municipalityId: "roebel-mueritz",
      agentPubkey: MECKY,
    }),
    null
  );
});

test("selected conversation provenance fails closed for malformed or incomplete chains", () => {
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", {
    createdAt: 400,
    tags: [["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"]],
  });
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const mention = buildNoteEvent(SECRET, "@Mecky Was ist geprüft?", {
    createdAt: 401,
  });
  const reply = buildNoteEvent(MECKY_SECRET, "Geprüfte Antwort", {
    createdAt: 402,
  });
  const validSource = {
    kind: "selected_conversation" as const,
    sourceAppPostId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61",
    sourceAppCommentId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a62",
    mentionEventId: mention.id,
    replyEventId: reply.id,
    receiptId: RECEIPT,
  };
  const base = {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist geprüft?",
    createdAt: 403,
  };

  for (const conversationSource of [
    { ...validSource, sourceAppPostId: "not-an-app-id" },
    { ...validSource, sourceAppPostId: "a".repeat(64) },
    {
      ...validSource,
      sourceAppPostId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a69",
    },
    { ...validSource, sourceAppCommentId: validSource.sourceAppPostId },
    { ...validSource, mentionEventId: "not-a-nostr-event-id" },
    { ...validSource, replyEventId: validSource.mentionEventId },
    { ...validSource, receiptId: "https://example.invalid/receipt" },
    {
      kind: "selected_conversation",
      sourceAppPostId: validSource.sourceAppPostId,
      replyEventId: validSource.replyEventId,
      receiptId: validSource.receiptId,
    },
    {
      ...validSource,
      sourceConversationMentionEventId: validSource.mentionEventId,
    },
  ]) {
    assert.throws(
      () =>
        buildCivicTopicPromotionEvent(SECRET, {
          ...base,
          conversationSource: conversationSource as never,
        }),
      /civic_conversation_source_invalid/
    );
  }

  assert.throws(
    () =>
      buildCivicTopicPromotionEvent(SECRET, {
        ...base,
        conversationSource: {
          sourceAppPostId: validSource.sourceAppPostId,
          mentionEventId: validSource.mentionEventId,
          replyEventId: validSource.replyEventId,
        } as never,
      }),
    /civic_conversation_source_invalid/
  );
});

test("selected conversation provenance omits only the optional comment and receipt tags", () => {
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", {
    createdAt: 450,
    tags: [["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"]],
  });
  const mention = buildNoteEvent(SECRET, "@Mecky Was ist geprüft?", {
    createdAt: 451,
  });
  const reply = buildNoteEvent(MECKY_SECRET, "Geprüfte Antwort", {
    createdAt: 452,
  });

  const promotion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist geprüft?",
    conversationSource: {
      kind: "selected_conversation",
      sourceAppPostId: "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61",
      mentionEventId: mention.id,
      replyEventId: reply.id,
    },
    createdAt: 453,
  });

  assert.deepEqual(
    promotion.tags.filter((tag) => tag[0].startsWith("source-")),
    [
      ["source-post", sourcePost.id],
      ["source-app-post", "018f1c63-7b2a-7a55-8a55-2e3d9c4b5a61"],
      ["source-conversation-mention", mention.id],
      ["source-mecky-reply", reply.id],
    ]
  );
});

test("another citizen signs a pro argument inside that topic without a CivicCase", () => {
  const authorSecret = new Uint8Array(32).fill(45);
  const participantSecret = new Uint8Array(32).fill(46);
  const sourcePost = buildNoteEvent(
    authorSecret,
    "Röbel braucht einen offenen Treffpunkt.",
    { createdAt: 100 },
  );
  const root = buildCivicTopicPromotionEvent(authorSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Welche Optionen gibt es?",
    createdAt: 101,
  });
  const argument = buildCivicArgumentEvent(participantSecret, {
    rootEvent: root,
    parentEvent: root,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    stance: "pro",
    content: "Ein gemeinsamer Ort kann Vereine und Nachbarschaft verbinden.",
    createdAt: 102,
  });

  assert.equal(verifyEvent(argument), true);
  assert.deepEqual(argument.tags, [
    ["e", root.id, "", "root"],
    ["e", root.id, "", "reply"],
    ["argument-root", root.id],
    ["stance", "pro"],
    ["t", "stadtstack-argument"],
    ["municipality", "roebel-mueritz"],
    ["topic", "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt"],
  ]);
  assert.equal(argument.tags.some((tag) => tag[0] === "case"), false);
});

test("the discussion author signs a topic proposal before any CivicCase exists", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(
    SECRET,
    "Röbel braucht einen offenen Treffpunkt.",
    { createdAt: 200 }
  );
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Welche geprüften Optionen gibt es?",
    createdAt: 201,
  });
  const answer = buildNoteEvent(MECKY_SECRET, "Geprüfte Antwort", {
    createdAt: 202,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"b".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });

  const signed = buildCitizenSignedTopicSuggestion(SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY,
    title: "Offenen Treffpunkt in Röbel prüfen",
    summary:
      "Die öffentlich diskutierten Optionen sollen durch die zuständigen Menschen geprüft werden.",
    createdAt: 203,
  });

  assert.equal(verifyEvent(signed.event), true);
  assert.equal(signed.signerPubkey, discussion.pubkey);
  assert.equal(signed.draft.topicId, topicId);
  assert.equal(signed.entryState, "awaiting_human_case_admission");
  assert.equal(signed.authorityBinding, "none");
  assert.equal(signed.submittedToCivicWorkflow, false);
  assert.deepEqual(signed.event.tags, [
    ["schema", "citizen_signed_topic_suggestion_v1"],
    ["municipality", "roebel-mueritz"],
    ["topic", topicId],
    ["e", discussion.id, "", "root"],
    ["mecky-receipt", RECEIPT],
  ]);
  assert.equal(signed.event.tags.some((tag) => tag[0] === "case"), false);
  assert.equal(
    signed.event.tags.some((tag) => tag[0] === "stadtstack-case"),
    false
  );
  assert.deepEqual(
    verifyCitizenSignedTopicSuggestion({
      binding: { municipalityId: "roebel-mueritz", topicId },
      sourceDiscussion: discussion,
      sourceAnswer: answer,
      agentPubkey: MECKY,
      event: signed.event,
    }),
    signed
  );
});

test("forged, cross-topic, or case-bearing answers cannot authorize a topic proposal", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", { createdAt: 300 });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 301,
  });
  const answerTags = [
    ["e", discussion.id, "", "reply"],
    ["p", discussion.pubkey],
    ["mecky-receipt", RECEIPT],
    ["municipality", "roebel-mueritz"],
    ["topic", topicId],
    [
      "evidence",
      `sha256:${"c".repeat(64)}`,
      "https://stadtstack.example/public/reviewed-source",
    ],
  ];
  const base = {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourceDiscussion: discussion,
    agentPubkey: MECKY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: 303,
  };

  for (const answer of [
    buildNoteEvent(new Uint8Array(32).fill(43), "Gefälscht", {
      createdAt: 302,
      tags: answerTags,
    }),
    buildNoteEvent(MECKY_SECRET, "Falsches Thema", {
      createdAt: 302,
      tags: answerTags.map((tag) =>
        tag[0] === "topic"
          ? [
              "topic",
              "urn:stadtstack:topic:municipality:roebel-mueritz:anderes-thema",
            ]
          : tag
      ),
    }),
    buildNoteEvent(MECKY_SECRET, "Versteckter Fall", {
      createdAt: 302,
      tags: [...answerTags, ["case", "versteckter-fall"]],
    }),
  ]) {
    assert.throws(
      () =>
        buildCitizenSignedTopicSuggestion(SECRET, {
          ...base,
          sourceAnswer: answer,
        }),
      /civic_topic_suggestion_answer_invalid/
    );
  }
});

test("a participant signs a topic suggestion with the adoption-required boundary", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", { createdAt: 600 });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 601,
  });
  const answer = buildAgentNoteEvent(MECKY_AGENT, "Geprüfte Antwort", {
    createdAt: 602,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"b".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });

  const signed = buildParticipantTopicSuggestion(SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY,
    title: "Offenen Treffpunkt in Röbel prüfen",
    summary:
      "Die öffentlich diskutierten Optionen sollen durch die zuständigen Menschen geprüft werden.",
    createdAt: 603,
  });

  assert.equal(verifyEvent(signed.event), true);
  assert.equal(signed.signerPubkey, discussion.pubkey);
  assert.equal(signed.entryState, "citizen_adoption_required");
  assert.equal(signed.authorityBinding, "none");
  assert.equal(signed.submittedToCivicWorkflow, false);
  assert.equal(signed.draft.schemaVersion, "public_participant_topic_suggestion_draft_v1");
  assert.equal(signed.draft.participantPubkey, discussion.pubkey);
  assert.equal("citizenPubkey" in signed.draft, false);
  assert.deepEqual(signed.event.tags, [
    ["schema", "staging_participant_signed_topic_suggestion_v1"],
    ["municipality", "roebel-mueritz"],
    ["topic", topicId],
    ["e", discussion.id, "", "root"],
    ["mecky-receipt", RECEIPT],
    ["credential-class", "staging-participant"],
  ]);
  assert.deepEqual(JSON.parse(signed.event.content), signed.draft);
  assert.deepEqual(
    verifyParticipantTopicSuggestion({
      binding: { municipalityId: "roebel-mueritz", topicId },
      sourcePost,
      sourceDiscussion: discussion,
      sourceAnswer: answer,
      agentPubkey: MECKY,
      event: signed.event,
    }),
    signed
  );
  assert.throws(() => {
    (signed.event as { content: string }).content = "mutated";
  }, TypeError);
  assert.throws(() => {
    (signed.draft as { title: string }).title = "mutated";
  }, TypeError);
  assert.throws(
    () =>
      verifyParticipantTopicSuggestion({
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        agentPubkey: MECKY,
        event: { ...signed.event, unexpected: true } as never,
      }),
    /civic_topic_suggestion_event_invalid/
  );
  assert.throws(
    () =>
      buildParticipantTopicSuggestion(SECRET, {
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost: { ...sourcePost, unexpected: true } as never,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        agentPubkey: MECKY,
        title: "Offenen Treffpunkt in Röbel prüfen",
        summary:
          "Die öffentlich diskutierten Optionen sollen durch die zuständigen Menschen geprüft werden.",
        createdAt: 603,
      }),
    /civic_topic_suggestion_discussion_invalid/
  );
  assert.throws(
    () =>
      buildParticipantTopicSuggestion(SECRET, {
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost,
        sourceDiscussion: discussion,
        sourceAnswer: { ...answer, unexpected: true } as never,
        agentPubkey: MECKY,
        title: "Offenen Treffpunkt in Röbel prüfen",
        summary:
          "Die öffentlich diskutierten Optionen sollen durch die zuständigen Menschen geprüft werden.",
        createdAt: 603,
      }),
    /civic_topic_suggestion_answer_invalid/
  );
});

test("an eligible citizen can adopt an unchanged participant suggestion for steward review", () => {
  const ADOPTER_SECRET = new Uint8Array(32).fill(43);
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", { createdAt: 630 });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 631,
  });
  const answer = buildAgentNoteEvent(MECKY_AGENT, "Geprüfte Antwort", {
    createdAt: 632,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"c".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });
  const suggestion = buildParticipantTopicSuggestion(SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: 633,
  });
  const eligibilityCore = {
    municipalityId: "roebel-mueritz",
    eligibilityClass: "municipal_civic_participation",
    subjectPubkey: getPublicKeyHex(ADOPTER_SECRET),
    participantSuggestionId: suggestion.suggestionId,
    topicId,
    policyVersion: "roebel-staging-civic-eligibility-2026-08",
    issuer: "roebel-staging-citizen-verifier",
    issuedAt: 634,
    expiresAt: 700,
    authorityBinding: "civic_eligibility_only",
  } as const;
  const payloadChecksum = checksum(eligibilityCore);
  const eligibilityReceipt = {
    schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
    eligibilityCore,
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${payloadChecksum}`,
    payloadChecksum,
    statusRef: `https://eligibility.roebel.example/status/${payloadChecksum}`,
    proof: {
      algorithm: "test-detached-v1",
      keyId: "roebel-staging-citizen-verifier-2026-08",
      signature: "cHJvb2Y",
    },
  };
  const policy = {
    municipalityId: "roebel-mueritz",
    policyVersion: "roebel-staging-civic-eligibility-2026-08",
    issuer: "roebel-staging-citizen-verifier",
    statusBaseUrl: "https://eligibility.roebel.example/status",
    verifiedAt: 650,
    verifyReceiptProof: () => true,
  };

  const adoption = buildCitizenTopicSuggestionAdoption(ADOPTER_SECRET, {
    participantSuggestion: suggestion,
    eligibilityReceipt,
    eligibilityPolicy: policy,
    createdAt: 651,
  });

  assert.equal(verifyEvent(adoption.event), true);
  assert.equal(adoption.signerPubkey, getPublicKeyHex(ADOPTER_SECRET));
  assert.equal(adoption.participantSuggestionId, suggestion.suggestionId);
  assert.equal(adoption.eligibilityReceiptId, eligibilityReceipt.receiptId);
  assert.equal(adoption.entryState, "case_steward_review_required");
  assert.equal(adoption.authorityBinding, "civic_eligibility_only");
  assert.equal(adoption.submittedToCivicWorkflow, false);
  assert.deepEqual(adoption.event.tags, [
    ["schema", "citizen_adopted_topic_suggestion_v1"],
    ["municipality", "roebel-mueritz"],
    ["topic", topicId],
    ["e", suggestion.suggestionId, "", "adopted-suggestion"],
    ["e", discussion.id, "", "root"],
    ["p", suggestion.signerPubkey],
    ["eligibility-receipt", eligibilityReceipt.receiptId],
    ["credential-class", "municipal-civic-eligibility"],
  ]);
  assert.deepEqual(
    verifyCitizenTopicSuggestionAdoption({
      participantSuggestion: suggestion,
      eligibilityReceipt,
      eligibilityPolicy: policy,
      event: adoption.event,
    }),
    adoption
  );
});

test("the original participant may also be the eligible citizen adopter", () => {
  const fixture = citizenAdoptionFixture({ adopterSecret: SECRET });
  const adoption = buildCitizenTopicSuggestionAdoption(SECRET, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });

  assert.equal(adoption.signerPubkey, fixture.suggestion.signerPubkey);
  assert.equal(adoption.adoption.participantPubkey, adoption.signerPubkey);
  assert.equal(adoption.adoption.adopterPubkey, adoption.signerPubkey);
});

test("adoption may reference a signed participant suggestion from the same second", () => {
  const fixture = citizenAdoptionFixture();
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: fixture.suggestion.event.created_at,
  });

  assert.equal(adoption.event.created_at, fixture.suggestion.event.created_at);
});

test("adoption event time must be within the receipt validity interval", () => {
  const notYetIssued = citizenAdoptionFixture({ issuedAt: 804 });
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(notYetIssued.adopterSecret, {
        participantSuggestion: notYetIssued.suggestion,
        eligibilityReceipt: notYetIssued.eligibilityReceipt,
        eligibilityPolicy: notYetIssued.eligibilityPolicy,
        createdAt: 803,
      }),
    /civic_eligibility_receipt_invalid/
  );

  const expired = citizenAdoptionFixture({ expiresAt: 851 });
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(expired.adopterSecret, {
        participantSuggestion: expired.suggestion,
        eligibilityReceipt: expired.eligibilityReceipt,
        eligibilityPolicy: expired.eligibilityPolicy,
        createdAt: 851,
      }),
    /civic_eligibility_receipt_invalid/
  );
  const valid = citizenAdoptionFixture();
  const accepted = buildCitizenTopicSuggestionAdoption(valid.adopterSecret, {
    participantSuggestion: valid.suggestion,
    eligibilityReceipt: valid.eligibilityReceipt,
    eligibilityPolicy: valid.eligibilityPolicy,
    createdAt: 851,
  });
  const reSignedOutsideInterval = buildNoteEvent(
    valid.adopterSecret,
    accepted.event.content,
    { createdAt: 900, tags: accepted.event.tags }
  );
  assert.throws(
    () =>
      verifyCitizenTopicSuggestionAdoption({
        participantSuggestion: valid.suggestion,
        eligibilityReceipt: valid.eligibilityReceipt,
        eligibilityPolicy: valid.eligibilityPolicy,
        event: reSignedOutsideInterval,
      }),
    /civic_eligibility_receipt_invalid/
  );
});

test("receipt proof verification cannot mutate the caller-owned receipt", () => {
  let mutationWasBlocked = false;
  const fixture = citizenAdoptionFixture({
    verifyReceiptProof: (_input, proof) => {
      try {
        (proof as { signature: string }).signature = "browser-mutated";
      } catch {
        mutationWasBlocked = true;
      }
      return true;
    },
  });
  const before = structuredClone(fixture.eligibilityReceipt);

  buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });

  assert.equal(mutationWasBlocked, true);
  assert.deepEqual(fixture.eligibilityReceipt, before);
});

test("receipt proof callbacks cannot alter the receipt consumed by adoption", () => {
  const fixture = citizenAdoptionFixture();
  const originalChecksum = fixture.eligibilityReceipt.payloadChecksum;
  const policy = {
    ...fixture.eligibilityPolicy,
    verifyReceiptProof: () => {
      fixture.eligibilityReceipt.payloadChecksum = "f".repeat(64);
      return true;
    },
  };

  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: policy,
    createdAt: 851,
  });

  assert.equal(fixture.eligibilityReceipt.payloadChecksum, "f".repeat(64));
  assert.equal(adoption.adoption.eligibilityReceiptChecksum, originalChecksum);
});

test("verification uses one event snapshot across receipt proof verification", () => {
  const fixture = citizenAdoptionFixture();
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });
  const callerOwnedEvent = structuredClone(adoption.event);
  const policy = {
    ...fixture.eligibilityPolicy,
    verifyReceiptProof: () => {
      callerOwnedEvent.content = "mutated-after-signature-check";
      callerOwnedEvent.tags = [["case", "browser-injected"]];
      return true;
    },
  };

  const verified = verifyCitizenTopicSuggestionAdoption({
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: policy,
    event: callerOwnedEvent,
  });

  assert.equal(callerOwnedEvent.content, "mutated-after-signature-check");
  assert.equal(verified.adoptionId, adoption.adoptionId);
  assert.deepEqual(verified.event.tags, adoption.event.tags);
});

test("adoption rejects accessor and proxy-shaped participant, receipt, and event inputs", () => {
  const fixture = citizenAdoptionFixture();
  const validInput = {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  };
  const accessorDraft = structuredClone(fixture.suggestion.draft);
  Object.defineProperty(accessorDraft, "topicId", {
    enumerable: true,
    get: () => fixture.topicId,
  });
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...validInput,
        participantSuggestion: { ...fixture.suggestion, draft: accessorDraft },
      }),
    /civic_participant_suggestion_invalid/
  );

  const accessorCore = structuredClone(fixture.eligibilityReceipt.eligibilityCore);
  Object.defineProperty(accessorCore, "topicId", {
    enumerable: true,
    get: () => fixture.topicId,
  });
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...validInput,
        eligibilityReceipt: {
          ...fixture.eligibilityReceipt,
          eligibilityCore: accessorCore,
        },
      }),
    /civic_eligibility_receipt_invalid/
  );

  const accessorReceipt = structuredClone(fixture.eligibilityReceipt);
  Object.defineProperty(accessorReceipt, "payloadChecksum", {
    enumerable: true,
    get: () => fixture.eligibilityReceipt.payloadChecksum,
  });
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...validInput,
        eligibilityReceipt: accessorReceipt,
      }),
    /civic_eligibility_receipt_invalid/
  );

  const adoption = buildCitizenTopicSuggestionAdoption(
    fixture.adopterSecret,
    validInput
  );
  const accessorEvent = structuredClone(adoption.event);
  Object.defineProperty(accessorEvent, "content", {
    enumerable: true,
    get: () => adoption.event.content,
  });
  assert.throws(
    () =>
      verifyCitizenTopicSuggestionAdoption({
        ...validInput,
        event: accessorEvent,
      }),
    /civic_topic_suggestion_adoption_event_invalid/
  );

  const tagsProxy = new Proxy(structuredClone(adoption.event.tags), {
    getOwnPropertyDescriptor(target, property) {
      if (property === "0") {
        return {
          configurable: true,
          enumerable: true,
          get: () => target[0],
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  assert.throws(
    () =>
      verifyCitizenTopicSuggestionAdoption({
        ...validInput,
        event: { ...adoption.event, tags: tagsProxy },
      }),
    /civic_topic_suggestion_adoption_event_invalid/
  );
});

test("receipt status references reject a trailing-slash policy base", () => {
  const fixture = citizenAdoptionFixture();
  const statusBaseUrl = `${fixture.eligibilityPolicy.statusBaseUrl}/`;
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        participantSuggestion: fixture.suggestion,
        eligibilityReceipt: {
          ...fixture.eligibilityReceipt,
          statusRef: `${statusBaseUrl}${fixture.eligibilityReceipt.payloadChecksum}`,
        },
        eligibilityPolicy: {
          ...fixture.eligibilityPolicy,
          statusBaseUrl,
        },
        createdAt: 851,
      }),
    /civic_eligibility_receipt_invalid/
  );
});

test("receipt status references reject query and fragment policy bases", () => {
  const fixture = citizenAdoptionFixture();
  for (const suffix of ["?attempt=browser", "#attempt=browser"]) {
    const statusBaseUrl = `${fixture.eligibilityPolicy.statusBaseUrl}${suffix}`;
    assert.throws(
      () =>
        buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
          participantSuggestion: fixture.suggestion,
          eligibilityReceipt: {
            ...fixture.eligibilityReceipt,
            statusRef: `${statusBaseUrl}/${fixture.eligibilityReceipt.payloadChecksum}`,
          },
          eligibilityPolicy: { ...fixture.eligibilityPolicy, statusBaseUrl },
          createdAt: 851,
        }),
      /civic_eligibility_receipt_invalid/
    );
  }
});

test("adoption fails closed when a receipt is expired, from another policy, or bound to another suggestion", () => {
  const fixture = citizenAdoptionFixture();
  const input = {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  };

  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...input,
        eligibilityPolicy: {
          ...fixture.eligibilityPolicy,
          verifiedAt: fixture.eligibilityReceipt.eligibilityCore.expiresAt,
        },
      }),
    /civic_eligibility_receipt_invalid/
  );
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...input,
        eligibilityPolicy: {
          ...fixture.eligibilityPolicy,
          verifyReceiptProof: () => false,
        },
      }),
    /civic_eligibility_receipt_invalid/
  );
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...input,
        eligibilityPolicy: {
          ...fixture.eligibilityPolicy,
          policyVersion: "another-reviewed-policy",
        },
      }),
    /civic_eligibility_receipt_invalid/
  );
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        ...input,
        eligibilityReceipt: {
          ...fixture.eligibilityReceipt,
          eligibilityCore: {
            ...fixture.eligibilityReceipt.eligibilityCore,
            participantSuggestionId: "b".repeat(64),
          },
        },
      }),
    /civic_eligibility_receipt_invalid/
  );
});

test("adoption cannot edit or relabel the immutable participant suggestion", () => {
  const fixture = citizenAdoptionFixture();
  const changedSuggestion = buildParticipantTopicSuggestion(
    fixture.participantSecret,
    {
      binding: {
        municipalityId: fixture.eligibilityPolicy.municipalityId,
        topicId: fixture.topicId,
      },
      sourcePost: fixture.sourcePost,
      sourceDiscussion: fixture.discussion,
      sourceAnswer: fixture.answer,
      agentPubkey: MECKY,
      title: "Anderer Titel, neue Suggestion",
      summary: fixture.suggestion.draft.summary,
      createdAt: 804,
    }
  );

  assert.notEqual(changedSuggestion.suggestionId, fixture.suggestion.suggestionId);
  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        participantSuggestion: changedSuggestion,
        eligibilityReceipt: fixture.eligibilityReceipt,
        eligibilityPolicy: fixture.eligibilityPolicy,
        createdAt: 851,
      }),
    /civic_eligibility_receipt_invalid/
  );
});

test("adoption rejects a signed participant suggestion whose topic belongs to another municipality", () => {
  const fixture = citizenAdoptionFixture();
  const crossMunicipalityDraft = JSON.parse(
    fixture.suggestion.event.content
  ) as PublicParticipantTopicSuggestionDraftV1;
  crossMunicipalityDraft.municipalityId = "herzogtum-lauenburg";
  const crossMunicipalityDraftCore = {
    sourceAnswerId: crossMunicipalityDraft.sourceAnswerId,
    sourceAnswerRef: crossMunicipalityDraft.sourceAnswerRef,
    sourceAnswerReceiptId: crossMunicipalityDraft.sourceAnswerReceiptId,
    sourceDiscussionId: crossMunicipalityDraft.sourceDiscussionId,
    sourceDiscussionRef: crossMunicipalityDraft.sourceDiscussionRef,
    municipalityId: crossMunicipalityDraft.municipalityId,
    topicId: crossMunicipalityDraft.topicId,
    participantPubkey: crossMunicipalityDraft.participantPubkey,
    title: crossMunicipalityDraft.title,
    summary: crossMunicipalityDraft.summary,
  };
  crossMunicipalityDraft.draftId =
    `urn:stadtstack:participant-topic-suggestion-draft:${checksum(crossMunicipalityDraftCore)}`;
  const signedCrossMunicipalityEvent = buildNoteEvent(
    fixture.participantSecret,
    stableJson(crossMunicipalityDraft),
    {
      createdAt: fixture.suggestion.event.created_at,
      tags: [
        ["schema", "staging_participant_signed_topic_suggestion_v1"],
        ["municipality", "herzogtum-lauenburg"],
        ["topic", fixture.topicId],
        ["e", fixture.discussion.id, "", "root"],
        ["mecky-receipt", RECEIPT],
        ["credential-class", "staging-participant"],
      ],
    }
  );
  const crossMunicipalitySuggestion = {
    ...fixture.suggestion,
    suggestionId: signedCrossMunicipalityEvent.id,
    candidateId: `urn:stadtstack:participant-topic-suggestion:${signedCrossMunicipalityEvent.id}`,
    event: signedCrossMunicipalityEvent,
    draft: crossMunicipalityDraft,
  };

  assert.throws(
    () =>
      buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
        participantSuggestion: crossMunicipalitySuggestion,
        eligibilityReceipt: fixture.eligibilityReceipt,
        eligibilityPolicy: fixture.eligibilityPolicy,
        createdAt: 851,
      }),
    /civic_participant_suggestion_invalid/
  );
});

test("adoption rejects replayed authority fields, malformed outer events, and signatures", () => {
  const fixture = citizenAdoptionFixture();
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });
  const forgedAuthorityTag = buildNoteEvent(
    fixture.adopterSecret,
    adoption.event.content,
    {
      createdAt: adoption.event.created_at,
      tags: [...adoption.event.tags, ["case", "browser-selected-case"]],
    }
  );
  const replayedContent = JSON.parse(adoption.event.content) as Record<string, unknown>;
  replayedContent.treasury = "browser-authority";
  const forgedAuthorityContent = buildNoteEvent(
    fixture.adopterSecret,
    stableJson(replayedContent),
    { createdAt: adoption.event.created_at, tags: adoption.event.tags }
  );
  const verify = (event: unknown) =>
    verifyCitizenTopicSuggestionAdoption({
      participantSuggestion: fixture.suggestion,
      eligibilityReceipt: fixture.eligibilityReceipt,
      eligibilityPolicy: fixture.eligibilityPolicy,
      event: event as never,
    });

  assert.throws(() => verify(forgedAuthorityTag), /civic_topic_suggestion_adoption_invalid/);
  assert.throws(
    () => verify(forgedAuthorityContent),
    /civic_topic_suggestion_adoption_invalid/
  );
  assert.throws(
    () => verify({ ...adoption.event, sig: "0".repeat(128) }),
    /civic_topic_suggestion_adoption_event_invalid/
  );
  assert.throws(
    () => verify({ ...adoption.event, replay: true }),
    /civic_topic_suggestion_adoption_event_invalid/
  );
});

test("adoption rejects a signed non-canonical JSON encoding", () => {
  const fixture = citizenAdoptionFixture();
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });
  const whitespaceEncoded = buildNoteEvent(
    fixture.adopterSecret,
    JSON.stringify(JSON.parse(adoption.event.content), null, 2),
    { createdAt: adoption.event.created_at, tags: adoption.event.tags }
  );

  assert.throws(
    () =>
      verifyCitizenTopicSuggestionAdoption({
        participantSuggestion: fixture.suggestion,
        eligibilityReceipt: fixture.eligibilityReceipt,
        eligibilityPolicy: fixture.eligibilityPolicy,
        event: whitespaceEncoded,
      }),
    /civic_topic_suggestion_adoption_invalid/
  );
});

test("adoption rejects a signer-edited title or summary for the same suggestion", () => {
  const fixture = citizenAdoptionFixture();
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });
  const edited = JSON.parse(adoption.event.content) as Record<string, unknown>;
  edited.title = "Vom Bürger nachträglich geänderter Titel";
  const editedCore = {
    municipalityId: edited.municipalityId,
    topicId: edited.topicId,
    participantSuggestionId: edited.participantSuggestionId,
    participantSuggestionRef: edited.participantSuggestionRef,
    participantPubkey: edited.participantPubkey,
    sourceDiscussionId: edited.sourceDiscussionId,
    sourceAnswerReceiptId: edited.sourceAnswerReceiptId,
    adopterPubkey: edited.adopterPubkey,
    eligibilityReceiptId: edited.eligibilityReceiptId,
    eligibilityReceiptChecksum: edited.eligibilityReceiptChecksum,
    title: edited.title,
    summary: edited.summary,
  };
  edited.adoptionId =
    `urn:stadtstack:citizen-topic-suggestion-adoption:${checksum(editedCore)}`;
  const signedEdited = buildNoteEvent(
    fixture.adopterSecret,
    stableJson(edited),
    { createdAt: adoption.event.created_at, tags: adoption.event.tags }
  );

  assert.throws(
    () =>
      verifyCitizenTopicSuggestionAdoption({
        participantSuggestion: fixture.suggestion,
        eligibilityReceipt: fixture.eligibilityReceipt,
        eligibilityPolicy: fixture.eligibilityPolicy,
        event: signedEdited,
      }),
    /civic_topic_suggestion_adoption_invalid/
  );
});

test("a second municipality can adopt through the same city-neutral protocol", () => {
  const fixture = citizenAdoptionFixture({
    municipalityId: "herzogtum-lauenburg",
    topicSlug: "dorftreffpunkt",
  });
  const adoption = buildCitizenTopicSuggestionAdoption(fixture.adopterSecret, {
    participantSuggestion: fixture.suggestion,
    eligibilityReceipt: fixture.eligibilityReceipt,
    eligibilityPolicy: fixture.eligibilityPolicy,
    createdAt: 851,
  });

  assert.equal(adoption.adoption.municipalityId, "herzogtum-lauenburg");
  assert.equal(adoption.adoption.topicId, fixture.topicId);
  assert.equal(
    verifyCitizenTopicSuggestionAdoption({
      participantSuggestion: fixture.suggestion,
      eligibilityReceipt: fixture.eligibilityReceipt,
      eligibilityPolicy: fixture.eligibilityPolicy,
      event: adoption.event,
    }).adoptionId,
    adoption.adoptionId
  );
});

test("a participant suggestion rejects citizen credentials and authority tags", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", { createdAt: 610 });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 611,
  });
  const answer = buildAgentNoteEvent(MECKY_AGENT, "Geprüfte Antwort", {
    createdAt: 612,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"c".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });
  const signed = buildParticipantTopicSuggestion(SECRET, {
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    agentPubkey: MECKY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: 613,
  });

  const citizenDraft = JSON.parse(signed.event.content) as Record<string, unknown>;
  citizenDraft.schemaVersion = "public_mecky_topic_suggestion_draft_v1";
  citizenDraft.citizenPubkey = discussion.pubkey;
  delete citizenDraft.participantPubkey;
  const forgedCitizenEvent = buildNoteEvent(SECRET, JSON.stringify(citizenDraft), {
    createdAt: signed.event.created_at,
    tags: signed.event.tags,
  });
  assert.throws(
    () =>
      verifyParticipantTopicSuggestion({
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        agentPubkey: MECKY,
        event: forgedCitizenEvent,
      }),
    /civic_topic_suggestion_draft_invalid/
  );

  const authorityEvent = buildNoteEvent(SECRET, signed.event.content, {
    createdAt: signed.event.created_at,
    tags: [...signed.event.tags, ["case", "unauthorized"]],
  });
  assert.throws(
    () =>
      verifyParticipantTopicSuggestion({
        binding: { municipalityId: "roebel-mueritz", topicId },
        sourcePost,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        agentPubkey: MECKY,
        event: authorityEvent,
      }),
    /civic_topic_suggestion_draft_invalid/
  );
});

test("a selected conversation is verified against the signed mention and agent reply witnesses", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:herzogtum-lauenburg:offener-treffpunkt";
  const sourceAppPostId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";
  const sourceAppCommentId = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a62";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", {
    createdAt: 700,
    tags: [["source-app-post", sourceAppPostId]],
  });
  const mention = buildNoteEvent(SECRET, "@Mecky Was ist geprüft?", {
    createdAt: 701,
    tags: [
      ["p", MECKY],
      ["source-app-post", sourceAppPostId],
      ["source-app-comment", sourceAppCommentId],
      ["t", "kair-app-conversation"],
    ],
  });
  const conversationReply = buildAgentNoteEvent(MECKY_AGENT, "Geprüfte Antwort", {
    createdAt: 701,
    tags: [
      ["e", mention.id, "", "reply"],
      ["p", mention.pubkey],
      ["source-app-post", sourceAppPostId],
      ["source-app-comment", sourceAppCommentId],
      ["mecky-receipt", RECEIPT],
      [
        "evidence",
        `sha256:${"d".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source",
      ],
    ],
  });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "herzogtum-lauenburg",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    conversationSource: {
      kind: "selected_conversation",
      sourceAppPostId,
      sourceAppCommentId,
      mentionEventId: mention.id,
      replyEventId: conversationReply.id,
      receiptId: RECEIPT,
    },
    createdAt: 701,
  });
  const answer = buildAgentNoteEvent(MECKY_AGENT, "Weitere geprüfte Antwort", {
    createdAt: 701,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["source-app-post", sourceAppPostId],
      ["source-app-comment", sourceAppCommentId],
      ["mecky-receipt", RECEIPT],
      ["municipality", "herzogtum-lauenburg"],
      ["topic", topicId],
      [
        "evidence",
        `sha256:${"e".repeat(64)}`,
        "https://stadtstack.example/public/reviewed-source-2",
      ],
    ],
  });

  const signed = buildParticipantTopicSuggestion(SECRET, {
    binding: { municipalityId: "herzogtum-lauenburg", topicId },
    sourcePost,
    sourceDiscussion: discussion,
    sourceAnswer: answer,
    conversationWitnesses: {
      conversationTopic: "kair-app-conversation",
      mentionEvent: mention,
      replyEvent: conversationReply,
    },
    agentPubkey: MECKY,
    title: "Treffpunkt prüfen",
    summary: "Die Optionen sollen menschlich geprüft werden.",
    createdAt: 702,
  });

  assert.equal(signed.draft.sourceDiscussionId, discussion.id);
  assert.equal(signed.draft.sourceAnswerReceiptId, RECEIPT);

  const answerWithoutConversationBinding = buildAgentNoteEvent(
    MECKY_AGENT,
    "Weitere geprüfte Antwort",
    {
      createdAt: 701,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", RECEIPT],
        ["municipality", "herzogtum-lauenburg"],
        ["topic", topicId],
        [
          "evidence",
          `sha256:${"e".repeat(64)}`,
          "https://stadtstack.example/public/reviewed-source-2",
        ],
      ],
    }
  );
  assert.throws(
    () =>
      buildParticipantTopicSuggestion(SECRET, {
        binding: { municipalityId: "herzogtum-lauenburg", topicId },
        sourcePost,
        sourceDiscussion: discussion,
        sourceAnswer: answerWithoutConversationBinding,
        conversationWitnesses: {
          conversationTopic: "kair-app-conversation",
          mentionEvent: mention,
          replyEvent: conversationReply,
        },
        agentPubkey: MECKY,
        title: "Treffpunkt prüfen",
        summary: "Die Optionen sollen menschlich geprüft werden.",
        createdAt: 702,
      }),
    /civic_topic_suggestion_answer_invalid/
  );
});

test("the topic answer envelope rejects unknown tags, empty content, and oversized content", () => {
  const topicId =
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourcePost = buildNoteEvent(SECRET, "Treffpunkt", { createdAt: 720 });
  const discussion = buildCivicTopicPromotionEvent(SECRET, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY,
    content: "@Mecky Was ist dazu geprüft?",
    createdAt: 721,
  });
  const answerTags = [
    ["e", discussion.id, "", "reply"],
    ["p", discussion.pubkey],
    ["mecky-receipt", RECEIPT],
    ["municipality", "roebel-mueritz"],
    ["topic", topicId],
    [
      "evidence",
      `sha256:${"f".repeat(64)}`,
      "https://stadtstack.example/public/reviewed-source",
    ],
  ];
  for (const answer of [
    buildAgentNoteEvent(MECKY_AGENT, "Antwort", {
      createdAt: 722,
      tags: [...answerTags, ["unknown", "smuggled"]],
    }),
    buildAgentNoteEvent(MECKY_AGENT, "", {
      createdAt: 722,
      tags: answerTags,
    }),
    buildAgentNoteEvent(MECKY_AGENT, "x".repeat(2_001), {
      createdAt: 722,
      tags: answerTags,
    }),
  ]) {
    assert.throws(
      () =>
        buildParticipantTopicSuggestion(SECRET, {
          binding: { municipalityId: "roebel-mueritz", topicId },
          sourcePost,
          sourceDiscussion: discussion,
          sourceAnswer: answer,
          agentPubkey: MECKY,
          title: "Treffpunkt prüfen",
          summary: "Die Optionen sollen menschlich geprüft werden.",
          createdAt: 723,
        }),
      /civic_topic_suggestion_answer_invalid/
    );
  }
});

test("a citizen publishes one signed, scope-bound civic discussion that explicitly mentions Mecky", () => {
  const event = buildCivicDiscussionEvent(SECRET, {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: MECKY,
    content:
      "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
    createdAt: 1_786_464_000,
  });

  assert.equal(verifyEvent(event), true);
  assert.equal(event.kind, 1);
  assert.deepEqual(event.tags, [
    ["p", MECKY],
    ["t", "stadtstack-civic-discussion"],
    ["municipality", "roebel-mueritz"],
    ["case", "marienfelder-strasse"],
    [
      "stadtstack-case",
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    ],
  ]);
});

test("the same citizen signs an edited suggestion that remains awaiting steward admission", () => {
  const discussion = buildCivicDiscussionEvent(SECRET, {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: MECKY,
    content:
      "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
    createdAt: 1_786_464_000,
  });
  const signed = buildCitizenSignedSuggestion(SECRET, {
    binding: {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    },
    sourceDiscussion: discussion,
    agentPubkey: MECKY,
    sourceAnswer: buildNoteEvent(MECKY_SECRET, "Geprüfte Antwort", {
      createdAt: 1_786_464_030,
      tags: [
        ["e", discussion.id, "", "reply"],
        ["p", discussion.pubkey],
        ["mecky-receipt", RECEIPT],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        [
          "stadtstack-case",
          "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
        ],
        [
          "evidence",
          `sha256:${"b".repeat(64)}`,
          "https://stadtstack.example/public/case",
        ],
      ],
    }),
    title: "Sichere Querung der Marienfelder Straße prüfen",
    summary:
      "Die Stadt soll gemeinsam mit Anwohnenden eine sichere Querung prüfen.",
    createdAt: 1_786_464_060,
  });

  assert.equal(
    verifyEvent({
      ...signed.event,
      created_at: signed.event.createdAt,
      sig: signed.event.signature,
    }),
    true
  );
  assert.equal(signed.signerPubkey, discussion.pubkey);
  assert.equal(signed.draft.citizenPubkey, discussion.pubkey);
  assert.equal(signed.draft.sourceDiscussionId, discussion.id);
  assert.equal(signed.entryState, "awaiting_human_case_admission");
  assert.equal(signed.authorityBinding, "none");
  assert.equal(signed.submittedToCivicWorkflow, false);
  assert.deepEqual(JSON.parse(signed.event.content), signed.draft);
  assert.deepEqual(signed.event.tags, [
    ["schema", "citizen_signed_suggestion_v1"],
    ["municipality", "roebel-mueritz"],
    ["case", "marienfelder-strasse"],
    ["e", discussion.id, "", "root"],
    ["mecky-receipt", RECEIPT],
  ]);
});

test("a forged or cross-Case Mecky reply cannot become a citizen suggestion", () => {
  const discussion = buildCivicDiscussionEvent(SECRET, {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    agentPubkey: MECKY,
    content: "@Mecky Was ist geprüft?",
    createdAt: 1_786_464_000,
  });
  const forged = buildNoteEvent(new Uint8Array(32).fill(43), "Antwort", {
    createdAt: 1_786_464_030,
    tags: [
      ["e", discussion.id, "", "reply"],
      ["p", discussion.pubkey],
      ["mecky-receipt", RECEIPT],
      ["municipality", "roebel-mueritz"],
      ["case", "marienfelder-strasse"],
      [
        "stadtstack-case",
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
      ],
      [
        "evidence",
        `sha256:${"b".repeat(64)}`,
        "https://stadtstack.example/public/case",
      ],
    ],
  });
  assert.throws(
    () =>
      buildCitizenSignedSuggestion(SECRET, {
        binding: {
          municipalityId: "roebel-mueritz",
          sourceCaseId: "marienfelder-strasse",
          canonicalCaseId:
            "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
        },
        sourceDiscussion: discussion,
        sourceAnswer: forged,
        agentPubkey: MECKY,
        title: "Sichere Querung prüfen",
        summary: "Die Stadt soll eine sichere Querung prüfen.",
        createdAt: 1_786_464_060,
      }),
    /civic_source_answer_invalid/
  );
});
