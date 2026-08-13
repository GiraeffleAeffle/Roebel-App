import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../../Dockerfile.staging-web", import.meta.url), "utf8");

test("emits the standalone server only for the explicit Talos staging image", () => {
  assert.match(nextConfig, /process\.env\.ROEBEL_STANDALONE_IMAGE === "1" \? "standalone" : undefined/);
  assert.match(dockerfile, /ROEBEL_STANDALONE_IMAGE=1/);
  assert.match(dockerfile, /\.next\/standalone/);
});
