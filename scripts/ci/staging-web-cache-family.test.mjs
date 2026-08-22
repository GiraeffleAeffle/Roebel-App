import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stagingWebCacheFamily } from "./staging-web-cache-family.mjs";

const inputs = [
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/web/package.json",
  "apps/web/next.config.mjs",
  "apps/web/postcss.config.js",
  "apps/web/tailwind.config.ts",
  "apps/web/tsconfig.json",
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roebel-web-cache-family-"));
  for (const path of inputs) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `${path}\n`);
  }
  return root;
}

test("cache family is deterministic and changes with build inputs", () => {
  const root = fixture();
  const first = stagingWebCacheFamily(root);
  const second = stagingWebCacheFamily(root);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(second, first);

  writeFileSync(join(root, "apps/web/next.config.mjs"), "changed\n");
  assert.notEqual(stagingWebCacheFamily(root), first);
});

test("cache family rejects relative or missing inputs", () => {
  assert.throws(
    () => stagingWebCacheFamily("relative"),
    /staging_web_cache_context_not_absolute/u,
  );
  const root = fixture();
  rmSync(join(root, "pnpm-lock.yaml"));
  assert.throws(
    () => stagingWebCacheFamily(root),
    /ENOENT|staging_web_cache_input_invalid/u,
  );
});
