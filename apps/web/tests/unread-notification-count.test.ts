import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countUnreadNotifications,
  type UnreadNotificationCountSources,
} from "../src/lib/notifications/unread-count";
import { PERSONAL_NOTIFICATION_LOG_TYPES } from "../src/lib/notifications/policy";

test("logged-out counts include broadcasts but never query personal notifications", async () => {
  const calls: string[] = [];
  const sources: UnreadNotificationCountSources = {
    async countBroadcastPush(after) {
      calls.push(`push:${after}`);
      return 4;
    },
    async countBroadcastActivity(after) {
      calls.push(`activity:${after}`);
      return 7;
    },
    async countPersonal() {
      calls.push("personal");
      return 100;
    },
  };

  const count = await countUnreadNotifications({
    after: "2026-07-10T08:00:00.000Z",
    sources,
  });

  assert.equal(count, 11);
  assert.deepEqual(calls, [
    "push:2026-07-10T08:00:00.000Z",
    "activity:2026-07-10T08:00:00.000Z",
  ]);
});

test("logged-in counts add personal rows, normalize the wallet, and retain the 50 badge cap", async () => {
  const calls: Array<[string, string | undefined, string | undefined]> = [];
  const sources: UnreadNotificationCountSources = {
    async countBroadcastPush(after) {
      calls.push(["push", after, undefined]);
      return 30;
    },
    async countBroadcastActivity(after) {
      calls.push(["activity", after, undefined]);
      return 15;
    },
    async countPersonal(walletAddress, after) {
      calls.push(["personal", after, walletAddress]);
      return 20;
    },
  };

  const count = await countUnreadNotifications({
    after: "2026-07-10T08:00:00.000Z",
    walletAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    sources,
  });

  assert.equal(count, 50);
  assert.deepEqual(calls, [
    ["push", "2026-07-10T08:00:00.000Z", undefined],
    ["activity", "2026-07-10T08:00:00.000Z", undefined],
    [
      "personal",
      "2026-07-10T08:00:00.000Z",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    ],
  ]);
});

test("source failures reject instead of silently undercounting", async () => {
  const sources: UnreadNotificationCountSources = {
    async countBroadcastPush() {
      throw new Error("push count failed");
    },
    async countBroadcastActivity() {
      return 2;
    },
    async countPersonal() {
      return 3;
    },
  };

  await assert.rejects(
    countUnreadNotifications({ sources }),
    /push count failed/
  );
});

test("non-finite source counts cannot become a null unread badge", async () => {
  const sources: UnreadNotificationCountSources = {
    async countBroadcastPush() {
      return Number.NaN;
    },
    async countBroadcastActivity() {
      return 2;
    },
    async countPersonal() {
      return Number.POSITIVE_INFINITY;
    },
  };

  const count = await countUnreadNotifications({
    walletAddress: "0x0000000000000000000000000000000000000000",
    sources,
  });

  assert.equal(count, 2);
  assert.ok(Number.isFinite(count));
});

test("targeted mini-app pushes are excluded from the global broadcast log", () => {
  assert.ok(PERSONAL_NOTIFICATION_LOG_TYPES.includes("mini_app"));
});
