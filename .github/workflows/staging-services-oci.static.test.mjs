import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./staging-services-oci.yml", import.meta.url), "utf8");
const detector = readFileSync(
  new URL("../../scripts/ci/affected-staging-components.mjs", import.meta.url),
  "utf8",
);

test("service builds use the repository-owned affected-component matrix", () => {
  assert.match(workflow, /\n  changes:\n    name: Detect affected staging services/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /git diff --name-only "\$BASE_SHA" "\$HEAD_SHA"/u);
  assert.match(workflow, /printf '__all__\\n'/u);
  assert.match(workflow, /node scripts\/ci\/affected-staging-components\.mjs --github-output/u);
  assert.match(workflow, /needs: changes/u);
  assert.match(workflow, /if: \$\{\{ needs\.changes\.outputs\.any_service == 'true' \}\}/u);
  assert.match(
    workflow,
    /matrix: \$\{\{ fromJSON\(needs\.changes\.outputs\.service_build_matrix\) \}\}/u,
  );
  assert.doesNotMatch(workflow, /matrix:\n\s+include:/u);
  for (const triggerPath of ["packages/relay-sync/**", "patches/**", "scripts/ci/**", "turbo.json"]) {
    assert.match(workflow, new RegExp(`- "${triggerPath.replaceAll("*", "\\*")}"`, "u"));
  }
});

test("matrix identities are closed in source rather than accepted from an event", () => {
  for (const value of [
    "public-mecky",
    "@netizen-labs/agent-watcher",
    "packages/agent-watcher/Dockerfile",
    "roebel-e2e-workbench",
    "@roebel/e2e-workbench",
    "packages/e2e-workbench/Dockerfile",
    "roebel-staging-relay",
    "@roebel/staging-relay",
    "packages/staging-relay/Dockerfile",
  ]) {
    assert.match(detector, new RegExp(value.replaceAll("/", "\\/"), "u"));
  }
  assert.match(workflow, /COMPONENT: \$\{\{ matrix\.component \}\}/u);
  assert.match(workflow, /PACKAGE: \$\{\{ matrix\.package \}\}/u);
  assert.match(workflow, /DOCKERFILE: \$\{\{ matrix\.dockerfile \}\}/u);
  assert.doesNotMatch(workflow, /github\.event\.inputs\.(?:component|package|dockerfile)/u);
});

test("missing comparison history fails closed to every service", () => {
  assert.match(workflow, /! git cat-file -e "\$BASE_SHA\^\{commit\}"/u);
  assert.match(detector, /changedPaths\.includes\("__all__"\)/u);
  assert.match(detector, /service_build_matrix/u);
});

test("the hosted service build runs the workbench's mandatory package tests", () => {
  assert.match(detector, /package: "@roebel\/e2e-workbench"/u);
  assert.match(workflow, /--filter "\$PACKAGE" test/u);
  assert.doesNotMatch(workflow, /ROEBEL_LOCKED_VIEM_WEBPACK_SERVER/u);
});
