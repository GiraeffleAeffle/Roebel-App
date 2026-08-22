import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNoteEvent,
  deriveAgentIdentity,
  deriveNostrSecretKey,
} from "@netizen-labs/nostr";

import { createDirectMentionEvidence } from "../src/conversation-evidence";
import { parsePublicEvidence } from "../src/public-evidence";

const MECKY = deriveAgentIdentity(
  "conversation-evidence-agent-secret-with-enough-entropy-2026",
  "roebel",
  "mecky",
);
const CITIZEN = deriveNostrSecretKey(`0x${"61".repeat(65)}`);
const POST_ID = "735187dc-d737-4e6c-bdd9-fe0792fec498";

function mentionEvent(extraTags: string[][] = []) {
  return buildNoteEvent(CITIZEN, "@Mecky Was ist an diesem Hinweis belegt?", {
    createdAt: 1_787_313_600,
    tags: [
      ["p", MECKY.publicKey],
      ["source-app-post", POST_ID],
      ...extraTags,
    ],
  });
}

const options = {
  municipalityId: "roebel-mueritz",
  agentPubkey: MECKY.publicKey,
  publicIndexBaseUrl: "https://index.roebel.app",
} as const;

describe("direct mention public evidence", () => {
  it("admits one signed source-bound mention only as attributed community speech", () => {
    const event = mentionEvent();
    const evidence = createDirectMentionEvidence(event, options);

    assert.deepEqual(evidence, {
      evidenceId: `sha256:${event.id}`,
      municipalityId: "roebel-mueritz",
      sourceKind: "nostr_post",
      authority: "community_statement",
      title: "Öffentlicher Röbel-Beitrag",
      summary: "@Mecky Was ist an diesem Hinweis belegt?",
      publishedAt: "2026-08-21T12:00:00.000Z",
      admissionState: "admitted",
      lifecycle: "current",
      eventId: event.id,
      authorPubkey: event.pubkey,
      eventUrl: `https://index.roebel.app/events?ids=${event.id}`,
      signatureValid: true,
      retrievalConsent: "direct_mention",
    });
    assert.deepEqual(parsePublicEvidence(evidence), evidence);
  });

  it("rejects forged events and ambiguous app-source bindings", () => {
    const event = mentionEvent();
    assert.throws(() => createDirectMentionEvidence({ ...event, content: "tampered" }, options));
    assert.throws(() => createDirectMentionEvidence(mentionEvent([
      ["source-app-post", "c4d75032-208b-470b-86a4-e99a1b04a56d"],
    ]), options));
    assert.throws(() => createDirectMentionEvidence(buildNoteEvent(CITIZEN, "No app binding", {
      createdAt: event.created_at,
      tags: [["p", MECKY.publicKey]],
    }), options));
  });

  it("requires an explicit mention of the configured agent and a public HTTPS index", () => {
    const other = deriveAgentIdentity(
      "another-agent-secret-with-enough-entropy-2026",
      "roebel",
      "mecky",
    );
    assert.throws(() => createDirectMentionEvidence(mentionEvent(), {
      ...options,
      agentPubkey: other.publicKey,
    }));
    assert.throws(() => createDirectMentionEvidence(mentionEvent(), {
      ...options,
      publicIndexBaseUrl: "http://index.roebel.app",
    }));
  });
});
