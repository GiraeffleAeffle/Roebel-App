import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./roebel-staging-publish.yml", import.meta.url), "utf8");
const docs = readFileSync(new URL("./ROEBEL_STAGING_PUBLISHER_CANDIDATE.md", import.meta.url), "utf8");

test("publisher candidate is manual main-only and fails closed twice", () => {
  const guardStart = workflow.indexOf("  guard:\n");
  const publishStart = workflow.indexOf("\n  publish:\n");
  assert.ok(guardStart >= 0 && publishStart > guardStart, "guard block must precede publish");
  const guard = workflow.slice(guardStart, publishStart);
  assert.match(workflow, /on:\n  workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  (?:push|pull_request|schedule):/u);
  assert.match(guard, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/u);
  assert.match(guard, /permissions: \{\}/u);
  assert.match(workflow, /PUBLISHER_ACTIVATION_STATE: UNBOUND_REVIEW_REQUIRED/u);
  assert.match(guard, /This publisher is intentionally UNBOUND_REVIEW_REQUIRED\.[\s\S]*?exit 1/u);
  assert.match(workflow, /if: \$\{\{ false \}\}/u);
  assert.doesNotMatch(guard, /(?:contents|packages|attestations|id-token):/u);
});

test("publisher candidate accepts only canonical immutable release inputs", () => {
  for (const input of ["promotion_revision", "expected_previous_head_digest", "previous_head_json"]) {
    assert.match(workflow, new RegExp(`      ${input}:\\n[\\s\\S]*?        required: true`, "u"));
  }
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$PROMOTION_REVISION"/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /\^sha256:\[0-9a-f\]\{64\}\$/u);
  assert.match(workflow, /roebel_staging_release_set_head_v1/u);
  assert.match(workflow, /expected_previous_head_digest/u);
});

test("candidate pins its public scope to two digest-attested GHCR images", () => {
  const images = [
    "ghcr.io/giraeffleaeffle/roebel-web-staging",
    "ghcr.io/giraeffleaeffle/public-mecky",
  ];
  for (const image of images) assert.match(workflow, new RegExp(image.replaceAll(".", "\\."), "u"));
  assert.equal((workflow.match(/ghcr\.io\/giraeffleaeffle\//gu) ?? []).length, 2);
  assert.match(workflow, /provenance: mode=max/u);
  assert.match(workflow, /sbom: true/u);
  assert.equal((workflow.match(/actions\/attest-build-provenance@v2/gu) ?? []).length, 2);
  assert.match(workflow, /subject-digest: \$\{\{ steps\.web\.outputs\.digest \}\}/u);
  assert.match(workflow, /subject-digest: \$\{\{ steps\.mecky\.outputs\.digest \}\}/u);
});

test("candidate has no deployment credentials or unbounded permission surface", () => {
  assert.match(workflow, /permissions: \{\}/u);
  assert.match(workflow, /packages: write/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /id-token: write/u);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./iu);
  assert.doesNotMatch(workflow, /^\s*(?:HETZNER|KUBECONFIG|TALOSCONFIG):/imu);
  assert.doesNotMatch(workflow, /^\s*(?:kubectl|helm|flux|tailscale|ssh)\b/imu);
  assert.match(docs, /atomic CAS/u);
  assert.match(docs, /not a substitute/u);
  assert.match(docs, /third-party Action/u);
  assert.match(docs, /UNBOUND/u);
  assert.match(workflow, /no locally evidenced official commit SHA is available/u);
});
