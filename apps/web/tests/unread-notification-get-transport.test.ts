import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseUnreadCountParameters,
  readUnreadCountQuery,
} from "../src/lib/notifications/unread-count-request";

test("GET unread reader accepts only the bounded timestamp and wallet parameters", () => {
  assert.deepEqual(
    readUnreadCountQuery(new URLSearchParams({
      since: "2026-08-19T08:30:00.000Z",
      wallet: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    })),
    {
      after: "2026-08-19T08:30:00.000Z",
      walletAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    }
  );

  assert.throws(
    () => readUnreadCountQuery(new URLSearchParams("wallet=0xabc&wallet=0xdef")),
    /Repeated query parameter/
  );
  assert.throws(
    () => parseUnreadCountParameters({ wallet: "not-a-wallet" }),
    /Invalid wallet address/
  );
});

test("the browser poller uses the staging-safe GET route", () => {
  const hook = readFileSync(
    join(process.cwd(), "apps/web/src/hooks/useUnreadNotifications.ts"),
    "utf8"
  );
  const route = readFileSync(
    join(process.cwd(), "apps/web/src/app/api/notifications/unread-count/route.ts"),
    "utf8"
  );

  assert.match(hook, /fetch\(`\/api\/notifications\/unread-count\$\{query/);
  assert.doesNotMatch(hook, /method:\s*["']POST["']/);
  assert.match(route, /export async function GET/);
});
