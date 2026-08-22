import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stagingWebDependencyFamily } from "./staging-web-dependency-family.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roebel-web-dependency-family-"));
  for (const path of [
    ".npmrc",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/web/package.json",
    "packages/nostr/package.json",
    "patches/example.patch",
  ]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `${path}\n`);
  }
  writeFileSync(join(root, "apps/web/page.tsx"), "source does not affect dependencies\n");
  return root;
}

test("dependency family binds every materialization input but not application source", () => {
  const root = fixture();
  const first = stagingWebDependencyFamily(root);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(stagingWebDependencyFamily(root), first);

  writeFileSync(join(root, "apps/web/page.tsx"), "changed source\n");
  assert.equal(stagingWebDependencyFamily(root), first);

  writeFileSync(join(root, "packages/nostr/package.json"), "changed dependency\n");
  assert.notEqual(stagingWebDependencyFamily(root), first);
});

test("dependency family rejects relative and missing inputs", () => {
  assert.throws(
    () => stagingWebDependencyFamily("relative"),
    /staging_web_dependency_context_not_absolute/u,
  );
  const root = fixture();
  rmSync(join(root, "apps/web/package.json"));
  assert.throws(
    () => stagingWebDependencyFamily(root),
    /staging_web_dependency_manifest_missing/u,
  );
});
