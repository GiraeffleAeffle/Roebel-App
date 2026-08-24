import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("./roebel-e2e-runtime-publish.yml", import.meta.url),
  "utf8"
);

test("the signed-Nostr runtime publisher is separate from the normal release set", () => {
  assert.match(workflow, /name: Röbel signed-Nostr E2E runtime publisher/u);
  assert.match(workflow, /packages\/e2e-workbench\/\*\*/u);
  assert.match(workflow, /packages\/staging-relay\/\*\*/u);
  assert.doesNotMatch(workflow, /roebel-web-staging/u);
  assert.doesNotMatch(workflow, /public-mecky/u);
  assert.doesNotMatch(workflow, /assemble-release-set/u);
  assert.doesNotMatch(workflow, /Dockerfile\.staging-web/u);
});

test("the only runtime images and GitOps input are exact, digest-bound components", () => {
  for (const value of [
    "roebel-e2e-workbench",
    "@roebel/e2e-workbench",
    "packages/e2e-workbench/Dockerfile",
    "ghcr.io/giraeffleaeffle/roebel-e2e-workbench",
    "roebel-staging-relay",
    "@roebel/staging-relay",
    "packages/staging-relay/Dockerfile",
    "ghcr.io/giraeffleaeffle/roebel-staging-relay",
    "roebel_e2e_runtime_pin_v1",
  ]) {
    assert.match(workflow, new RegExp(value.replaceAll("/", "\\/"), "u"));
  }
  assert.match(workflow, /oras cp --from-oci-layout/u);
  assert.match(workflow, /test "\$published_digest" = "\$EXPECTED_DIGEST"/u);
  assert.match(workflow, /test "\$\(oras resolve "\$IMAGE@\$EXPECTED_DIGEST"\)" = "\$EXPECTED_DIGEST"/u);
  assert.match(workflow, /runtime_pin_receipt_count_invalid/u);
  assert.match(workflow, /runtime_pin_component_set_invalid/u);
  assert.match(workflow, /gh attestation verify "oci:\/\/\$image@\$digest"/u);
  assert.match(workflow, /--source-digest "\$SOURCE_REVISION"/u);
  assert.match(workflow, /--deny-self-hosted-runners/u);
});

test("publication has scoped OIDC attestation permissions and no secret dependency", () => {
  assert.match(workflow, /^permissions: \{\}/mu);
  assert.match(
    workflow,
    /permissions:\n      contents: read\n      packages: write\n      attestations: write\n      id-token: write/u
  );
  assert.match(workflow, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/g);
  assert.match(workflow, /sbom-path: \$\{\{ env\.SBOM \}\}/u);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]+/u);
  assert.match(workflow, /concurrency:\n  group: roebel-e2e-runtime-publisher-/u);
});
