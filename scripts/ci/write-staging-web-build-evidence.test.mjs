import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  MAX_STAGING_WEB_OCI_LAYER_COUNT,
  verifyStagingWebOci,
} from "../verify-staging-web-oci.mjs";
import {
  prepareStagingWebOciAndEvidence,
  snapshotOciArchive,
  snapshotOciLayerBlob,
  validateOciOuterArchive,
  validateTarLayerStream,
  writeStagingWebBuildEvidence,
} from "./write-staging-web-build-evidence.mjs";
import {
  readStableBoundedFile,
  readStableFilePrefix,
} from "./read-stable-bounded-file.mjs";
import {
  MAX_DOCKER_TIMING_BYTES,
  writeStagingWebRuntimeTiming,
} from "./write-staging-web-runtime-timing.mjs";

const sourceRevision = "a".repeat(40);
const BASE_PHASES = {
  prune: [100, 120],
  offlineFetch: [121, 155],
  offlineMaterialization: [160, 180],
  nextCompile: [181, 210],
  runtimeAssembly: [211, 220],
  ociPackaging: [230, 250],
};
const STAGE_FILE_NAMES = {
  prune: "prune",
  offlineFetch: "offline_fetch",
  ociPackaging: "oci_packaging",
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function writeTarField(header, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  assert.ok(bytes.length <= length);
  bytes.copy(header, offset);
}

function tarOctal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function deterministicLayer(layerText) {
  const content = Buffer.from(layerText, "utf8");
  const header = Buffer.alloc(512);
  writeTarField(header, 0, 100, "fixture.txt");
  writeTarField(header, 100, 8, tarOctal(0o644, 8));
  writeTarField(header, 108, 8, tarOctal(0, 8));
  writeTarField(header, 116, 8, tarOctal(0, 8));
  writeTarField(header, 124, 12, tarOctal(content.length, 12));
  writeTarField(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  writeTarField(header, 156, 1, "0");
  writeTarField(header, 257, 6, "ustar\0");
  writeTarField(header, 263, 2, "00");
  writeTarField(header, 265, 32, "root\0");
  writeTarField(header, 297, 32, "root\0");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const contentPadding = Buffer.alloc((512 - (content.length % 512)) % 512);
  const tarBytes = Buffer.concat([header, content, contentPadding, Buffer.alloc(1024)]);
  const layerBytes = gzipSync(tarBytes, { level: 9, mtime: 0 });
  assert.equal(layerBytes.readUInt32LE(4), 0);
  return {
    expectedFileContent: layerText,
    layerBytes,
    layerDiffId: sha256(tarBytes),
    tarBytes,
  };
}

function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  let recordLength = body.length + 3;
  while (`${recordLength} ${body}`.length !== recordLength) {
    recordLength = `${recordLength} ${body}`.length;
  }
  return Buffer.from(`${recordLength} ${body}`, "utf8");
}

function metadataOnlyPaxLayer() {
  const content = paxRecord("comment", "buildkit-metadata-only");
  const header = Buffer.alloc(512);
  writeTarField(header, 0, 100, "pax_global_header");
  writeTarField(header, 100, 8, tarOctal(0o644, 8));
  writeTarField(header, 108, 8, tarOctal(0, 8));
  writeTarField(header, 116, 8, tarOctal(0, 8));
  writeTarField(header, 124, 12, tarOctal(content.length, 12));
  writeTarField(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  writeTarField(header, 156, 1, "g");
  writeTarField(header, 257, 6, "ustar\0");
  writeTarField(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  const tarBytes = Buffer.concat([header, content, padding, Buffer.alloc(1024)]);
  return {
    expectedFileContent: "",
    layerBytes: gzipSync(tarBytes, { level: 9, mtime: 0 }),
    layerDiffId: sha256(tarBytes),
    tarBytes,
  };
}

function largeListingLayer(entryCount = 12_000) {
  const archive = [];
  for (let index = 0; index < entryCount; index += 1) {
    const header = Buffer.alloc(512);
    const name = `entry-${index.toString().padStart(5, "0")}-${"x".repeat(80)}`;
    writeTarField(header, 0, 100, name);
    writeTarField(header, 100, 8, tarOctal(0o644, 8));
    writeTarField(header, 108, 8, tarOctal(0, 8));
    writeTarField(header, 116, 8, tarOctal(0, 8));
    writeTarField(header, 124, 12, tarOctal(0, 12));
    writeTarField(header, 136, 12, tarOctal(0, 12));
    header.fill(0x20, 148, 156);
    writeTarField(header, 156, 1, "0");
    writeTarField(header, 257, 6, "ustar\0");
    writeTarField(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    archive.push(header);
  }
  archive.push(Buffer.alloc(1024));
  const tarBytes = Buffer.concat(archive);
  return {
    expectedFileContent: "",
    layerBytes: gzipSync(tarBytes, { level: 9, mtime: 0 }),
    layerDiffId: sha256(tarBytes),
    tarBytes,
  };
}

function writeBlob(root, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const digest = sha256(bytes);
  writeFileSync(join(root, "blobs", "sha256", digest), bytes);
  return { digest: `sha256:${digest}`, size: bytes.length };
}

function writeLayoutWithLayer(root, layer) {
  mkdirSync(join(root, "blobs", "sha256"), { recursive: true });
  const { layerBytes, layerDiffId } = layer;
  const layerDigest = sha256(layerBytes);
  writeFileSync(join(root, "blobs", "sha256", layerDigest), layerBytes);
  const config = writeBlob(root, {
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
    rootfs: { type: "layers", diff_ids: [`sha256:${layerDiffId}`] },
  });
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
  writeFileSync(join(root, "index.json"), JSON.stringify({
    schemaVersion: 2,
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      ...manifest,
      platform: { os: "linux", architecture: "amd64" },
      annotations: { "io.containerd.image.name": importName },
    }],
  }));
  return { ...layer, layerDigest };
}

function writeValidLayout(root, layerText = "synthetic-layer") {
  return writeLayoutWithLayer(root, deterministicLayer(layerText));
}

function writeArchive(layoutRoot, archivePath, { includeRootDirectory = false } = {}) {
  const entries = includeRootDirectory ? [{ path: "./", type: "5", bytes: Buffer.alloc(0) }] : [];
  const visit = (directory, prefix = "") => {
    const children = readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      const absolutePath = join(directory, child.name);
      if (child.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "5", bytes: Buffer.alloc(0) });
        visit(absolutePath, relativePath);
      } else if (child.isFile()) {
        entries.push({ path: relativePath, type: "0", bytes: readFileSync(absolutePath) });
      } else {
        throw new Error(`fixture_entry_not_regular:${relativePath}`);
      }
    }
  };
  visit(layoutRoot);

  const archive = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeTarField(header, 0, 100, entry.path);
    writeTarField(header, 100, 8, tarOctal(entry.type === "5" ? 0o755 : 0o644, 8));
    writeTarField(header, 108, 8, tarOctal(0, 8));
    writeTarField(header, 116, 8, tarOctal(0, 8));
    writeTarField(header, 124, 12, tarOctal(entry.bytes.length, 12));
    writeTarField(header, 136, 12, tarOctal(0, 12));
    header.fill(0x20, 148, 156);
    writeTarField(header, 156, 1, entry.type);
    writeTarField(header, 257, 6, "ustar\0");
    writeTarField(header, 263, 2, "00");
    writeTarField(header, 265, 32, "root\0");
    writeTarField(header, 297, 32, "root\0");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    archive.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding > 0) archive.push(Buffer.alloc(padding));
  }
  archive.push(Buffer.alloc(1024));
  writeFileSync(archivePath, Buffer.concat(archive));
}

function writeOuterArchiveEntries(archivePath, entries) {
  const archive = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    const declaredSize = entry.declaredSize ?? bytes.length;
    const header = Buffer.alloc(512);
    writeTarField(header, 0, 100, entry.path);
    writeTarField(header, 100, 8, tarOctal(entry.type === "5" ? 0o755 : 0o644, 8));
    writeTarField(header, 108, 8, tarOctal(0, 8));
    writeTarField(header, 116, 8, tarOctal(0, 8));
    writeTarField(header, 124, 12, tarOctal(declaredSize, 12));
    writeTarField(header, 136, 12, tarOctal(0, 12));
    header.fill(0x20, 148, 156);
    writeTarField(header, 156, 1, entry.type ?? "0");
    if (entry.linkName) writeTarField(header, 157, 100, entry.linkName);
    writeTarField(header, 257, 6, "ustar\0");
    writeTarField(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    archive.push(header, bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) archive.push(Buffer.alloc(padding));
  }
  archive.push(Buffer.alloc(1024));
  writeFileSync(archivePath, Buffer.concat(archive));
}

function writeSparseOuterArchive(archivePath) {
  const header = Buffer.alloc(512);
  writeTarField(header, 0, 100, `blobs/sha256/${"f".repeat(64)}`);
  writeTarField(header, 100, 8, tarOctal(0o644, 8));
  writeTarField(header, 108, 8, tarOctal(0, 8));
  writeTarField(header, 116, 8, tarOctal(0, 8));
  writeTarField(header, 124, 12, tarOctal(0, 12));
  writeTarField(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  // GNU tar's sparse-member type. It is intentionally rejected before extraction.
  writeTarField(header, 156, 1, "S");
  writeTarField(header, 257, 6, "ustar\0");
  writeTarField(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  writeFileSync(archivePath, Buffer.concat([header, Buffer.alloc(1024)]));
}

function stageTimingRows(overrides = {}) {
  const phases = { ...BASE_PHASES, ...overrides };
  return Object.entries(STAGE_FILE_NAMES)
    .map(([phase, fileName]) => `${fileName}\t${phases[phase][0]}\t${phases[phase][1]}`)
    .join("\n") + "\n";
}

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "roebel-web-build-evidence-"));
  try {
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root, appPaths, layer = deterministicLayer("synthetic-layer")) {
  const dockerTimingPath = join(root, "docker-timing.json");
  const runtimeTimingPath = join(root, "runtime-timing.json");
  const stageTimingsPath = join(root, "stages.tsv");
  const appPathsManifestPath = join(root, "app-paths-manifest.json");
  const canonicalRouteManifestOutputPath = join(root, "canonical-route-manifest.json");
  const ociLayoutPath = join(root, "oci-layout-source");
  const ociArchivePath = join(root, "roebel-web-staging.oci.tar");
  const ociArchiveChecksumPath = join(root, "roebel-web-staging.oci.tar.sha256");
  const ociReceiptPath = join(root, "roebel-web-staging.receipt.json");

  writeFileSync(dockerTimingPath, JSON.stringify({
    schemaVersion: "roebel_staging_web_docker_timing_v1",
    offlineMaterializationStartedAtMs: BASE_PHASES.offlineMaterialization[0],
    offlineMaterializationFinishedAtMs: BASE_PHASES.offlineMaterialization[1],
    nextCompileStartedAtMs: BASE_PHASES.nextCompile[0],
    nextCompileFinishedAtMs: BASE_PHASES.nextCompile[1],
  }));
  writeStagingWebRuntimeTiming({
    sourceRevision,
    dockerTimingPath,
    outputPath: runtimeTimingPath,
    runtimeAssemblyStartedAtMs: BASE_PHASES.runtimeAssembly[0],
    runtimeAssemblyFinishedAtMs: BASE_PHASES.runtimeAssembly[1],
  });
  writeFileSync(stageTimingsPath, stageTimingRows());
  writeFileSync(appPathsManifestPath, JSON.stringify(appPaths));

  const writtenLayer = writeLayoutWithLayer(ociLayoutPath, layer);
  writeArchive(ociLayoutPath, ociArchivePath);
  const archiveSha256 = sha256(readFileSync(ociArchivePath));
  writeFileSync(ociArchiveChecksumPath, `${archiveSha256}  ${ociArchivePath}\n`);
  writeFileSync(
    ociReceiptPath,
    `${JSON.stringify(verifyStagingWebOci(ociLayoutPath, sourceRevision), null, 2)}\n`,
  );
  return {
    dockerTimingPath,
    runtimeTimingPath,
    stageTimingsPath,
    appPathsManifestPath,
    canonicalRouteManifestOutputPath,
    ociLayoutPath,
    ociArchivePath,
    ociArchiveChecksumPath,
    ociReceiptPath,
    writtenLayer,
  };
}

function evidenceInput(root, fixture, outputName = "evidence.json") {
  return {
    sourceRevision,
    dockerTimingPath: fixture.dockerTimingPath,
    runtimeTimingPath: fixture.runtimeTimingPath,
    stageTimingsPath: fixture.stageTimingsPath,
    appPathsManifestPath: fixture.appPathsManifestPath,
    canonicalRouteManifestOutputPath: fixture.canonicalRouteManifestOutputPath,
    ociLayoutPath: fixture.ociLayoutPath,
    ociArchivePath: fixture.ociArchivePath,
    ociArchiveChecksumPath: fixture.ociArchiveChecksumPath,
    ociReceiptPath: fixture.ociReceiptPath,
    outputPath: join(root, outputName),
    pipelineStartedAtMs: 90,
    pipelineFinishedAtMs: 260,
    maxRouteManifestBytes: 1024,
    maxEvidenceBytes: 4096,
  };
}

function prepareInput(root, fixture, overrides = {}) {
  return {
    sourceRevision,
    runtimeTimingPath: fixture.runtimeTimingPath,
    stageTimingsPath: fixture.stageTimingsPath,
    appPathsManifestPath: fixture.appPathsManifestPath,
    canonicalRouteManifestOutputPath: fixture.canonicalRouteManifestOutputPath,
    ociArchiveInputPath: fixture.ociArchivePath,
    ociArchiveOutputPath: join(root, "prepared-roebel-web-staging.oci.tar"),
    ociArchiveChecksumOutputPath: join(root, "prepared-roebel-web-staging.oci.tar.sha256"),
    ociReceiptOutputPath: join(root, "prepared-roebel-web-staging.receipt.json"),
    outputPath: join(root, "prepared-evidence.json"),
    pipelineStartedAtMs: 90,
    pipelineFinishedAtMs: 260,
    maxRouteManifestBytes: 1024,
    maxEvidenceBytes: 4096,
    ...overrides,
  };
}

const evidenceModuleUrl = new URL("./write-staging-web-build-evidence.mjs", import.meta.url).href;
const runtimeTimingModuleUrl = new URL("./write-staging-web-runtime-timing.mjs", import.meta.url).href;

function runEvidenceInChild(input) {
  const source = `
    import { writeStagingWebBuildEvidence } from ${JSON.stringify(evidenceModuleUrl)};
    try {
      await writeStagingWebBuildEvidence(${JSON.stringify(input)});
      process.exit(0);
    } catch (error) {
      process.stderr.write(error?.message ?? String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 2_000,
  });
}

function runRuntimeTimingInChild(input) {
  const source = `
    import { writeStagingWebRuntimeTiming } from ${JSON.stringify(runtimeTimingModuleUrl)};
    try {
      writeStagingWebRuntimeTiming(${JSON.stringify(input)});
      process.exit(0);
    } catch (error) {
      process.stderr.write(error?.message ?? String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 2_000,
  });
}

function assertChildRejectedWithoutTimeout(child, expectedMessage) {
  assert.notEqual(child.error?.code, "ETIMEDOUT", "validation child must not hang");
  assert.notEqual(child.status, 0, child.stderr);
  if (expectedMessage) assert.match(child.stderr, expectedMessage);
}

function makeFifo(path) {
  const result = spawnSync("mkfifo", [path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("stable bounded readers reject regular-file replacement and FIFO swaps", async () => {
  await withFixture(async (root) => {
    const path = join(root, "stable-input");
    const replacement = join(root, "replacement");
    writeFileSync(path, "first");
    writeFileSync(replacement, "other");
    assert.throws(
      () => readStableBoundedFile(path, 64, "stable_input", () => renameSync(replacement, path)),
      /stable_input_changed/u,
    );

    rmSync(path);
    writeFileSync(path, "first");
    assert.throws(
      () => readStableFilePrefix(path, 4, "stable_prefix", () => {
        rmSync(path);
        makeFifo(path);
      }),
      /stable_prefix_(?:changed|not_regular_file)/u,
    );
  });
});

test("the shared 64-layer gate rejects direct and deferred verification before blob open", async () => {
  await withFixture(async (root) => {
    const layoutRoot = join(root, "layer-count-layout");
    writeValidLayout(layoutRoot);
    const indexPath = join(layoutRoot, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const originalManifestPath = join(
      layoutRoot,
      "blobs",
      "sha256",
      index.manifests[0].digest.slice(7),
    );
    const manifest = JSON.parse(readFileSync(originalManifestPath, "utf8"));
    const missingDescriptor = {
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: `sha256:${"f".repeat(64)}`,
      size: 1,
    };
    manifest.layers = Array.from(
      { length: MAX_STAGING_WEB_OCI_LAYER_COUNT + 1 },
      () => ({ ...missingDescriptor }),
    );
    const replacementManifest = writeBlob(layoutRoot, manifest);
    index.manifests[0].digest = replacementManifest.digest;
    index.manifests[0].size = replacementManifest.size;
    writeFileSync(indexPath, JSON.stringify(index));

    for (const deferLayerBlobValidation of [false, true]) {
      assert.throws(
        () => verifyStagingWebOci(layoutRoot, sourceRevision, { deferLayerBlobValidation }),
        /layer_count_invalid/u,
      );
    }
  });
});

function runtimeTimingInput(root, dockerTimingPath) {
  return {
    sourceRevision,
    dockerTimingPath,
    outputPath: join(root, "runtime-timing-output.json"),
    runtimeAssemblyStartedAtMs: BASE_PHASES.runtimeAssembly[0],
    runtimeAssemblyFinishedAtMs: BASE_PHASES.runtimeAssembly[1],
  };
}

function mutateRuntimePhase(runtimeTimingPath, phase, [startedAtMs, finishedAtMs]) {
  const runtime = JSON.parse(readFileSync(runtimeTimingPath, "utf8"));
  runtime.phases[phase] = { startedAtMs, finishedAtMs };
  writeFileSync(runtimeTimingPath, JSON.stringify(runtime));
}

test("writes aggregate route, archive-correlated OCI and absolute timing evidence", async () => {
  await withFixture(async (root) => {
    const privateRoute = "/api/[caseId]/route";
    const fixture = writeFixture(root, {
      "/page": "app/page.js",
      [privateRoute]: "app/api/[caseId]/route.js",
    });
    const evidence = await writeStagingWebBuildEvidence(evidenceInput(root, fixture));
    assert.equal(evidence.artifactClass, "aggregate_measurement_evidence");
    assert.deepEqual(evidence.timings.pipeline, {
      startedAtMs: 90,
      finishedAtMs: 260,
      durationMs: 170,
    });
    assert.equal(evidence.timings.attributedDurationMs, 132);
    assert.equal(evidence.timings.unattributedDurationMs, 38);
    for (const [name, [startedAtMs, finishedAtMs]] of Object.entries(BASE_PHASES)) {
      assert.deepEqual(evidence.timings.phases[name], {
        startedAtMs,
        finishedAtMs,
        durationMs: finishedAtMs - startedAtMs,
      });
    }
    assert.deepEqual(
      {
        routeCount: evidence.routeInventory.routeCount,
        pageCount: evidence.routeInventory.pageCount,
        routeHandlerCount: evidence.routeInventory.routeHandlerCount,
        otherCount: evidence.routeInventory.otherCount,
      },
      { routeCount: 2, pageCount: 1, routeHandlerCount: 1, otherCount: 0 },
    );
    assert.match(evidence.routeInventory.canonicalManifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(readFileSync(fixture.canonicalRouteManifestOutputPath, "utf8").includes(privateRoute));
    assert.ok(!JSON.stringify(evidence).includes(privateRoute));
    assert.equal(Object.hasOwn(evidence.verifiedOci, "importName"), false);
    assert.ok(!JSON.stringify(evidence).includes("stadtstack.local"));
    assert.match(evidence.verifiedOci.archiveDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(evidence.verifiedOci.receiptDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(evidence.verifiedOci.configDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(evidence.verifiedOci.layerDigests.length, 1);
    const repeatArchivePath = join(root, "repeat.oci.tar");
    writeArchive(fixture.ociLayoutPath, repeatArchivePath);
    assert.equal(
      sha256(readFileSync(fixture.ociArchivePath)),
      sha256(readFileSync(repeatArchivePath)),
    );
    assert.deepEqual(
      fixture.writtenLayer.layerBytes,
      deterministicLayer(fixture.writtenLayer.expectedFileContent).layerBytes,
    );
    const extractedLayerRoot = join(root, "extracted-layer");
    mkdirSync(extractedLayerRoot);
    const extracted = spawnSync(
      "tar",
      [
        "-xzf",
        join(fixture.ociLayoutPath, "blobs", "sha256", fixture.writtenLayer.layerDigest),
        "-C",
        extractedLayerRoot,
      ],
      { encoding: "utf8" },
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(
      readFileSync(join(extractedLayerRoot, "fixture.txt"), "utf8"),
      fixture.writtenLayer.expectedFileContent,
    );
    assert.deepEqual(JSON.parse(readFileSync(join(root, "evidence.json"), "utf8")), evidence);
  });
});

test("prepare mode binds extraction, receipt, evidence and upload path to one snapshot inode", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const replacement = join(root, "invalid-source-replacement.tar");
    writeOuterArchiveEntries(replacement, [{ path: "../escape", type: "0" }]);
    let snapshotIdentity;
    let extractionIdentity;
    const input = prepareInput(root, fixture, {
      afterSnapshotForTest(snapshotPath) {
        snapshotIdentity = statSync(snapshotPath);
        renameSync(replacement, fixture.ociArchivePath);
      },
      beforeExtractionForTest(snapshotPath) {
        extractionIdentity = statSync(snapshotPath);
      },
    });

    const evidence = await prepareStagingWebOciAndEvidence(input);
    const exposedIdentity = statSync(input.ociArchiveOutputPath);
    assert.equal(extractionIdentity.dev, snapshotIdentity.dev);
    assert.equal(extractionIdentity.ino, snapshotIdentity.ino);
    assert.equal(exposedIdentity.dev, snapshotIdentity.dev);
    assert.equal(exposedIdentity.ino, snapshotIdentity.ino);
    const exposedDigest = sha256(readFileSync(input.ociArchiveOutputPath));
    assert.equal(evidence.verifiedOci.archiveDigest, `sha256:${exposedDigest}`);
    assert.equal(
      readFileSync(input.ociArchiveChecksumOutputPath, "utf8"),
      `${exposedDigest}  ${input.ociArchiveOutputPath}\n`,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(input.ociReceiptOutputPath, "utf8")).layerDigests,
      evidence.verifiedOci.layerDigests,
    );
  });
});

test("prepare mode rejects replacement and in-place mutation after snapshot digest creation", async () => {
  for (const mutation of ["replacement", "in-place"]) {
    await withFixture(async (root) => {
      const fixture = writeFixture(root, { "/page": "app/page.js" });
      const replacementLayout = join(root, `${mutation}-layout`);
      writeValidLayout(replacementLayout, `${mutation}-layer`);
      const replacementArchive = join(root, `${mutation}-archive.tar`);
      writeArchive(replacementLayout, replacementArchive);
      let extractionAttempted = false;
      const input = prepareInput(root, fixture, {
        afterSnapshotForTest(snapshotPath) {
          if (mutation === "replacement") {
            renameSync(replacementArchive, snapshotPath);
            return;
          }
          chmodSync(snapshotPath, 0o600);
          writeFileSync(snapshotPath, readFileSync(replacementArchive));
        },
        beforeExtractionForTest() {
          extractionAttempted = true;
        },
      });

      await assert.rejects(
        prepareStagingWebOciAndEvidence(input),
        /oci_archive_snapshot_changed/u,
        mutation,
      );
      assert.equal(extractionAttempted, false, `${mutation} reached extraction`);
      assert.throws(() => statSync(input.ociArchiveOutputPath), /ENOENT/u);
      assert.throws(() => statSync(input.ociArchiveChecksumOutputPath), /ENOENT/u);
      assert.throws(() => statSync(input.ociReceiptOutputPath), /ENOENT/u);
      assert.throws(() => statSync(input.outputPath), /ENOENT/u);
    });
  }
});

test("prepare mode rejects every unsafe outer member before extraction", async () => {
  const cases = [
    ["traversal", (path) => writeOuterArchiveEntries(path, [{ path: "../escape", type: "0" }])],
    ["symlink", (path) => writeOuterArchiveEntries(path, [{ path: "index.json", type: "2", linkName: "/etc/passwd" }])],
    ["hardlink", (path) => writeOuterArchiveEntries(path, [{ path: "index.json", type: "1", linkName: "oci-layout" }])],
    ["pax", (path) => writeOuterArchiveEntries(path, [{ path: "pax-header", type: "x", bytes: paxRecord("path", "index.json") }])],
    ["sparse", (path) => writeSparseOuterArchive(path)],
    ["duplicate", (path) => writeOuterArchiveEntries(path, [
      { path: "index.json", type: "0", bytes: Buffer.from("{}") },
      { path: "index.json", type: "0", bytes: Buffer.from("{}") },
    ])],
    ["oversized-member", (path) => writeOuterArchiveEntries(path, [{
      path: "index.json",
      type: "0",
      declaredSize: 1_048_577,
    }])],
    ["excessive-member-count", (path) => writeOuterArchiveEntries(
      path,
      Array.from({ length: 4_097 }, (_, index) => ({
        path: `blobs/sha256/${index.toString(16).padStart(64, "0")}`,
        type: "0",
      })),
    )],
  ];

  for (const [name, writeInvalidArchive] of cases) {
    await withFixture(async (root) => {
      const fixture = writeFixture(root, { "/page": "app/page.js" });
      writeInvalidArchive(fixture.ociArchivePath);
      let extractionAttempted = false;
      const input = prepareInput(root, fixture, {
        beforeExtractionForTest() {
          extractionAttempted = true;
        },
      });
      await assert.rejects(
        prepareStagingWebOciAndEvidence(input),
        /oci_archive_members_invalid/u,
        name,
      );
      assert.equal(extractionAttempted, false, `${name} reached extraction`);
      assert.throws(() => statSync(input.ociArchiveOutputPath), /ENOENT/u);
    });
  }
});

test("prepare mode rejects aggregate outer payload work before extraction", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    let extractionAttempted = false;
    const input = prepareInput(root, fixture, {
      outerArchiveValidationLimitsForTest: { aggregateMemberBytes: 1 },
      beforeExtractionForTest() {
        extractionAttempted = true;
      },
    });
    await assert.rejects(
      prepareStagingWebOciAndEvidence(input),
      /oci_archive_members_invalid/u,
    );
    assert.equal(extractionAttempted, false);
  });
});

test("prepare mode accepts the standard OCI root-directory member", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeArchive(fixture.ociLayoutPath, fixture.ociArchivePath, { includeRootDirectory: true });
    assert.equal(await validateOciOuterArchive(fixture.ociArchivePath), true);
    const input = prepareInput(root, fixture);
    const evidence = await prepareStagingWebOciAndEvidence(input);
    assert.equal(evidence.verifiedOci.layerDigests.length, 1);
    assert.equal(await validateOciOuterArchive(input.ociArchiveOutputPath), true);
  });
});

test("rejects unsafe or malformed generated route manifests", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/api/token=secret/route": "app/api/token=secret/route.js" });
    await assert.rejects(writeStagingWebBuildEvidence(evidenceInput(root, fixture)), /route_path_invalid/u);
  });
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.appPathsManifestPath, "not-json");
    await assert.rejects(writeStagingWebBuildEvidence(evidenceInput(root, fixture)), /route_manifest_invalid/u);
  });
});

test("rejects symlink, FIFO and oversized route manifests without reading them", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const target = join(root, "route-target.json");
    writeFileSync(target, JSON.stringify({ "/page": "app/page.js" }));
    rmSync(fixture.appPathsManifestPath);
    symlinkSync(target, fixture.appPathsManifestPath);
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "route-symlink.json")),
      /route_manifest_not_regular_file/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    rmSync(fixture.appPathsManifestPath);
    makeFifo(fixture.appPathsManifestPath);
    const child = runEvidenceInChild(evidenceInput(root, fixture, "route-fifo.json"));
    assertChildRejectedWithoutTimeout(child, /route_manifest_not_regular_file/u);
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.appPathsManifestPath, Buffer.alloc(1025, 0x20));
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "route-oversized.json")),
      /route_manifest_too_large/u,
    );
  });
});

test("rejects symlink, FIFO and oversized builder timing files without reading them", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const target = join(root, "docker-timing-target.json");
    writeFileSync(target, readFileSync(fixture.dockerTimingPath));
    rmSync(fixture.dockerTimingPath);
    symlinkSync(target, fixture.dockerTimingPath);
    assert.throws(
      () => writeStagingWebRuntimeTiming(runtimeTimingInput(root, fixture.dockerTimingPath)),
      /docker_timing_not_regular_file/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    rmSync(fixture.dockerTimingPath);
    makeFifo(fixture.dockerTimingPath);
    const child = runRuntimeTimingInChild(runtimeTimingInput(root, fixture.dockerTimingPath));
    assertChildRejectedWithoutTimeout(child, /docker_timing_not_regular_file/u);
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.dockerTimingPath, Buffer.alloc(MAX_DOCKER_TIMING_BYTES + 1, 0x20));
    assert.throws(
      () => writeStagingWebRuntimeTiming(runtimeTimingInput(root, fixture.dockerTimingPath)),
      /docker_timing_too_large/u,
    );
  });
});

test("rejects malformed timing evidence", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.stageTimingsPath, "prune\tnot-a-number\t120\noffline_fetch\t121\t155\noci_packaging\t230\t250\n");
    await assert.rejects(writeStagingWebBuildEvidence(evidenceInput(root, fixture)), /prune_started_at_ms_invalid/u);
  });
});

test("rejects oversized timing, checksum and receipt inputs before allocation", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.stageTimingsPath, Buffer.alloc(65_537, 0x20));
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "stage-too-large.json")),
      /stage_timings_too_large/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.ociArchiveChecksumPath, Buffer.alloc(513, 0x20));
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "checksum-too-large.json")),
      /oci_archive_checksum_too_large/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.ociReceiptPath, Buffer.alloc(65_537, 0x20));
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "receipt-too-large.json")),
      /oci_receipt_too_large/u,
    );
  });
});

test("rejects a large unattributed pipeline gap", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    await assert.rejects(
      writeStagingWebBuildEvidence({
        ...evidenceInput(root, fixture, "unattributed-gap.json"),
        pipelineFinishedAtMs: 200_000,
      }),
      /timing_unattributed_duration_exceeds_limit/u,
    );
  });
});

test("rejects start/end bound mutations for every timing phase", async () => {
  for (const phase of Object.keys(BASE_PHASES)) {
    for (const [boundary, intervalValue] of [
      ["early-start", [89, BASE_PHASES[phase][1]]],
      ["late-finish", [BASE_PHASES[phase][0], 261]],
    ]) {
      await withFixture(async (root) => {
        const fixture = writeFixture(root, { "/page": "app/page.js" });
        if (Object.hasOwn(STAGE_FILE_NAMES, phase)) {
          writeFileSync(fixture.stageTimingsPath, stageTimingRows({ [phase]: intervalValue }));
        } else {
          mutateRuntimePhase(fixture.runtimeTimingPath, phase, intervalValue);
        }
        await assert.rejects(
          writeStagingWebBuildEvidence(evidenceInput(root, fixture, `${phase}-${boundary}.json`)),
          new RegExp(`${phase}_outside_pipeline_bounds`, "u"),
        );
      });
    }
  }
});

test("rejects an overlap mutation at every phase boundary", async () => {
  const phases = Object.keys(BASE_PHASES);
  for (let index = 1; index < phases.length; index += 1) {
    const phase = phases[index];
    const previousPhase = phases[index - 1];
    const intervalValue = [BASE_PHASES[previousPhase][1] - 1, BASE_PHASES[phase][1]];
    await withFixture(async (root) => {
      const fixture = writeFixture(root, { "/page": "app/page.js" });
      if (Object.hasOwn(STAGE_FILE_NAMES, phase)) {
        writeFileSync(fixture.stageTimingsPath, stageTimingRows({ [phase]: intervalValue }));
      } else {
        mutateRuntimePhase(fixture.runtimeTimingPath, phase, intervalValue);
      }
      await assert.rejects(
        writeStagingWebBuildEvidence(evidenceInput(root, fixture, `${phase}-overlap.json`)),
        new RegExp(`${phase}_overlaps_previous_phase`, "u"),
      );
    });
  }
});

test("rejects checksum, receipt and archive/layout correlation drift", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeFileSync(fixture.ociArchiveChecksumPath, `${"0".repeat(64)}  ${fixture.ociArchivePath}\n`);
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture)),
      /oci_archive_checksum_mismatch/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const receipt = JSON.parse(readFileSync(fixture.ociReceiptPath, "utf8"));
    receipt.manifestDigest = `sha256:${"e".repeat(64)}`;
    writeFileSync(fixture.ociReceiptPath, JSON.stringify(receipt));
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture)),
      /oci_receipt_archive_mismatch/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const replacementLayout = join(root, "replacement-layout");
    writeValidLayout(replacementLayout, "different-layer");
    writeArchive(replacementLayout, fixture.ociArchivePath);
    const replacementSha256 = sha256(readFileSync(fixture.ociArchivePath));
    writeFileSync(
      fixture.ociArchiveChecksumPath,
      `${replacementSha256}  ${fixture.ociArchivePath}\n`,
    );
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture)),
      /oci_receipt_archive_mismatch/u,
    );
  });
});

test("snapshots one bounded regular OCI archive and rejects path races", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const replacement = join(root, "replacement-archive");
    writeFileSync(replacement, readFileSync(fixture.ociArchivePath));
    assert.throws(
      () => snapshotOciArchive(fixture.ociArchivePath, () => {
        renameSync(replacement, fixture.ociArchivePath);
      }),
      /oci_archive_changed/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    assert.throws(
      () => snapshotOciArchive(fixture.ociArchivePath, () => {
        rmSync(fixture.ociArchivePath);
        makeFifo(fixture.ociArchivePath);
      }),
      /oci_archive_(?:changed|not_regular_file)/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    truncateSync(fixture.ociArchivePath, 167_772_161);
    assert.throws(() => snapshotOciArchive(fixture.ociArchivePath), /oci_archive_too_large/u);
  });
});

test("binds each layer's prefix and stream to one regular, unchanged snapshot", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const blobPath = join(fixture.ociLayoutPath, "blobs", "sha256", fixture.writtenLayer.layerDigest);
    const replacement = join(root, "layer-replacement");
    writeFileSync(replacement, readFileSync(blobPath));
    const descriptor = {
      digest: `sha256:${fixture.writtenLayer.layerDigest}`,
      size: fixture.writtenLayer.layerBytes.length,
    };
    assert.throws(
      () => snapshotOciLayerBlob({
        blobPath,
        descriptor,
        index: 0,
        beforeOpenForTest: () => renameSync(replacement, blobPath),
      }),
      /oci_layer_blob_0_changed/u,
    );
  });

  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const blobPath = join(fixture.ociLayoutPath, "blobs", "sha256", fixture.writtenLayer.layerDigest);
    const descriptor = {
      digest: `sha256:${fixture.writtenLayer.layerDigest}`,
      size: fixture.writtenLayer.layerBytes.length,
    };
    assert.throws(
      () => snapshotOciLayerBlob({
        blobPath,
        descriptor,
        index: 0,
        beforeOpenForTest: () => {
          rmSync(blobPath);
          makeFifo(blobPath);
        },
      }),
      /oci_layer_blob_0_(?:changed|not_regular_file)/u,
    );
  });
});

test("rejects a GNU sparse outer archive member before extraction", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeSparseOuterArchive(fixture.ociArchivePath);
    const archiveSha256 = sha256(readFileSync(fixture.ociArchivePath));
    writeFileSync(
      fixture.ociArchiveChecksumPath,
      `${archiveSha256}  ${fixture.ociArchivePath}\n`,
    );
    await assert.rejects(
      writeStagingWebBuildEvidence(evidenceInput(root, fixture, "sparse-outer.json")),
      /oci_archive_members_invalid/u,
    );
  });
});

test("accepts a standard OCI tar that includes its root directory member", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    writeArchive(fixture.ociLayoutPath, fixture.ociArchivePath, { includeRootDirectory: true });
    const archiveSha256 = sha256(readFileSync(fixture.ociArchivePath));
    writeFileSync(
      fixture.ociArchiveChecksumPath,
      `${archiveSha256}  ${fixture.ociArchivePath}\n`,
    );
    const evidence = await writeStagingWebBuildEvidence(
      evidenceInput(root, fixture, "root-member-evidence.json"),
    );
    assert.equal(evidence.verifiedOci.layerDigests.length, 1);
  });
});

test("rejects corrupted gzip and tar layer payloads", async () => {
  const valid = deterministicLayer("valid-layer-before-corruption");
  const invalidTar = Buffer.from("this is not a tar archive", "utf8");
  const invalidLayers = [
    {
      ...valid,
      layerBytes: Buffer.from(valid.layerBytes.subarray(0, valid.layerBytes.length - 8)),
    },
    {
      expectedFileContent: "",
      layerBytes: gzipSync(invalidTar, { level: 9, mtime: 0 }),
      layerDiffId: sha256(invalidTar),
      tarBytes: invalidTar,
    },
  ];

  for (const [index, layer] of invalidLayers.entries()) {
    await withFixture(async (root) => {
      const fixture = writeFixture(root, { "/page": "app/page.js" }, layer);
      await assert.rejects(
        writeStagingWebBuildEvidence(evidenceInput(root, fixture, `invalid-layer-${index}.json`)),
        /oci_layer_archive_invalid:0/u,
      );
    });
  }
});

test("the streaming layer parser enforces its expanded-byte cap", async () => {
  await withFixture(async (root) => {
    const fixture = writeFixture(root, { "/page": "app/page.js" });
    const blobPath = join(
      fixture.ociLayoutPath,
      "blobs",
      "sha256",
      fixture.writtenLayer.layerDigest,
    );
    assert.equal(await validateTarLayerStream(blobPath, true, 1024), false);
  });
});

test("the streaming parser rejects aggregate expansion and header work across layers", async () => {
  await withFixture(async (root) => {
    const first = deterministicLayer("first-layer");
    const second = deterministicLayer("second-layer");
    const firstPath = join(root, "first.layer.gz");
    const secondPath = join(root, "second.layer.gz");
    writeFileSync(firstPath, first.layerBytes);
    writeFileSync(secondPath, second.layerBytes);

    const expansionBudget = {
      expandedBytes: 0,
      headerCount: 0,
      maxExpandedBytes: first.tarBytes.length + second.tarBytes.length - 1,
      maxHeaderCount: 4,
    };
    assert.equal(await validateTarLayerStream(firstPath, true, 4096, expansionBudget), true);
    assert.equal(await validateTarLayerStream(secondPath, true, 4096, expansionBudget), false);

    const headerBudget = {
      expandedBytes: 0,
      headerCount: 0,
      maxExpandedBytes: 4096,
      maxHeaderCount: 1,
    };
    assert.equal(await validateTarLayerStream(firstPath, true, 4096, headerBudget), true);
    assert.equal(await validateTarLayerStream(secondPath, true, 4096, headerBudget), false);
  });
});

test("accepts tar-valid empty, metadata-only and large-listing layers without digest pinning", async () => {
  const emptyTar = Buffer.alloc(1024);
  const layers = [
    {
      expectedFileContent: "",
      layerBytes: gzipSync(emptyTar, { level: 9, mtime: 0 }),
      layerDiffId: sha256(emptyTar),
      tarBytes: emptyTar,
    },
    metadataOnlyPaxLayer(),
    largeListingLayer(),
  ];

  for (const [index, layer] of layers.entries()) {
    await withFixture(async (root) => {
      const fixture = writeFixture(root, { "/page": "app/page.js" }, layer);
      const evidence = await writeStagingWebBuildEvidence(
        evidenceInput(root, fixture, `metadata-layer-evidence-${index}.json`),
      );
      assert.equal(evidence.verifiedOci.layerDigests.length, 1);
    });
  }
});
