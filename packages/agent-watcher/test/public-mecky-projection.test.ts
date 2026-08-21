import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentNoteEvent,
  deriveAgentIdentity,
} from "@netizen-labs/nostr";
import { createPublicMeckyReplyProjectionSink } from "../src/public-mecky-projection";

const MECKY = deriveAgentIdentity(
  "projection-test-node-secret-with-enough-entropy",
  "roebel",
  "mecky",
);
const EVENT = buildAgentNoteEvent(MECKY, "Geprüfte Antwort.", {
  createdAt: 1_785_000_000,
  tags: [
    ["e", "a".repeat(64), "", "reply"],
    ["p", "b".repeat(64)],
    ["source-app-post", "735187dc-d737-4e6c-bdd9-fe0792fec498"],
  ],
});

describe("Public Mecky reply projection sink", () => {
  it("sends only the signed event to one credential-free HTTPS endpoint", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const sink = createPublicMeckyReplyProjectionSink({
      endpoint:
        "https://wwbeqhkslxdxhktqzqti.supabase.co/functions/v1/project-public-mecky-reply",
      fetchImpl: async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(JSON.stringify({ eventId: EVENT.id }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await sink(EVENT);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { event: EVENT });
    assert.equal(
      (calls[0]?.init?.headers as Record<string, string>).authorization,
      undefined,
    );
  });

  it("rejects credential-bearing or mutable endpoint forms", () => {
    for (const endpoint of [
      "http://example.test/project",
      "https://user:pass@example.test/project",
      "https://example.test/project?token=secret",
      "not-a-url",
    ]) {
      assert.throws(
        () => createPublicMeckyReplyProjectionSink({ endpoint }),
        /public_mecky_projection_url_invalid/,
      );
    }
  });

  it("fails retryably on any non-success status", async () => {
    const sink = createPublicMeckyReplyProjectionSink({
      endpoint: "https://example.test/project",
      fetchImpl: async () => new Response(null, { status: 503 }),
    });
    await assert.rejects(sink(EVENT), /public_mecky_projection_http_503/);
  });
});
