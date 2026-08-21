import assert from "node:assert/strict";
import test from "node:test";

import { assembleRoebelStagingReleaseSet } from "./assemble-roebel-staging-release-set.mjs";

const promotionRevision = "a".repeat(40);
const oldMeckyRevision = "b".repeat(40);
const manifest = (character) => `sha256:${character.repeat(64)}`;

const baseReceipt = (component, sourceRevision, manifestCharacter) => ({
  schemaVersion: component === "roebel-web-staging" ? "roebel_staging_web_oci_receipt_v1" : "roebel_staging_service_oci_receipt_v1",
  ...(component === "public-mecky" ? { component } : {}),
  sourceRevision,
  importName: component === "roebel-web-staging"
    ? `stadtstack.local/roebel-web-preview/roebel-web-staging:source-${sourceRevision}`
    : `stadtstack.local/roebel-staging-lab/public-mecky:source-${sourceRevision}`,
  podReference: component === "roebel-web-staging"
    ? `stadtstack.local/roebel-web-preview/roebel-web-staging@${manifest(manifestCharacter)}`
    : `stadtstack.local/roebel-staging-lab/public-mecky@${manifest(manifestCharacter)}`,
  manifestDigest: manifest(manifestCharacter),
  configDigest: manifest(component === "roebel-web-staging" ? "d" : "e"),
  layerDigests: [manifest(component === "roebel-web-staging" ? "f" : "0")],
  user: "65532:65532",
  entrypoint: component === "roebel-web-staging" ? ["node"] : ["node", "/app/agent-watcher.cjs"],
  ...(component === "roebel-web-staging" ? { cmd: ["apps/web/runtime-entrypoint.mjs"] } : {}),
});

const evidence = (component, sourceRevision, manifestDigest) => ({
  schemaVersion: "roebel_staging_component_evidence_v1",
  component,
  sourceRevision,
  manifestDigest,
  provenance: {
    issuer: "https://token.actions.githubusercontent.com",
    identity: "https://github.com/GiraeffleAeffle/Roebel-App/.github/workflows/roebel-staging-publish.yml@refs/heads/main",
    predicateType: "https://slsa.dev/provenance/v1",
    subjectDigest: manifestDigest,
    attestationDigest: manifest("1"),
  },
  sbom: {
    format: "SPDX-2.3",
    identity: "https://spdx.dev/spdx/v2.3",
    subjectDigest: manifestDigest,
    artifactDigest: manifest("2"),
  },
});

const previousHead = ({ meckySourceRevision = "3".repeat(40), meckyManifestDigest = manifest("4") } = {}) => ({
  schemaVersion: "roebel_staging_release_set_head_v1",
  promotionRevision: "5".repeat(40),
  releaseSetDigest: manifest("6"),
  components: [
    { component: "public-mecky", sourceRevision: meckySourceRevision, manifestDigest: meckyManifestDigest },
    { component: "roebel-web-staging", sourceRevision: "7".repeat(40), manifestDigest: manifest("8") },
  ],
});

function validInput() {
  const webReceipt = baseReceipt("roebel-web-staging", promotionRevision, "b");
  const meckyReceipt = baseReceipt("public-mecky", promotionRevision, "c");
  return {
    promotionRevision,
    webReceipt,
    meckyReceipt,
    webEvidence: evidence("roebel-web-staging", webReceipt.sourceRevision, webReceipt.manifestDigest),
    meckyEvidence: evidence("public-mecky", meckyReceipt.sourceRevision, meckyReceipt.manifestDigest),
    previousHead: previousHead(),
  };
}

test("assembles deterministic tag-free release set from two promotion-revision receipts", () => {
  const first = assembleRoebelStagingReleaseSet(validInput());
  const second = assembleRoebelStagingReleaseSet(validInput());
  assert.deepEqual(first, second);
  assert.equal(first.promotionRevision, promotionRevision);
  assert.equal(first.components.map((component) => component.component).join(","), "public-mecky,roebel-web-staging");
  assert.equal(first.components.every((component) => component.sourceRevision === promotionRevision), true);
  assert.match(first.candidatePayloadDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes("importName"), false);
  assert.equal(JSON.stringify(first).includes(":sha-"), false);
});

test("allows a web-only promotion to retain the exactly approved Mecky digest", () => {
  const input = validInput();
  input.meckyReceipt = baseReceipt("public-mecky", oldMeckyRevision, "c");
  input.meckyEvidence = evidence("public-mecky", oldMeckyRevision, input.meckyReceipt.manifestDigest);
  input.previousHead = previousHead({
    meckySourceRevision: oldMeckyRevision,
    meckyManifestDigest: input.meckyReceipt.manifestDigest,
  });
  const candidate = assembleRoebelStagingReleaseSet(input);
  assert.equal(candidate.components[0].sourceRevision, oldMeckyRevision);
  assert.equal(candidate.components[1].sourceRevision, promotionRevision);
});

test("fails closed when old Mecky is arbitrarily substituted instead of retained from the previous head", () => {
  const input = validInput();
  input.meckyReceipt = baseReceipt("public-mecky", oldMeckyRevision, "c");
  input.meckyEvidence = evidence("public-mecky", oldMeckyRevision, input.meckyReceipt.manifestDigest);
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /public-mecky_reuse_not_approved/u);
});

test("fails closed when previous head has the reused source but a different approved manifest", () => {
  const input = validInput();
  input.meckyReceipt = baseReceipt("public-mecky", oldMeckyRevision, "c");
  input.meckyEvidence = evidence("public-mecky", oldMeckyRevision, input.meckyReceipt.manifestDigest);
  input.previousHead = previousHead({ meckySourceRevision: oldMeckyRevision, meckyManifestDigest: manifest("9") });
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /public-mecky_reuse_not_approved/u);
});

test("fails closed when attestation evidence does not bind the verified manifest", () => {
  const input = validInput();
  input.webEvidence.provenance.subjectDigest = manifest("9");
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /roebel-web-staging_provenance_identity_invalid/u);
});

test("fails closed when the expected previous-head pointer is not immutable", () => {
  const input = validInput();
  input.previousHead.releaseSetDigest = "not-a-digest";
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /previous_head_digest_invalid/u);
});

test("fails closed when no component is at the explicit promotion revision", () => {
  const input = validInput();
  input.webReceipt = baseReceipt("roebel-web-staging", "d".repeat(40), "b");
  input.webEvidence = evidence("roebel-web-staging", input.webReceipt.sourceRevision, input.webReceipt.manifestDigest);
  input.meckyReceipt = baseReceipt("public-mecky", oldMeckyRevision, "c");
  input.meckyEvidence = evidence("public-mecky", input.meckyReceipt.sourceRevision, input.meckyReceipt.manifestDigest);
  input.previousHead = {
    ...previousHead({ meckySourceRevision: oldMeckyRevision, meckyManifestDigest: input.meckyReceipt.manifestDigest }),
    components: [
      { component: "public-mecky", sourceRevision: oldMeckyRevision, manifestDigest: input.meckyReceipt.manifestDigest },
      { component: "roebel-web-staging", sourceRevision: input.webReceipt.sourceRevision, manifestDigest: input.webReceipt.manifestDigest },
    ],
  };
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /promotion_noop/u);
});

test("fails closed when an OCI receipt does not preserve its verifier-bound import identity", () => {
  const input = validInput();
  input.webReceipt.importName = "ghcr.io/example/roebel-web-staging:latest";
  assert.throws(() => assembleRoebelStagingReleaseSet(input), /roebel-web-staging_oci_identity_invalid/u);
});
