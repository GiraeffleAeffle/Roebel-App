import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STADTSTACK_STAGING_LAB_PATH,
  resolveStadtstackStagingLab,
} from "../src/lib/stadtstack/staging-lab";

test("shows the synthetic Stadtstack workflow only behind the explicit staging flag", () => {
  assert.deepEqual(resolveStadtstackStagingLab("1"), {
    href: STADTSTACK_STAGING_LAB_PATH,
    label: "Synthetischer Test",
  });
  assert.deepEqual(resolveStadtstackStagingLab(" true "), {
    href: STADTSTACK_STAGING_LAB_PATH,
    label: "Synthetischer Test",
  });

  for (const value of [undefined, "", "0", "false", "yes", "TRUE!"]) {
    assert.equal(resolveStadtstackStagingLab(value), null);
  }
});

test("keeps the browser target same-origin and outside production API paths", () => {
  assert.equal(STADTSTACK_STAGING_LAB_PATH, "/stadtstack-test/");
  assert.equal(STADTSTACK_STAGING_LAB_PATH.startsWith("/api"), false);
  assert.equal(STADTSTACK_STAGING_LAB_PATH.includes(":"), false);
  assert.equal(STADTSTACK_STAGING_LAB_PATH.includes("//"), false);
});
