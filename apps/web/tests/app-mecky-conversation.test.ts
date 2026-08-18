import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { createCitizenSession } from "../src/lib/citizen-session/session";
import {
  containsExplicitMeckyMention,
  requestAppMeckyConversationAnswer,
  type AppMeckyConversationGateway,
} from "../src/lib/stadtstack/app-mecky-conversation";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const POST_ID = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";
const COMMENT_ID = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a62";

function session(address = ADDRESS) {
  return createCitizenSession({
    appAccountId: "account-1",
    memberId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address,
      chainId: 100,
      signMessage: async () => `0x${"42".repeat(65)}`,
    },
  });
}

test("recognises an explicit @Mecky mention but not email addresses or lookalikes", () => {
  assert.equal(containsExplicitMeckyMention("@Mecky, kannst du helfen?"), true);
  assert.equal(containsExplicitMeckyMention("Moin @mecky!"), true);
  assert.equal(containsExplicitMeckyMention("mail@mecky.de"), false);
  assert.equal(containsExplicitMeckyMention("@meckys Idee"), false);
  assert.equal(containsExplicitMeckyMention("@meckyä Idee"), false);
  assert.equal(containsExplicitMeckyMention("ohne Erwähnung"), false);
});

test("queues one signed ordinary-thread mention and creates no civic object", async () => {
  const citizen = session();
  const published: NostrEvent[] = [];
  const gateway: AppMeckyConversationGateway = {
    getConfig: async () => ({
      schemaVersion: "roebel_e2e_workbench_config_v1",
      personas: [],
      meckyPubkey: "ab".repeat(32),
      authorityBinding: "none",
    }),
    admit: async (proof) => ({
      status: "admitted",
      pubkey: proof.bindingEvent.pubkey,
    }),
    publish: async (event) => {
      published.push(event);
      return { status: "published", event };
    },
  };

  const result = await requestAppMeckyConversationAnswer({
    session: citizen,
    gateway,
    source: {
      postId: POST_ID,
      commentId: COMMENT_ID,
      walletAddress: ADDRESS,
      content: "@Mecky, welche geprüften Informationen gibt es hierzu?",
      createdAt: "2026-08-18T08:00:00.000Z",
    },
  });

  assert.equal(result.status, "requested");
  assert.equal(result.mentionId, published[0]?.id);
  assert.equal(verifyEvent(published[0]!), true);
  assert.deepEqual(published[0]?.tags, [
    ["p", "ab".repeat(32)],
    ["source-app-post", POST_ID],
    ["source-app-comment", COMMENT_ID],
    ["t", "roebel-app-conversation"],
  ]);
  for (const forbidden of [
    "topic",
    "case",
    "stadtstack-case",
    "proposal",
    "vote",
  ]) {
    assert.equal(
      published[0]?.tags.some((tag) => tag[0] === forbidden),
      false
    );
  }
});

test("rejects a non-mention and a different account before any gateway call", async () => {
  let calls = 0;
  const gateway: AppMeckyConversationGateway = {
    getConfig: async () => {
      calls += 1;
      throw new Error("must_not_call");
    },
    admit: async () => {
      calls += 1;
      throw new Error("must_not_call");
    },
    publish: async () => {
      calls += 1;
      throw new Error("must_not_call");
    },
  };
  await assert.rejects(
    requestAppMeckyConversationAnswer({
      session: session(),
      gateway,
      source: {
        postId: POST_ID,
        walletAddress: ADDRESS,
        content: "Eine normale Unterhaltung ohne Bot.",
        createdAt: "2026-08-18T08:00:00.000Z",
      },
    }),
    /app_mecky_conversation_source_invalid/
  );
  await assert.rejects(
    requestAppMeckyConversationAnswer({
      session: session("0x2222222222222222222222222222222222222222"),
      gateway,
      source: {
        postId: POST_ID,
        walletAddress: ADDRESS,
        content: "@Mecky, antworte bitte.",
        createdAt: "2026-08-18T08:00:00.000Z",
      },
    }),
    /app_mecky_conversation_source_invalid/
  );
  assert.equal(calls, 0);
});
