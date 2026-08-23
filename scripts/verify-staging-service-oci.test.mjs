import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { verifyStagingServiceOci } from "./verify-staging-service-oci.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function writeBlob(root, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const hash = sha256(bytes);
  writeFileSync(join(root, "blobs", "sha256", hash), bytes);
  return { digest: `sha256:${hash}`, size: bytes.length };
}

function writeLayout(root, sourceRevision, component, entrypoint, mutate) {
  mkdirSync(join(root, "blobs", "sha256"), { recursive: true });
  const layerBytes = Buffer.from("synthetic-service-layer");
  const layerHash = sha256(layerBytes);
  writeFileSync(join(root, "blobs", "sha256", layerHash), layerBytes);
  const configValue = {
    architecture: "amd64",
    os: "linux",
    config: {
      User: "65532:65532",
      Entrypoint: entrypoint,
      Env: ["NODE_ENV=production", "HOME=/tmp"],
      Labels: {
        "org.opencontainers.image.source": "https://github.com/GiraeffleAeffle/Roebel-App",
        "org.opencontainers.image.revision": sourceRevision,
        "stadtstack.io/component": component,
        "stadtstack.io/civic-authority": "none",
      },
    },
    rootfs: { type: "layers", diff_ids: [`sha256:${layerHash}`] },
  };
  mutate?.(configValue);
  const config = writeBlob(root, configValue);
  const manifest = writeBlob(root, {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
    layers: [{
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: `sha256:${layerHash}`,
      size: layerBytes.length,
    }],
  });
  const importName = `stadtstack.local/roebel-staging-lab/${component}:source-${sourceRevision}`;
  writeFileSync(join(root, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  writeFileSync(join(root, "index.json"), JSON.stringify({
    schemaVersion: 2,
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      ...manifest,
      platform: { os: "linux", architecture: "amd64" },
      annotations: { "io.containerd.image.name": importName },
    }],
  }));
  return { config, importName, manifest, layerHash };
}

for (const service of [
  { component: "public-mecky", entrypoint: ["node", "/app/agent-watcher.cjs"] },
  { component: "roebel-e2e-workbench", entrypoint: ["node", "/app/e2e-workbench.cjs"] },
  { component: "roebel-staging-relay", entrypoint: ["node", "/app/staging-relay.cjs"] },
]) {
  test(`accepts one exact ${service.component} linux/amd64 image`, () => {
    const root = mkdtempSync(join(tmpdir(), "roebel-service-oci-"));
    const revision = "a".repeat(40);
    try {
      const result = writeLayout(root, revision, service.component, service.entrypoint);
      assert.deepEqual(verifyStagingServiceOci(root, revision, service.component), {
        schemaVersion: "roebel_staging_service_oci_receipt_v1",
        sourceRevision: revision,
        component: service.component,
        importName: result.importName,
        podReference: `stadtstack.local/roebel-staging-lab/${service.component}@${result.manifest.digest}`,
        manifestDigest: result.manifest.digest,
        configDigest: result.config.digest,
        layerDigests: [`sha256:${result.layerHash}`],
        user: "65532:65532",
        entrypoint: service.entrypoint,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("rejects a credential embedded in a service image", () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-service-oci-negative-"));
  try {
    writeLayout(root, "a".repeat(40), "public-mecky", ["node", "/app/agent-watcher.cjs"], (config) => {
      config.config.Env.push("MECKY_INFERENCE_API_KEY=must-not-be-in-image");
    });
    assert.throws(
      () => verifyStagingServiceOci(root, "a".repeat(40), "public-mecky"),
      /runtime_secret_embedded/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts an ORAS single-manifest reuse layout with platform metadata omitted", () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-service-oci-reuse-"));
  const revision = "a".repeat(40);
  try {
    const result = writeLayout(root, revision, "public-mecky", ["node", "/app/agent-watcher.cjs"]);
    const indexPath = join(root, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    delete index.manifests[0].platform;
    writeFileSync(indexPath, JSON.stringify(index));

    const receipt = verifyStagingServiceOci(root, revision, "public-mecky");
    assert.equal(receipt.manifestDigest, result.manifest.digest);
    assert.equal(receipt.configDigest, result.config.digest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a Stadtstack control credential embedded in Public Mecky", () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-service-oci-control-negative-"));
  try {
    writeLayout(root, "a".repeat(40), "public-mecky", ["node", "/app/agent-watcher.cjs"], (config) => {
      config.config.Env.push("STADTSTACK_NOSTR_INGESTOR_TOKEN=must-not-be-in-image");
    });
    assert.throws(
      () => verifyStagingServiceOci(root, "a".repeat(40), "public-mecky"),
      /runtime_secret_embedded/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
