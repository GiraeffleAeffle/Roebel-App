#!/usr/bin/env node
/**
 * Assemble an effect-free Release Set candidate from already verified inputs.
 *
 * This module validates deterministic shape and cross-document bindings only.
 * It does not verify signatures or attestations and it does not perform the
 * atomic previous-head comparison. A protected promotion job must do both and
 * supply immutable verification receipts before this candidate can authorize
 * any registry or cluster effect.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const WEB_RECEIPT_KEYS = [
  "cmd",
  "configDigest",
  "entrypoint",
  "importName",
  "layerDigests",
  "manifestDigest",
  "podReference",
  "schemaVersion",
  "sourceRevision",
  "user",
];
const MECKY_RECEIPT_KEYS = [
  "component",
  "configDigest",
  "entrypoint",
  "importName",
  "layerDigests",
  "manifestDigest",
  "podReference",
  "schemaVersion",
  "sourceRevision",
  "user",
];
const EVIDENCE_KEYS = ["component", "manifestDigest", "provenance", "sbom", "schemaVersion", "sourceRevision"];
const PROVENANCE_KEYS = ["attestationDigest", "identity", "issuer", "predicateType", "subjectDigest"];
const SBOM_KEYS = ["artifactDigest", "format", "identity", "subjectDigest"];
const HEAD_KEYS = ["components", "promotionRevision", "releaseSetDigest", "schemaVersion"];
const HEAD_COMPONENT_KEYS = ["component", "manifestDigest", "sourceRevision"];
const COMPONENTS = new Set(["public-mecky", "roebel-web-staging"]);
const FORBIDDEN_OUTPUT = /(?:secret|token|password|runtime|tag|image(?:reference)?|environment|endpoint|(?:^|_)key(?:$|_))/iu;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (reason) => {
  throw new Error(`release_set_${reason}`);
};

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}_invalid`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label}_shape_invalid`);
}

function assertDigest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label}_invalid`);
}

function assertSourceRevision(value, label) {
  if (!FULL_SHA.test(value ?? "")) fail(`${label}_invalid`);
}

function assertDigestArray(value, label) {
  if (!Array.isArray(value) || value.length < 1) fail(`${label}_invalid`);
  for (const digest of value) assertDigest(digest, label);
}

function validateOciReceipt(receipt, component) {
  const isWeb = component === "roebel-web-staging";
  exactKeys(receipt, isWeb ? WEB_RECEIPT_KEYS : MECKY_RECEIPT_KEYS, `${component}_oci_receipt`);
  if (receipt.schemaVersion !== (isWeb ? "roebel_staging_web_oci_receipt_v1" : "roebel_staging_service_oci_receipt_v1")) {
    fail(`${component}_oci_schema_invalid`);
  }
  if (!isWeb && receipt.component !== component) fail(`${component}_oci_component_invalid`);
  assertSourceRevision(receipt.sourceRevision, `${component}_oci_source_revision`);
  assertDigest(receipt.manifestDigest, `${component}_oci_manifest_digest`);
  assertDigest(receipt.configDigest, `${component}_oci_config_digest`);
  assertDigestArray(receipt.layerDigests, `${component}_oci_layer_digests`);
  if (receipt.user !== "65532:65532" || !Array.isArray(receipt.entrypoint)) fail(`${component}_oci_runtime_invalid`);
  const repository = isWeb
    ? "stadtstack.local/roebel-web-preview/roebel-web-staging"
    : "stadtstack.local/roebel-staging-lab/public-mecky";
  if (
    receipt.importName !== `${repository}:source-${receipt.sourceRevision}` ||
    receipt.podReference !== `${repository}@${receipt.manifestDigest}`
  ) {
    fail(`${component}_oci_identity_invalid`);
  }
  if (
    (isWeb && (JSON.stringify(receipt.entrypoint) !== JSON.stringify(["node"]) || JSON.stringify(receipt.cmd) !== JSON.stringify(["apps/web/runtime-entrypoint.mjs"]))) ||
    (!isWeb && JSON.stringify(receipt.entrypoint) !== JSON.stringify(["node", "/app/agent-watcher.cjs"]))
  ) {
    fail(`${component}_oci_runtime_invalid`);
  }
  return receipt;
}

function validateEvidence(evidence, component, sourceRevision, manifestDigest) {
  exactKeys(evidence, EVIDENCE_KEYS, `${component}_evidence`);
  if (evidence.schemaVersion !== "roebel_staging_component_evidence_v1" || evidence.component !== component) fail(`${component}_evidence_identity_invalid`);
  if (evidence.sourceRevision !== sourceRevision || evidence.manifestDigest !== manifestDigest) fail(`${component}_evidence_subject_mismatch`);
  exactKeys(evidence.provenance, PROVENANCE_KEYS, `${component}_provenance`);
  if (
    evidence.provenance.issuer !== "https://token.actions.githubusercontent.com" ||
    evidence.provenance.identity !== "https://github.com/GiraeffleAeffle/Roebel-App/.github/workflows/roebel-staging-publish.yml@refs/heads/main" ||
    evidence.provenance.predicateType !== "https://slsa.dev/provenance/v1" ||
    evidence.provenance.subjectDigest !== manifestDigest
  ) {
    fail(`${component}_provenance_identity_invalid`);
  }
  assertDigest(evidence.provenance.attestationDigest, `${component}_provenance_attestation_digest`);
  exactKeys(evidence.sbom, SBOM_KEYS, `${component}_sbom`);
  if (
    evidence.sbom.format !== "SPDX-2.3" ||
    evidence.sbom.identity !== "https://spdx.dev/spdx/v2.3" ||
    evidence.sbom.subjectDigest !== manifestDigest
  ) {
    fail(`${component}_sbom_identity_invalid`);
  }
  assertDigest(evidence.sbom.artifactDigest, `${component}_sbom_artifact_digest`);
  return evidence;
}

function validatePreviousHead(previousHead) {
  exactKeys(previousHead, HEAD_KEYS, "previous_head");
  if (previousHead.schemaVersion !== "roebel_staging_release_set_head_v1") fail("previous_head_schema_invalid");
  assertSourceRevision(previousHead.promotionRevision, "previous_head_promotion_revision");
  assertDigest(previousHead.releaseSetDigest, "previous_head_digest");
  if (!Array.isArray(previousHead.components) || previousHead.components.length !== COMPONENTS.size) fail("previous_head_components_invalid");
  const seen = new Set();
  for (const component of previousHead.components) {
    exactKeys(component, HEAD_COMPONENT_KEYS, "previous_head_component");
    if (!COMPONENTS.has(component.component) || seen.has(component.component)) fail("previous_head_component_identity_invalid");
    seen.add(component.component);
    assertSourceRevision(component.sourceRevision, "previous_head_component_source_revision");
    assertDigest(component.manifestDigest, "previous_head_component_manifest_digest");
  }
  return {
    schemaVersion: previousHead.schemaVersion,
    promotionRevision: previousHead.promotionRevision,
    releaseSetDigest: previousHead.releaseSetDigest,
    components: previousHead.components
      .map((component) => ({
        component: component.component,
        sourceRevision: component.sourceRevision,
        manifestDigest: component.manifestDigest,
      }))
      .sort((left, right) => left.component.localeCompare(right.component)),
  };
}

function assertOutputHasNoRuntimeOrSecretSurface(value) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_OUTPUT.test(key)) fail("output_contains_forbidden_key");
        walk(child);
      }
      return;
    }
    if (typeof node === "string" && /(?:\b(?:sk|ghp|github_pat)_[a-z0-9_\-]+\b|-----BEGIN)/iu.test(node)) {
      fail("output_contains_forbidden_value");
    }
  };
  walk(value);
}

function componentRecord(component, receipt, evidence) {
  return {
    component,
    sourceRevision: receipt.sourceRevision,
    manifestDigest: receipt.manifestDigest,
    configDigest: receipt.configDigest,
    layerDigests: [...receipt.layerDigests],
    provenance: {
      issuer: evidence.provenance.issuer,
      identity: evidence.provenance.identity,
      predicateType: evidence.provenance.predicateType,
      attestationDigest: evidence.provenance.attestationDigest,
    },
    sbom: {
      format: evidence.sbom.format,
      identity: evidence.sbom.identity,
      artifactDigest: evidence.sbom.artifactDigest,
    },
  };
}

function assertApprovedReuse(component, receipt, previousHead) {
  const approved = previousHead.components.find((entry) => entry.component === component);
  if (!approved || approved.sourceRevision !== receipt.sourceRevision || approved.manifestDigest !== receipt.manifestDigest) {
    fail(`${component}_reuse_not_approved`);
  }
}

export function assembleRoebelStagingReleaseSet({ promotionRevision, webReceipt, meckyReceipt, webEvidence, meckyEvidence, previousHead }) {
  assertSourceRevision(promotionRevision, "promotion_revision");
  const verifiedWeb = validateOciReceipt(webReceipt, "roebel-web-staging");
  const verifiedMecky = validateOciReceipt(meckyReceipt, "public-mecky");
  const verifiedWebEvidence = validateEvidence(webEvidence, "roebel-web-staging", verifiedWeb.sourceRevision, verifiedWeb.manifestDigest);
  const verifiedMeckyEvidence = validateEvidence(meckyEvidence, "public-mecky", verifiedMecky.sourceRevision, verifiedMecky.manifestDigest);
  const expectedPreviousHead = validatePreviousHead(previousHead);
  const records = [
    ["public-mecky", verifiedMecky],
    ["roebel-web-staging", verifiedWeb],
  ];
  if (records.every(([, receipt]) => receipt.sourceRevision !== promotionRevision)) fail("promotion_noop");
  for (const [component, receipt] of records) {
    if (receipt.sourceRevision !== promotionRevision) assertApprovedReuse(component, receipt, expectedPreviousHead);
  }

  const payload = {
    schemaVersion: "roebel_staging_release_set_candidate_v1",
    promotionRevision,
    expectedPreviousHead: {
      promotionRevision: expectedPreviousHead.promotionRevision,
      releaseSetDigest: expectedPreviousHead.releaseSetDigest,
      components: expectedPreviousHead.components,
    },
    components: [
      componentRecord("public-mecky", verifiedMecky, verifiedMeckyEvidence),
      componentRecord("roebel-web-staging", verifiedWeb, verifiedWebEvidence),
    ],
  };
  assertOutputHasNoRuntimeOrSecretSurface(payload);
  return {
    ...payload,
    candidatePayloadDigest: sha256(canonicalJson(payload)),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [promotionRevision, webReceiptPath, meckyReceiptPath, webEvidencePath, meckyEvidencePath, previousHeadPath, outputPath] = process.argv.slice(2);
  if (![promotionRevision, webReceiptPath, meckyReceiptPath, webEvidencePath, meckyEvidencePath, previousHeadPath, outputPath].every(Boolean)) {
    throw new Error("usage: assemble-roebel-staging-release-set.mjs <promotion-revision> <web-oci-receipt> <mecky-oci-receipt> <web-evidence> <mecky-evidence> <previous-head> <output>");
  }
  const candidate = assembleRoebelStagingReleaseSet({
    promotionRevision,
    webReceipt: readJson(webReceiptPath),
    meckyReceipt: readJson(meckyReceiptPath),
    webEvidence: readJson(webEvidencePath),
    meckyEvidence: readJson(meckyEvidencePath),
    previousHead: readJson(previousHeadPath),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, canonicalJson(candidate));
  process.stdout.write(canonicalJson(candidate));
}
