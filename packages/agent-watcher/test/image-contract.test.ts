import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

describe("Public Mecky image contract", () => {
  it("uses the reviewed linux/amd64 Node base by immutable digest", () => {
    assert.match(
      dockerfile,
      /FROM --platform=linux\/amd64 docker\.io\/library\/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS builder/,
    );
    assert.match(
      dockerfile,
      /FROM --platform=linux\/amd64 docker\.io\/library\/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime/,
    );
  });

  it("runs the Pi 0.84.1 harness on a compatible Node release", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      engines?: { node?: string };
      dependencies?: Record<string, string>;
    };
    assert.equal(packageJson.engines?.node, ">=22.19.0");
    assert.equal(packageJson.dependencies?.["@earendil-works/pi-agent-core"], "0.84.1");
    assert.equal(packageJson.dependencies?.["@earendil-works/pi-ai"], "0.84.1");
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

  it("requires a deterministic source date epoch for reproducible OCI output", () => {
    const runtimeIndex = dockerfile.indexOf(" AS runtime");
    assert.match(dockerfile.slice(0, runtimeIndex), /ARG SOURCE_DATE_EPOCH/);
    assert.match(
      dockerfile.slice(0, runtimeIndex),
      /test -n "\$\{SOURCE_DATE_EPOCH\}"[\s\S]*case "\$\{SOURCE_DATE_EPOCH\}" in \*\[!0-9\]\*\)/,
    );
  });

  it("installs only the pruned three-workspace closure from the reviewed lock", () => {
    assert.doesNotMatch(dockerfile, /pnpm fetch/);
    const installIndex = dockerfile.indexOf(
      "pnpm --filter @netizen-labs/agent-watcher... install --frozen-lockfile --offline --ignore-scripts",
    );
    assert.ok(installIndex > 0);
    assert.match(dockerfile, /--mount=type=bind,from=pnpm-store,source=\.,target=\/pnpm\/store,ro/);
    assert.match(dockerfile, /--mount=type=bind,from=corepack-cache,source=\.,target=\/root\/.cache\/node\/corepack,ro/);
    assert.equal(
      dockerfile.match(/--mount=type=bind,from=corepack-cache,source=\.,target=\/root\/.cache\/node\/corepack,ro/g)?.length,
      3,
    );
    const manifestContextIndex = dockerfile.indexOf("COPY --from=dependency-manifests . .");
    assert.ok(manifestContextIndex >= 0, "the reviewed pruned manifest context must be copied");
    assert.ok(
      manifestContextIndex < installIndex,
      "the reviewed pruned manifest context must be present before pnpm install",
    );
    assert.ok(
      dockerfile.indexOf("COPY . .") > installIndex,
      "application source must not invalidate the dependency layer",
    );
  });

  it("contains no runtime credential or secret value", () => {
    assert.doesNotMatch(dockerfile, /HETZNER_INFERENCE_API_KEY/);
    assert.doesNotMatch(dockerfile, /NODE_AGENT_SECRET/);
    assert.doesNotMatch(dockerfile, /MECKY_INFERENCE_API_KEY/);
  });
});
