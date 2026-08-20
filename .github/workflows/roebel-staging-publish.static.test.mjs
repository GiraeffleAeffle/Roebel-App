import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./roebel-staging-publish.yml", import.meta.url), "utf8");
const docs = readFileSync(new URL("./ROEBEL_STAGING_PUBLISHER_CANDIDATE.md", import.meta.url), "utf8");

const actionPins = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
  ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
  ["docker/setup-buildx-action", "37fe631027851001ddb9b187196cc803df7f5f0e"],
  ["oras-project/setup-oras", "22ce207df3b08e061f537244349aac6ae1d214f6"],
  ["anchore/sbom-action/download-syft", "e22c389904149dbc22b58101806040fa8d37a610"],
  ["actions/attest", "1e69f48acb82d1966a394da916b4c1698aa569d6"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);

test("publisher is manual, main-only and protected by an environment", () => {
  assert.match(workflow, /on:\n  workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  (?:push|pull_request|schedule):/u);
  assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/u);
  assert.match(workflow, /environment: roebel-staging-publisher/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/commits\/\$SOURCE_REVISION/u);
});

test("runner-local paths are bound only after the runner exists", () => {
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\./u);
  assert.match(workflow, /- name: Bind runner-local evidence paths/u);
  assert.match(workflow, /printf 'ARCHIVE=%s\/%s\\n' "\$RUNNER_TEMP" "\$ARCHIVE_NAME"/u);
  for (const variable of ["LAYOUT", "SOURCE_RECEIPT", "SBOM", "PUBLICATION_RECEIPT"]) {
    assert.match(workflow, new RegExp(`printf '${variable}=`, "u"));
  }
  assert.match(workflow, /\} >> "\$GITHUB_ENV"/u);
});

test("publisher builds and publishes exactly the two secret-free staging components", () => {
  for (const component of ["roebel-web-staging", "public-mecky"]) {
    assert.match(workflow, new RegExp(`component: ${component}`, "u"));
  }
  for (const image of [
    "ghcr.io/giraeffleaeffle/roebel-web-staging",
    "ghcr.io/giraeffleaeffle/public-mecky",
  ]) {
    assert.match(workflow, new RegExp(image.replaceAll(".", "\\."), "u"));
  }
  assert.equal((workflow.match(/^\s+- component: /gmu) ?? []).length, 2);
  assert.match(workflow, /--output "type=oci,dest=\$ARCHIVE/u);
  assert.match(workflow, /verify-staging-web-oci\.mjs/u);
  assert.match(workflow, /verify-staging-service-oci\.mjs/u);
  assert.match(workflow, /oras cp --from-oci-layout/u);
  assert.match(workflow, /refusing to overwrite/u);
  assert.match(workflow, /source-\$SOURCE_REVISION/u);
  assert.doesNotMatch(workflow, /(?:tags?:\s*(?:latest|main)|:latest\b)/u);
});

test("all third-party actions are immutable and expected", () => {
  const uses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const use of uses) {
    const [name, sha] = use.split("@");
    assert.equal(sha?.length, 40, `${use} must use a full commit SHA`);
    assert.match(sha, /^[0-9a-f]{40}$/u);
    assert.equal(sha, actionPins.get(name), `${name} pin drift`);
  }
  assert.deepEqual(new Set(uses.map((use) => use.split("@")[0])), new Set(actionPins.keys()));
});

test("publication produces SPDX and GitHub OIDC attestations for exact digests", () => {
  assert.match(workflow, /syft-version: v1\.51\.0/u);
  assert.match(workflow, /oci-archive:\$ARCHIVE/u);
  assert.match(workflow, /SPDX-2\.3/u);
  assert.match(workflow, /stat -c %s "\$SBOM"\)" -le 16777216/u);
  assert.equal((workflow.match(/uses: actions\/attest@/gu) ?? []).length, 2);
  assert.equal((workflow.match(/push-to-registry: true/gu) ?? []).length, 2);
  assert.match(workflow, /subject-digest: \$\{\{ steps\.publish\.outputs\.manifest_digest \}\}/u);
  assert.match(workflow, /roebel_staging_publication_receipt_v1/u);
  assert.match(workflow, /civicAuthority:"none"/u);
  assert.match(workflow, /deploymentEffect:false/u);
});

test("publication has no deployment, runtime-secret or broad authority surface", () => {
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /packages: write/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /id-token: write/u);
  const secretRefs = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(new Set(secretRefs), new Set(["GITHUB_TOKEN"]));
  assert.doesNotMatch(workflow, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
  assert.doesNotMatch(workflow, /^\s*(?:HETZNER|KUBECONFIG|TALOSCONFIG|MECKY_INFERENCE_API_KEY):/imu);
  assert.match(docs, /publication is not promotion/iu);
  assert.match(docs, /public visibility cannot\s+be reversed/iu);
  assert.match(docs, /does not merge or deploy PR #8/iu);
});
