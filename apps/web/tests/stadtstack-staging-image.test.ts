import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../../Dockerfile.staging-web", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../../../Dockerfile.staging-web.dockerignore", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../.github/workflows/staging-web-oci.yml", import.meta.url), "utf8");

test("emits the standalone server only for the explicit Talos staging image", () => {
  assert.match(nextConfig, /process\.env\.ROEBEL_STANDALONE_IMAGE === "1" \? "standalone" : undefined/);
  assert.match(dockerfile, /ROEBEL_STANDALONE_IMAGE=1/);
  assert.match(dockerfile, /\.next\/standalone/);
});

test("installs only the Röbel web dependency graph from the frozen offline store", () => {
  assert.doesNotMatch(dockerfile, /pnpm fetch/);
  assert.match(
    dockerfile,
    /RUN --mount=type=bind,from=corepack-cache,[\s\S]*?--mount=type=bind,from=pnpm-store,[\s\S]*?pnpm --filter @roebel\/web\.\.\. install --offline --frozen-lockfile --ignore-scripts/,
  );
  assert.match(
    dockerfile,
    /RUN --mount=type=bind,from=corepack-cache,[^\n]*pnpm --filter @roebel\/web build/,
  );
});

test("sends only the web app and its exact workspace graph to the staging builder", () => {
  assert.match(dockerignore, /^\*\*$/m);
  for (const path of [
    "apps/web",
    "packages/miniapp-sdk",
    "packages/nostr",
    "packages/protocol",
    "packages/publisher",
    "packages/record-client",
    "packages/workspace",
  ]) {
    assert.match(dockerignore, new RegExp(`^!${path.replaceAll("/", "\\/")}\\/\\*\\*$`, "m"));
  }
  for (const forbidden of ["apps/expo", "apps/mini-apps", "circles-roebel-mini-app", "contracts"]) {
    assert.doesNotMatch(dockerignore, new RegExp(`^!${forbidden.replaceAll("/", "\\/")}` , "m"));
  }
  for (const generated of [
    "apps/web/.next",
    "apps/web/node_modules",
    "apps/web/tsconfig.tsbuildinfo",
    "apps/web/package-lock.json",
    "apps/web/yarn.lock",
  ]) {
    assert.match(dockerignore, new RegExp(`^${generated.replaceAll("/", "\\/")}$`, "m"));
  }
});

test("builds one bounded private OCI artifact remotely without publishing it", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /packages: write|push:\s*true|docker\/login-action|ghcr\.io/);
  assert.match(workflow, /turbo@2\.4\.0 prune @roebel\/web --docker/);
  assert.match(workflow, /pnpm fetch --store-dir/);
  assert.doesNotMatch(workflow, /pnpm fetch --(?:dev|prod)/);
  assert.match(workflow, /--output type=oci,dest=\/tmp\/roebel-web-staging\.oci\.tar/);
  assert.match(workflow, /MAX_ARTIFACT_BYTES:\s*"?167772160"?/);
  assert.match(workflow, /verify-staging-web-oci\.mjs/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
});
