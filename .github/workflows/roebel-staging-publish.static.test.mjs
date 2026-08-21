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
  ["actions/download-artifact", "018cc2cf5baa6db3ef3c5f8a56943fffe632ef53"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);

const assemblyJobStart = workflow.indexOf("\n  assemble-release-set:");
const assemblyJob = assemblyJobStart >= 0 ? workflow.slice(assemblyJobStart) : "";

test("publisher follows protected relevant main pushes and retains exact-SHA recovery dispatch", () => {
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]/u);
  assert.match(workflow, /  workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  (?:pull_request|schedule):/u);
  for (const relevantPath of [
    "apps/web/**",
    "packages/agent-watcher/**",
    "packages/stadtstack-federation-client/**",
    "Dockerfile.staging-web",
    "pnpm-lock.yaml",
  ]) {
    assert.match(workflow, new RegExp(`- "${relevantPath.replaceAll("*", "\\*")}"`, "u"));
  }
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.source_revision \|\| github\.sha/u);
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
  assert.match(workflow, /uses: oras-project\/setup-oras@[0-9a-f]{40}[\s\S]*?version: 1\.3\.0/u);
  assert.doesNotMatch(workflow, /version: 1\.3\.3/u);
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

test("same-run evidence is verified into an effect-free CAS-bound Release Set candidate", () => {
  assert.notEqual(assemblyJobStart, -1);
  assert.match(assemblyJob, /needs: publish/u);
  assert.match(assemblyJob, /permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read/u);
  assert.doesNotMatch(assemblyJob, /(?:packages|attestations|contents): write/u);
  assert.doesNotMatch(assemblyJob, /id-token: write/u);
  assert.match(assemblyJob, /actions\/download-artifact@[0-9a-f]{40}/u);
  assert.match(assemblyJob, /pattern: "\*-publication-/u);
  assert.match(assemblyJob, /merge-multiple: true/u);
  assert.match(
    assemblyJob,
    /OPERATIONS_HEAD_URL: https:\/\/raw\.githubusercontent\.com\/GiraeffleAeffle\/roebel-staging-operations\/main\/reviewed-render\/roebel-staging\/head\.json/u,
  );
  assert.equal((assemblyJob.match(/gh attestation download /gu) ?? []).length, 2);
  assert.equal((assemblyJob.match(/gh attestation verify /gu) ?? []).length, 2);
  for (const predicate of ["https://slsa.dev/provenance/v1", "https://spdx.dev/Document/v2.3"]) {
    assert.match(assemblyJob, new RegExp(predicate.replaceAll("/", "\\/"), "u"));
  }
  assert.match(assemblyJob, /--cert-identity "\$SIGNER_IDENTITY"/u);
  assert.match(assemblyJob, /--source-digest "\$SOURCE_REVISION"/u);
  assert.match(assemblyJob, /--source-ref refs\/heads\/main/u);
  assert.match(assemblyJob, /--deny-self-hosted-runners/u);
  assert.match(assemblyJob, /verify_component roebel-web-staging "\$WEB_IMAGE"/u);
  assert.match(assemblyJob, /verify_component public-mecky "\$MECKY_IMAGE"/u);
  assert.match(assemblyJob, /scripts\/assemble-roebel-staging-release-set\.mjs/u);
  assert.match(assemblyJob, /release-set\/release-set\.candidate\.json/u);
  assert.match(assemblyJob, /roebel-staging-release-set-/u);
  assert.match(assemblyJob, /test "\$\(jq -er \.deploymentEffect "\$publication_receipt"\)" = false/u);
  assert.doesNotMatch(assemblyJob, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh|oras cp)\b/imu);
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
  assert.match(docs, /effect-free Release Set candidate/iu);
  assert.match(docs, /public visibility cannot\s+be reversed/iu);
  assert.match(docs, /does not merge or deploy a pull request/iu);
});
