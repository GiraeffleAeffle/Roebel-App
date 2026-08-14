import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildNoteEvent,
  getPublicKeyHex,
  verifyEvent,
} from "../src/index";

const SECRET = new Uint8Array(32).fill(41);
const MECKY_SECRET = new Uint8Array(32).fill(42);
const MECKY = getPublicKeyHex(MECKY_SECRET);
const RECEIPT = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;

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
