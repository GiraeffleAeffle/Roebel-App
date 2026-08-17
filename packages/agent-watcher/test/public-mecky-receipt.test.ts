import assert from "node:assert/strict";
import { it } from "node:test";
import {
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
} from "@netizen-labs/nostr";
import {
  createPublicMeckyRelayReply,
  publicMeckyDiscussionBindingFor,
} from "../src/public-mecky-receipt";

const EVIDENCE_ID = `sha256:${"a".repeat(64)}`;

it("binds a Mecky reply to a civic topic before any CivicCase exists", () => {
  const citizenSecret = new Uint8Array(32).fill(43);
  const sourcePost = buildNoteEvent(
    citizenSecret,
    "In Röbel fehlt ein offener Treffpunkt.",
    { createdAt: 1_786_463_900 }
  );
  const discussion = buildCivicTopicPromotionEvent(citizenSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId:
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt in Röbel",
    agentPubkey: "c".repeat(64),
    content: "@Mecky Welche geprüften Informationen liegen dazu vor?",
    createdAt: 1_786_464_000,
  });
  const reply = createPublicMeckyRelayReply({
    discussion,
    binding: {
      municipalityId: "roebel-mueritz",
      topicId:
        "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    },
    result: {
      status: "answered",
      content:
        "Dazu liegt bislang nur die geprüfte kommunale Ausgangslage vor.",
      evidenceRefs: [
        {
          evidenceId: EVIDENCE_ID,
          title: "Geprüfte Ausgangslage",
          publicCaseUrl: "https://stadtstack.example/evidence",
        },
      ],
    },
  });

  assert.deepEqual(reply.tags, [
    ["mecky-receipt", reply.receiptId],
    ["municipality", "roebel-mueritz"],
    [
      "topic",
      "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    ],
    ["evidence", EVIDENCE_ID, "https://stadtstack.example/evidence"],
  ]);
  assert.equal(reply.tags.some((tag) => tag[0] === "case"), false);
  assert.equal(reply.tags.some((tag) => tag[0] === "stadtstack-case"), false);
});

it("selects the signed topic binding instead of the legacy seeded Case", () => {
  const citizenSecret = new Uint8Array(32).fill(44);
  const sourcePost = buildNoteEvent(citizenSecret, "Röbel braucht mehr Orte für Begegnung.", {
    createdAt: 1_786_464_100,
  });
  const discussion = buildCivicTopicPromotionEvent(citizenSecret, {
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:begegnungsort",
    topicTitle: "Begegnungsort in Röbel",
    agentPubkey: "c".repeat(64),
    content: "@Mecky Welche geprüften Informationen gibt es dazu?",
    createdAt: 1_786_464_200,
  });

  assert.deepEqual(
    publicMeckyDiscussionBindingFor(discussion, {
      municipalityId: "roebel-mueritz",
      sourceCaseId: "marienfelder-strasse",
      canonicalCaseId:
        "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    }),
    {
      municipalityId: "roebel-mueritz",
      topicId:
        "urn:stadtstack:topic:municipality:roebel-mueritz:begegnungsort",
    },
  );
});
