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

  it("validates source provenance outside the final runtime stage", () => {
    const runtimeMarker = " AS runtime";
    const runtimeIndex = dockerfile.indexOf(runtimeMarker);
    assert.ok(runtimeIndex > 0);
    assert.match(dockerfile.slice(0, runtimeIndex), /ARG SOURCE_REVISION[\s\S]*RUN test "\$\{#SOURCE_REVISION\}" -eq 40/);
    assert.doesNotMatch(dockerfile.slice(runtimeIndex), /RUN test "\$\{#SOURCE_REVISION\}"/);
  });

  it("installs only the three-workspace closure from the reviewed lock", () => {
    assert.doesNotMatch(dockerfile, /pnpm fetch/);
    const installIndex = dockerfile.indexOf(
      "pnpm --filter @netizen-labs/agent-watcher... install --frozen-lockfile --offline",
    );
    assert.ok(installIndex > 0);
    assert.match(dockerfile, /--mount=type=bind,from=pnpm-store,source=\.,target=\/pnpm\/store,ro/);
    assert.match(dockerfile, /--mount=type=bind,from=corepack-cache,source=\.,target=\/root\/.cache\/node\/corepack,ro/);
    for (const manifest of [
      "packages/nostr/package.json",
      "packages/stadtstack-federation-client/package.json",
      "packages/agent-watcher/package.json",
    ]) {
      const copyIndex = dockerfile.indexOf(`COPY ${manifest}`);
      assert.ok(copyIndex >= 0, `${manifest} must be copied into the dependency layer`);
      assert.ok(copyIndex < installIndex, `${manifest} must be present before pnpm install`);
    }
  });

  it("contains no runtime credential or secret value", () => {
    assert.doesNotMatch(dockerfile, /HETZNER_INFERENCE_API_KEY/);
    assert.doesNotMatch(dockerfile, /NODE_AGENT_SECRET/);
    assert.doesNotMatch(dockerfile, /MECKY_INFERENCE_API_KEY/);
  });
});
