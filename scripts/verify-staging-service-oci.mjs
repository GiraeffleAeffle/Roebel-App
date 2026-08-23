#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const SECRET_ENV = /^(?:MECKY_INFERENCE_API_KEY|HETZNER_INFERENCE_API_KEY|NODE_AGENT_SECRET|STADTSTACK_NOSTR_INGESTOR_TOKEN|CASE_STEWARD_TOKEN|CITIZEN_RELAY_ADMISSION_TOKEN|RELAY_ADMISSION_TOKEN|SYNTHETIC_CITIZENS_JSON)=/u;
const COMPONENTS = {
  "public-mecky": ["node", "/app/agent-watcher.cjs"],
  "roebel-e2e-workbench": ["node", "/app/e2e-workbench.cjs"],
  "roebel-staging-relay": ["node", "/app/staging-relay.cjs"],
};
const repositoryFor = (component) => `stadtstack.local/roebel-staging-lab/${component}`;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_shape_invalid`);
  }
}

export function verifyStagingServiceOci(root, sourceRevision, component) {
  const expectedEntrypoint = COMPONENTS[component];
  if (typeof root !== "string" || !SOURCE_REVISION.test(sourceRevision ?? "") || !expectedEntrypoint) {
    throw new Error("usage");
  }
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const readBlob = (descriptor, label) => {
    if (!descriptor || !SHA256.test(descriptor.digest ?? "") || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1) {
      throw new Error(`${label}_descriptor_invalid`);
    }
    const bytes = readFileSync(join(root, "blobs", "sha256", descriptor.digest.slice(7)));
    if (bytes.length !== descriptor.size || digest(bytes) !== descriptor.digest) throw new Error(`${label}_blob_invalid`);
    return bytes;
  };

  exactKeys(readJson(join(root, "oci-layout")), ["imageLayoutVersion"], "layout");
  const index = readJson(join(root, "index.json"));
  if (index.schemaVersion !== 2 || !Array.isArray(index.manifests) || index.manifests.length !== 1) throw new Error("index_invalid");
  const descriptor = index.manifests[0];
  // A direct single-manifest export from ORAS may omit the optional index
  // platform field. The config below remains authoritative for that case;
  // an explicitly supplied platform must still be the exact target.
  const platform = descriptor.platform;
  if (
    descriptor.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    (platform !== undefined && (platform === null || platform.os !== "linux" || platform.architecture !== "amd64"))
  ) throw new Error("platform_invalid");
  const importName = `${repositoryFor(component)}:source-${sourceRevision}`;
  const manifest = JSON.parse(readBlob(descriptor, "manifest"));
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length < 1) {
    throw new Error("manifest_invalid");
  }
  // BuildKit writes the checksum-bound local import name onto both the index
  // descriptor and the image manifest. ORAS preserves the manifest annotation
  // when it copies one immutable registry digest into a layout, but may omit
  // the optional descriptor annotation. Require at least one exact binding and
  // reject every explicit conflict.
  const importNames = [
    descriptor.annotations?.["io.containerd.image.name"],
    manifest.annotations?.["io.containerd.image.name"],
  ].filter((value) => value !== undefined);
  if (importNames.length === 0 || importNames.some((value) => value !== importName)) {
    throw new Error("import_name_invalid");
  }
  const config = JSON.parse(readBlob(manifest.config, "config"));
  if (config.os !== "linux" || config.architecture !== "amd64") throw new Error("config_platform_invalid");
  const layerDigests = manifest.layers.map((layer, indexValue) => {
    readBlob(layer, `layer_${indexValue}`);
    return layer.digest;
  });
  const referenced = new Set([
    descriptor.digest.slice(7),
    manifest.config.digest.slice(7),
    ...layerDigests.map((value) => value.slice(7)),
  ]);
  const blobFiles = readdirSync(join(root, "blobs", "sha256")).sort();
  if (blobFiles.length !== referenced.size || blobFiles.some((file) => !referenced.has(file))) throw new Error("unreferenced_blob");

  const runtime = config.config ?? {};
  if (runtime.User !== "65532:65532") throw new Error("runtime_user_invalid");
  if (JSON.stringify(runtime.Entrypoint) !== JSON.stringify(expectedEntrypoint)) throw new Error("runtime_entrypoint_invalid");
  const labels = runtime.Labels ?? {};
  if (
    labels["org.opencontainers.image.source"] !== "https://github.com/GiraeffleAeffle/Roebel-App" ||
    labels["org.opencontainers.image.revision"] !== sourceRevision ||
    labels["stadtstack.io/component"] !== component ||
    labels["stadtstack.io/civic-authority"] !== "none"
  ) throw new Error("labels_invalid");
  const env = runtime.Env ?? [];
  for (const required of ["NODE_ENV=production", "HOME=/tmp"]) if (!env.includes(required)) throw new Error(`runtime_env_missing:${required}`);
  if (env.some((entry) => SECRET_ENV.test(entry))) throw new Error("runtime_secret_embedded");

  return {
    schemaVersion: "roebel_staging_service_oci_receipt_v1",
    sourceRevision,
    component,
    importName,
    podReference: `${repositoryFor(component)}@${descriptor.digest}`,
    manifestDigest: descriptor.digest,
    configDigest: manifest.config.digest,
    layerDigests,
    user: runtime.User,
    entrypoint: runtime.Entrypoint,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, sourceRevision, component, outputPath] = process.argv.slice(2);
  const receipt = verifyStagingServiceOci(root, sourceRevision, component);
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, bytes);
  process.stdout.write(bytes);
}
