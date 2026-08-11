import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

describe("Public Mecky image contract", () => {
  it("uses the reviewed linux/amd64 Node base by immutable digest", () => {
    assert.match(
      dockerfile,
      /FROM --platform=linux\/amd64 docker\.io\/library\/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf AS builder/,
    );
    assert.match(
      dockerfile,
      /FROM --platform=linux\/amd64 docker\.io\/library\/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf AS runtime/,
    );
  });

  it("ships only the bundled watcher and runs without root", () => {
    assert.match(
      dockerfile,
      /COPY --from=builder --chown=65532:65532 \/workspace\/packages\/agent-watcher\/dist\/agent-watcher\.cjs \/app\/agent-watcher\.cjs/,
    );
    assert.match(dockerfile, /USER 65532:65532/);
    assert.match(dockerfile, /ENTRYPOINT \["node", "\/app\/agent-watcher\.cjs"\]/);
  });

  it("hydrates the filtered offline store from the three workspace manifests", () => {
    const fetchIndex = dockerfile.indexOf("pnpm fetch --filter @netizen-labs/agent-watcher...");
    assert.ok(fetchIndex > 0);
    for (const manifest of [
      "packages/nostr/package.json",
      "packages/stadtstack-federation-client/package.json",
      "packages/agent-watcher/package.json",
    ]) {
      const copyIndex = dockerfile.indexOf(`COPY ${manifest}`);
      assert.ok(copyIndex >= 0, `${manifest} must be copied into the dependency layer`);
      assert.ok(copyIndex < fetchIndex, `${manifest} must be present before pnpm fetch`);
    }
  });

  it("contains no runtime credential or secret value", () => {
    assert.doesNotMatch(dockerfile, /HETZNER_INFERENCE_API_KEY/);
    assert.doesNotMatch(dockerfile, /NODE_AGENT_SECRET/);
    assert.doesNotMatch(dockerfile, /MECKY_INFERENCE_API_KEY/);
  });
});
