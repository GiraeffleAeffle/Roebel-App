import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PublicMeckyReplyProjectionError,
  parsePublicMeckyReplyProjection,
} from "../../expo/supabase/functions/_shared/public-mecky-reply-projection";

const PUBKEY = "a".repeat(64);
const POST_ID = "735187dc-d737-4e6c-bdd9-fe0792fec498";
const COMMENT_ID = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";

function event() {
  return {
    id: "b".repeat(64),
    pubkey: PUBKEY,
    created_at: 1_785_000_000,
    kind: 1,
    tags: [
      ["netizen_agent", "mecky", "roebel"],
      ["e", "c".repeat(64), "", "reply"],
      ["p", "d".repeat(64)],
      ["source-app-post", POST_ID],
      ["source-app-comment", COMMENT_ID],
      ["evidence", `sha256:${"e".repeat(64)}`, "https://stadtstack.example/evidence/1"],
    ],
    content: "Nach den geprüften Unterlagen gibt es zwei Optionen.",
    sig: "f".repeat(128),
  };
}

describe("Public Mecky reply projection", () => {
  it("reduces one verified source-bound reply to a zero-authority read-model row", () => {
    const projected = parsePublicMeckyReplyProjection(event(), {
      expectedPubkey: PUBKEY,
      verifyEvent: () => true,
    });

    assert.equal(projected.event_id, "b".repeat(64));
    assert.equal(projected.request_event_id, "c".repeat(64));
    assert.equal(projected.source_post_id, POST_ID);
    assert.equal(projected.source_comment_id, COMMENT_ID);
    assert.equal(projected.authority_binding, "none");
    assert.deepEqual(projected.evidence_refs, [
      {
        digest: `sha256:${"e".repeat(64)}`,
        url: "https://stadtstack.example/evidence/1",
      },
    ]);
  });

  it("rejects forgery, wrong agent identity and ambiguous source bindings", () => {
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(event(), {
          expectedPubkey: PUBKEY,
          verifyEvent: () => false,
        }),
      /public_mecky_projection_signature_invalid/,
    );

    const wrongAgent = event();
    wrongAgent.tags[0] = ["netizen_agent", "mecky", "other-town"];
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(wrongAgent, {
          expectedPubkey: PUBKEY,
          verifyEvent: () => true,
        }),
      /public_mecky_projection_agent_invalid/,
    );

    const duplicate = event();
    duplicate.tags.push(["source-app-post", "1".repeat(64)]);
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(duplicate, {
          expectedPubkey: PUBKEY,
          verifyEvent: () => true,
        }),
      /public_mecky_projection_source_app_post_invalid/,
    );
  });

  it("rejects unknown capability tags and credential-bearing evidence URLs", () => {
    const unknown = event();
    unknown.tags.push(["execute", "treasury"]);
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(unknown, {
          expectedPubkey: PUBKEY,
          verifyEvent: () => true,
        }),
      PublicMeckyReplyProjectionError,
    );

    const credential = event();
    credential.tags[5] = [
      "evidence",
      `sha256:${"e".repeat(64)}`,
      "https://user:secret@stadtstack.example/evidence/1",
    ];
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(credential, {
          expectedPubkey: PUBKEY,
          verifyEvent: () => true,
        }),
      /public_mecky_projection_evidence_invalid/,
    );

    const trackingQuery = event();
    trackingQuery.tags[5] = [
      "evidence",
      `sha256:${"e".repeat(64)}`,
      "https://stadtstack.example/evidence/1?token=secret",
    ];
    assert.throws(
      () =>
        parsePublicMeckyReplyProjection(trackingQuery, {
          expectedPubkey: PUBKEY,
          verifyEvent: () => true,
        }),
      /public_mecky_projection_evidence_invalid/,
    );
  });
});
