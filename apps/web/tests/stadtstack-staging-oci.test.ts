import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { verifyStagingWebOci } from "../../../scripts/verify-staging-web-oci.mjs";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const writeBlob = (root: string, value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value));
  const digest = sha256(bytes);
  writeFileSync(join(root, "blobs", "sha256", digest), bytes);
  return { digest: `sha256:${digest}`, size: bytes.length };
};

const writeValidLayout = (
  root: string,
  sourceRevision: string,
  mutate?: (config: Record<string, any>) => void,
  mutateDescriptor?: (descriptor: Record<string, any>) => void,
) => {
  mkdirSync(join(root, "blobs", "sha256"), { recursive: true });
  const layerBytes = Buffer.from("synthetic-layer");
  const layerDigest = sha256(layerBytes);
  writeFileSync(join(root, "blobs", "sha256", layerDigest), layerBytes);
  const configValue: Record<string, any> = {
    architecture: "amd64",
    os: "linux",
    config: {
      User: "65532:65532",
      Entrypoint: ["node"],
      Cmd: ["apps/web/runtime-entrypoint.mjs"],
      ExposedPorts: { "8080/tcp": {} },
      Env: [
        "NODE_ENV=production",
        "PORT=8080",
        "HOSTNAME=0.0.0.0",
        "NEXT_PUBLIC_STADTSTACK_STAGING_LAB=1",
      ],
      Labels: {
        "org.opencontainers.image.source": "https://github.com/GiraeffleAeffle/Roebel-App",
        "org.opencontainers.image.revision": sourceRevision,
        "stadtstack.io/component": "roebel-web-staging",
        "stadtstack.io/environment": "staging-synthetic-workflow",
        "stadtstack.io/civic-authority": "none",
      },
    },
    rootfs: { type: "layers", diff_ids: [`sha256:${layerDigest}`] },
  };
  mutate?.(configValue);
  const config = writeBlob(root, configValue);
  const manifest = writeBlob(root, {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
    layers: [{
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: `sha256:${layerDigest}`,
      size: layerBytes.length,
    }],
  });
  const importName = `stadtstack.local/roebel-web-preview/roebel-web-staging:source-${sourceRevision}`;
  writeFileSync(join(root, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  const descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    ...manifest,
    platform: { os: "linux", architecture: "amd64" },
    annotations: { "io.containerd.image.name": importName },
  };
  mutateDescriptor?.(descriptor);
  writeFileSync(join(root, "index.json"), JSON.stringify({
    schemaVersion: 2,
    manifests: [descriptor],
  }));
  return { config, importName, layerDigest, manifest };
};

test("accepts one source-bound non-root Röbel staging web image", () => {
  const sourceRevision = "a".repeat(40);
  const root = mkdtempSync(join(tmpdir(), "roebel-staging-oci-"));
  try {
    const { config, importName, layerDigest, manifest } = writeValidLayout(root, sourceRevision);

    assert.deepEqual(verifyStagingWebOci(root, sourceRevision), {
      schemaVersion: "roebel_staging_web_oci_receipt_v1",
      sourceRevision,
      importName,
      podReference: `stadtstack.local/roebel-web-preview/roebel-web-staging@${manifest.digest}`,
      manifestDigest: manifest.digest,
      configDigest: config.digest,
      layerDigests: [`sha256:${layerDigest}`],
      user: "65532:65532",
      entrypoint: ["node"],
      cmd: ["apps/web/runtime-entrypoint.mjs"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts an ORAS single-manifest layout without optional descriptor platform", () => {
  const sourceRevision = "a".repeat(40);
  const root = mkdtempSync(join(tmpdir(), "roebel-staging-oci-no-platform-"));
  try {
    writeValidLayout(root, sourceRevision, undefined, (descriptor) => {
      delete descriptor.platform;
    });
    assert.equal(verifyStagingWebOci(root, sourceRevision).sourceRevision, sourceRevision);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an explicitly wrong descriptor platform", () => {
  const sourceRevision = "a".repeat(40);
  const root = mkdtempSync(join(tmpdir(), "roebel-staging-oci-wrong-platform-"));
  try {
    writeValidLayout(root, sourceRevision, undefined, (descriptor) => {
      descriptor.platform = { os: "linux", architecture: "arm64" };
    });
    assert.throws(() => verifyStagingWebOci(root, sourceRevision), /platform_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a wrong config platform when the optional descriptor platform is absent", () => {
  const sourceRevision = "a".repeat(40);
  const root = mkdtempSync(join(tmpdir(), "roebel-staging-oci-wrong-config-platform-"));
  try {
    writeValidLayout(
      root,
      sourceRevision,
      (config) => { config.architecture = "arm64"; },
      (descriptor) => { delete descriptor.platform; },
    );
    assert.throws(() => verifyStagingWebOci(root, sourceRevision), /config_platform_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, mutate, error] of [
  ["root runtime", (config: Record<string, any>) => { config.config.User = "0:0"; }, /runtime_user_invalid/],
  ["embedded server secret", (config: Record<string, any>) => { config.config.Env.push("SESSION_SECRET=not-allowed"); }, /server_secret_embedded/],
  ["source drift", (config: Record<string, any>) => { config.config.Labels["org.opencontainers.image.revision"] = "b".repeat(40); }, /labels_invalid/],
] as const) {
  test(`rejects ${name}`, () => {
    const sourceRevision = "a".repeat(40);
    const root = mkdtempSync(join(tmpdir(), "roebel-staging-oci-negative-"));
    try {
      writeValidLayout(root, sourceRevision, mutate);
      assert.throws(() => verifyStagingWebOci(root, sourceRevision), error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
