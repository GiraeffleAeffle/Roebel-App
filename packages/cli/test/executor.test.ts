import { test } from "node:test";
import assert from "node:assert/strict";
import { RSYNC_DELETE_EXCLUDES } from "../src/executor.js";

// C1: `netizen up` rsync's the rendered bundle onto the box with --delete.
// Anything box-local and NOT excluded gets wiped on every deploy. These two
// are generated / box-edited state, not bundle content: members.txt is the
// on-chain-membership write allow-list; metering-excluded.txt is the
// author monetization opt-out consent state.
test("rsync --delete excludes the strfry write allow-list", () => {
  assert.ok(
    RSYNC_DELETE_EXCLUDES.includes("--exclude=strfry-policy/members.txt"),
    "members.txt must survive a deploy — it is generated state, not bundle content",
  );
});

test("rsync --delete excludes the metering opt-out list", () => {
  assert.ok(
    RSYNC_DELETE_EXCLUDES.includes("--exclude=strfry-policy/metering-excluded.txt"),
    "metering-excluded.txt must survive a deploy — box-edited consent state, wiping it re-monetizes opted-out authors",
  );
});

test("rsync --delete excludes secrets and the status file", () => {
  assert.ok(RSYNC_DELETE_EXCLUDES.includes("--exclude=.env"));
  assert.ok(RSYNC_DELETE_EXCLUDES.includes("--exclude=ops/status.json"));
});
