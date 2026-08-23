#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const SECRET_ENV = /^(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY(?:_CARD)?|RESEND_API_KEY|SESSION_SECRET|THIRDWEB_CLIENT_ID)=/u;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const assertExactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label}_shape_invalid`);
};

export function verifyStagingWebOci(root, sourceRevision) {
  if (typeof root !== "string" || !SOURCE_REVISION.test(sourceRevision ?? "")) throw new Error("usage");
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const readBlob = (descriptor, label) => {
    if (!descriptor || !SHA256.test(descriptor.digest ?? "") || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1) throw new Error(`${label}_descriptor_invalid`);
    const bytes = readFileSync(join(root, "blobs", "sha256", descriptor.digest.slice(7)));
    if (bytes.length !== descriptor.size || digest(bytes) !== descriptor.digest) throw new Error(`${label}_blob_invalid`);
    return bytes;
  };

  assertExactKeys(readJson(join(root, "oci-layout")), ["imageLayoutVersion"], "layout");
  const index = readJson(join(root, "index.json"));
  if (index.schemaVersion !== 2 || !Array.isArray(index.manifests) || index.manifests.length !== 1) throw new Error("index_invalid");
  const descriptor = index.manifests[0];
  // ORAS can omit the optional descriptor platform when it copies one exact
  // manifest into an OCI layout. An explicit value must still be the target;
  // the image config below remains authoritative in both cases.
  const platform = descriptor.platform;
  if (
    descriptor.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
    (platform !== undefined && (platform === null || platform.os !== "linux" || platform.architecture !== "amd64"))
  ) throw new Error("platform_invalid");
  const repository = "stadtstack.local/roebel-web-preview/roebel-web-staging";
  const importName = `${repository}:source-${sourceRevision}`;
  if (descriptor.annotations?.["io.containerd.image.name"] !== importName) throw new Error("import_name_invalid");
  const manifest = JSON.parse(readBlob(descriptor, "manifest"));
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length < 1) throw new Error("manifest_invalid");
  const config = JSON.parse(readBlob(manifest.config, "config"));
  if (config.os !== "linux" || config.architecture !== "amd64") throw new Error("config_platform_invalid");

  const layerDigests = manifest.layers.map((layer, index) => {
    readBlob(layer, `layer_${index}`);
    return layer.digest;
  });
  const referenced = new Set([descriptor.digest.slice(7), manifest.config.digest.slice(7), ...layerDigests.map((value) => value.slice(7))]);
  const blobFiles = readdirSync(join(root, "blobs", "sha256")).sort();
  if (blobFiles.length !== referenced.size || blobFiles.some((file) => !referenced.has(file))) throw new Error("unreferenced_blob");

  const runtime = config.config ?? {};
  if (runtime.User !== "65532:65532") throw new Error("runtime_user_invalid");
  if (JSON.stringify(runtime.Entrypoint) !== JSON.stringify(["node"]) || JSON.stringify(runtime.Cmd) !== JSON.stringify(["apps/web/runtime-entrypoint.mjs"])) throw new Error("runtime_command_invalid");
  if (!runtime.ExposedPorts || Object.keys(runtime.ExposedPorts).join() !== "8080/tcp") throw new Error("runtime_port_invalid");
  const labels = runtime.Labels ?? {};
  if (labels["org.opencontainers.image.source"] !== "https://github.com/GiraeffleAeffle/Roebel-App" || labels["org.opencontainers.image.revision"] !== sourceRevision || labels["stadtstack.io/component"] !== "roebel-web-staging" || labels["stadtstack.io/environment"] !== "staging-synthetic-workflow" || labels["stadtstack.io/civic-authority"] !== "none") throw new Error("labels_invalid");
  const env = runtime.Env ?? [];
  for (const required of ["NODE_ENV=production", "PORT=8080", "HOSTNAME=0.0.0.0", "NEXT_PUBLIC_STADTSTACK_STAGING_LAB=1"]) if (!env.includes(required)) throw new Error(`runtime_env_missing:${required}`);
  if (env.some((entry) => SECRET_ENV.test(entry))) throw new Error("server_secret_embedded");

  return {
    schemaVersion: "roebel_staging_web_oci_receipt_v1",
    sourceRevision,
    importName,
    podReference: `${repository}@${descriptor.digest}`,
    manifestDigest: descriptor.digest,
    configDigest: manifest.config.digest,
    layerDigests,
    user: runtime.User,
    entrypoint: runtime.Entrypoint,
    cmd: runtime.Cmd,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, sourceRevision, outputPath] = process.argv.slice(2);
  const receipt = verifyStagingWebOci(root, sourceRevision);
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (outputPath) {
    writeFileSync(outputPath, bytes);
  }
  process.stdout.write(bytes);
}
