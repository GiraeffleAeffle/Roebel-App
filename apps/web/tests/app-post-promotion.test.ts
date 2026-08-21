import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { createCitizenSession } from "../src/lib/citizen-session/session";
import {
  promoteAppPostToCivicTopic,
  type AppPostPromotionGateway,
} from "../src/lib/stadtstack/app-post-promotion";
import type {
  StagingFeedResponse,
} from "../src/lib/stadtstack/staging-api";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"42".repeat(65)}`;
const APP_POST_ID = "018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61";

test("the original app-post author starts a topic discussion without creating a CivicCase", async () => {
  const session = createCitizenSession({
    appAccountId: "account-1",
    memberId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: ADDRESS,
      chainId: 100,
      signMessage: async () => SIGNATURE,
    },
  });
  const published: { intent: "post" | "promotion"; event: NostrEvent }[] = [];
  const emptyFeed: StagingFeedResponse = {
    schemaVersion: "roebel_staging_mixed_feed_v1",
    posts: [],
    authorityBinding: "none",
  };
  const gateway: AppPostPromotionGateway = {
    getConfig: async () => ({
      schemaVersion: "roebel_e2e_workbench_config_v1",
      personas: [],
      meckyPubkey: "ab".repeat(32),
      authorityBinding: "none",
    }),
    getFeed: async () => emptyFeed,
    admit: async (proof) => ({
      status: "admitted",
      pubkey: proof.bindingEvent.pubkey,
    }),
    publish: async (intent, event) => {
      published.push({ intent, event });
      return { status: intent === "post" ? "published" : "promoted" };
    },
  };

  const result = await promoteAppPostToCivicTopic({
    session,
    gateway,
    post: {
      id: APP_POST_ID,
      walletAddress: ADDRESS,
      content: "Röbel braucht einen offenen Treffpunkt für Begegnung.",
      createdAt: "2026-08-17T08:00:00.000Z",
    },
    topicTitle: "Offener Treffpunkt in Röbel",
    question: "Welche geprüften Informationen und Optionen gibt es dazu?",
    nowSeconds: 1_787_004_100,
  });

  assert.equal(result.status, "promoted");
  assert.equal(result.discussionId, published[1]?.event.id);
  assert.equal(
    result.topicId,
    "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt-in-roebel",
  );
  assert.equal(published.length, 2);
  assert.equal(published[0]?.intent, "post");
  assert.deepEqual(published[0]?.event.tags, [
    ["source-app-post", APP_POST_ID],
  ]);
  assert.equal(published[1]?.intent, "promotion");
  assert.equal(verifyEvent(published[1]!.event), true);
  assert.equal(
    published[1]?.event.tags.some((tag) => tag[0] === "case"),
    false,
  );
  assert.equal(
    published[1]?.event.tags.some((tag) => tag[0] === "stadtstack-case"),
    false,
  );
  assert.equal(
    published[1]?.event.tags.some(
      (tag) => tag[0] === "source-post" && tag[1] === published[0]?.event.id,
    ),
    true,
  );
});

test("a different signed-in account cannot promote someone else's app post", async () => {
  const session = createCitizenSession({
    appAccountId: "account-2",
    memberId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: "0x2222222222222222222222222222222222222222",
      chainId: 100,
      signMessage: async () => `0x${"43".repeat(65)}`,
    },
  });
  let gatewayCalls = 0;
  const gateway: AppPostPromotionGateway = {
    getConfig: async () => {
      gatewayCalls += 1;
      throw new Error("must_not_call");
    },
    getFeed: async () => {
      gatewayCalls += 1;
      throw new Error("must_not_call");
    },
    admit: async () => {
      gatewayCalls += 1;
      throw new Error("must_not_call");
    },
    publish: async () => {
      gatewayCalls += 1;
      throw new Error("must_not_call");
    },
  };

  await assert.rejects(
    () =>
      promoteAppPostToCivicTopic({
        session,
        gateway,
        post: {
          id: APP_POST_ID,
          walletAddress: ADDRESS,
          content: "Dieser Beitrag gehört dem ersten Konto.",
          createdAt: "2026-08-17T08:00:00.000Z",
        },
        topicTitle: "Ein fremdes Thema",
        question: "Darf ich das weiterführen?",
        nowSeconds: 1_787_004_100,
      }),
    /app_post_promotion_source_invalid/,
  );
  assert.equal(gatewayCalls, 0);
});
