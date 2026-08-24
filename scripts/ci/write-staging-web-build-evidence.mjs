#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createGunzip } from "node:zlib";
import {
  MAX_STAGING_WEB_OCI_LAYER_COUNT,
  verifyStagingWebOci,
} from "../verify-staging-web-oci.mjs";
import {
  StableFileError,
  readStableBoundedFile,
  readStableFilePrefix,
} from "./read-stable-bounded-file.mjs";

const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ROUTE_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;:@%\[\]-]+$/u;
const RUNTIME_SCHEMA = "roebel_staging_web_runtime_timing_v1";
const EVIDENCE_SCHEMA = "roebel_staging_web_build_evidence_v1";
const ROUTE_INVENTORY_SCHEMA = "roebel_next_app_paths_inventory_aggregate_v1";
const CANONICAL_ROUTE_SCHEMA = "roebel_next_app_paths_canonical_v1";
const OCI_BINDING_SCHEMA = "roebel_staging_web_verified_oci_binding_v1";
const OCI_RECEIPT_SCHEMA = "roebel_staging_web_oci_receipt_v1";
const MEASUREMENT_ARTIFACT_CLASS = "aggregate_measurement_evidence";
const GZIP_LAYER_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar+gzip",
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
]);
const TAR_LAYER_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.docker.image.rootfs.diff.tar",
]);
const PHASE_ORDER = [
  "prune",
  "offlineFetch",
  "offlineMaterialization",
  "nextCompile",
  "runtimeAssembly",
  "ociPackaging",
];
const STAGE_FILE_NAMES = {
  prune: "prune",
  offline_fetch: "offlineFetch",
  oci_packaging: "ociPackaging",
};
const MAX_CHECKSUM_BYTES = 512;
const MAX_RECEIPT_BYTES = 65_536;
const MAX_STAGE_TIMINGS_BYTES = 65_536;
const MAX_OCI_ARCHIVE_BYTES = 167_772_160;
const MAX_TAR_LIST_BYTES = 1_048_576;
const MAX_READ_BUFFER_BYTES = 1_048_576;
const MAX_OCI_METADATA_MEMBER_BYTES = 1_048_576;
const MAX_OCI_BLOB_MEMBER_BYTES = 134_217_728;
const MAX_OCI_MEMBER_COUNT = 4_096;
const MAX_EXPANDED_LAYER_BYTES = 1_073_741_824;
const MAX_TAR_HEADERS_PER_LAYER = 250_000;
const MAX_AGGREGATE_EXPANDED_LAYER_BYTES = 2_147_483_648;
const MAX_AGGREGATE_TAR_HEADERS = 1_000_000;
const MAX_UNATTRIBUTED_DURATION_MS = 120_000;

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_invalid`);
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label}_shape_invalid`);
  }
}

function assertTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}_invalid`);
}

function assertByteLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_READ_BUFFER_BYTES) {
    throw new Error(`${label}_invalid`);
  }
}

function interval(startedAtMs, finishedAtMs, label) {
  assertTimestamp(startedAtMs, `${label}_started_at_ms`);
  assertTimestamp(finishedAtMs, `${label}_finished_at_ms`);
  if (finishedAtMs < startedAtMs) throw new Error(`${label}_negative_duration`);
  return { startedAtMs, finishedAtMs };
}

function readJson(path, label, maxBytes = MAX_READ_BUFFER_BYTES) {
  try {
    return JSON.parse(readStableBoundedFile(path, maxBytes, label).toString("utf8"));
  } catch (error) {
    if (error instanceof StableFileError) throw error;
    throw new Error(`${label}_invalid`);
  }
}

function parseStageTimings(path) {
  const rows = readStableBoundedFile(path, MAX_STAGE_TIMINGS_BYTES, "stage_timings")
    .toString("utf8")
    .trim()
    .split("\n");
  if (rows.length !== Object.keys(STAGE_FILE_NAMES).length) {
    throw new Error("stage_timings_shape_invalid");
  }
  const intervals = {};
  for (const row of rows) {
    const [rawName, start, end, extra] = row.split("\t");
    const name = STAGE_FILE_NAMES[rawName];
    if (extra !== undefined || !name || Object.hasOwn(intervals, name)) {
      throw new Error("stage_timings_shape_invalid");
    }
    intervals[name] = interval(Number(start), Number(end), name);
  }
  assertExactKeys(intervals, Object.values(STAGE_FILE_NAMES), "stage_timings");
  return intervals;
}

function parseRuntimeTimings(path, sourceRevision) {
  const runtime = readJson(path, "runtime_timing");
  assertExactKeys(runtime, ["phases", "schemaVersion", "sourceRevision"], "runtime_timing");
  if (runtime.schemaVersion !== RUNTIME_SCHEMA || runtime.sourceRevision !== sourceRevision) {
    throw new Error("runtime_timing_identity_invalid");
  }
  assertExactKeys(
    runtime.phases,
    ["offlineMaterialization", "nextCompile", "runtimeAssembly"],
    "runtime_timing_phases",
  );
  return Object.fromEntries(
    Object.entries(runtime.phases).map(([name, value]) => {
      assertExactKeys(value, ["finishedAtMs", "startedAtMs"], `runtime_timing_${name}`);
      return [name, interval(value.startedAtMs, value.finishedAtMs, name)];
    }),
  );
}

function validatedTimingChain({ stageIntervals, runtimeIntervals, pipelineStartedAtMs, pipelineFinishedAtMs }) {
  assertTimestamp(pipelineStartedAtMs, "pipeline_started_at_ms");
  assertTimestamp(pipelineFinishedAtMs, "pipeline_finished_at_ms");
  if (pipelineFinishedAtMs < pipelineStartedAtMs) throw new Error("pipeline_negative_duration");
  const allIntervals = { ...stageIntervals, ...runtimeIntervals };
  assertExactKeys(allIntervals, PHASE_ORDER, "timing_phases");

  let previousFinishedAtMs = pipelineStartedAtMs;
  let attributedDurationMs = 0;
  const phases = {};
  for (const name of PHASE_ORDER) {
    const phase = allIntervals[name];
    if (phase.startedAtMs < pipelineStartedAtMs || phase.finishedAtMs > pipelineFinishedAtMs) {
      throw new Error(`${name}_outside_pipeline_bounds`);
    }
    if (phase.startedAtMs < previousFinishedAtMs) throw new Error(`${name}_overlaps_previous_phase`);
    phases[name] = {
      startedAtMs: phase.startedAtMs,
      finishedAtMs: phase.finishedAtMs,
      durationMs: phase.finishedAtMs - phase.startedAtMs,
    };
    attributedDurationMs += phases[name].durationMs;
    previousFinishedAtMs = phase.finishedAtMs;
  }
  const unattributedDurationMs = pipelineFinishedAtMs - pipelineStartedAtMs - attributedDurationMs;
  if (unattributedDurationMs > MAX_UNATTRIBUTED_DURATION_MS) {
    throw new Error("timing_unattributed_duration_exceeds_limit");
  }
  return {
    pipeline: {
      startedAtMs: pipelineStartedAtMs,
      finishedAtMs: pipelineFinishedAtMs,
      durationMs: pipelineFinishedAtMs - pipelineStartedAtMs,
    },
    attributedDurationMs,
    unattributedDurationMs,
    phases,
  };
}

function assertRoutePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("//")) {
    throw new Error("route_path_invalid");
  }
  for (const segment of path.split("/").slice(1)) {
    if (segment === "." || segment === ".." || (segment !== "" && !ROUTE_SEGMENT.test(segment))) {
      throw new Error("route_path_invalid");
    }
  }
}

function routeInventory(path, canonicalOutputPath, maxBytes) {
  assertByteLimit(maxBytes, "max_route_manifest_bytes");
  const sourceBytes = readStableBoundedFile(path, maxBytes, "route_manifest");
  let manifest;
  try {
    manifest = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("route_manifest_invalid");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("route_manifest_invalid");
  }
  const appPaths = Object.keys(manifest).sort((left, right) => left.localeCompare(right, "en"));
  if (appPaths.length === 0) throw new Error("route_manifest_empty");
  for (const route of appPaths) assertRoutePath(route);

  const canonicalBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: CANONICAL_ROUTE_SCHEMA,
    appPaths,
  })}\n`, "utf8");
  if (canonicalBytes.length > maxBytes) throw new Error("canonical_route_manifest_too_large");
  writeFileSync(canonicalOutputPath, canonicalBytes, { mode: 0o600, flag: "wx" });

  const pageCount = appPaths.filter((pathValue) => pathValue === "/page" || pathValue.endsWith("/page")).length;
  const routeHandlerCount = appPaths.filter((pathValue) => pathValue.endsWith("/route")).length;
  return {
    schemaVersion: ROUTE_INVENTORY_SCHEMA,
    sourceByteLength: sourceBytes.length,
    sourceManifestDigest: `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
    canonicalByteLength: canonicalBytes.length,
    canonicalManifestDigest: `sha256:${createHash("sha256").update(canonicalBytes).digest("hex")}`,
    routeCount: appPaths.length,
    pageCount,
    routeHandlerCount,
    otherCount: appPaths.length - pageCount - routeHandlerCount,
  };
}

function sameSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function snapshotStableFile({
  sourcePath,
  maxBytes,
  label,
  snapshotName,
  beforeOpenForTest,
}) {
  const snapshotRoot = mkdtempSync(join(tmpdir(), `roebel-web-${label}-snapshot-`));
  const snapshotPath = join(snapshotRoot, snapshotName);
  let sourceDescriptor;
  let snapshotDescriptor;
  try {
    const beforeOpen = lstatSync(sourcePath);
    if (!beforeOpen.isFile()) throw new Error(`${label}_not_regular_file`);
    if (!Number.isSafeInteger(beforeOpen.size) || beforeOpen.size < 1) {
      throw new Error(`${label}_size_invalid`);
    }
    if (beforeOpen.size > maxBytes) throw new Error(`${label}_too_large`);
    beforeOpenForTest?.();

    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const nonBlock = fsConstants.O_NONBLOCK ?? 0;
    sourceDescriptor = openSync(sourcePath, fsConstants.O_RDONLY | noFollow | nonBlock);
    const opened = fstatSync(sourceDescriptor);
    if (!opened.isFile()) throw new Error(`${label}_not_regular_file`);
    if (!sameSnapshot(beforeOpen, opened)) throw new Error(`${label}_changed`);

    snapshotDescriptor = openSync(
      snapshotPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(MAX_READ_BUFFER_BYTES);
    let total = 0;
    while (true) {
      const count = readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw new Error(`${label}_too_large`);
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      let written = 0;
      while (written < count) {
        const countWritten = writeSync(snapshotDescriptor, chunk, written, count - written, null);
        if (countWritten < 1) throw new Error("oci_archive_snapshot_write_invalid");
        written += countWritten;
      }
    }

    const afterRead = fstatSync(sourceDescriptor);
    const finalPath = lstatSync(sourcePath);
    if (
      total !== opened.size ||
      !afterRead.isFile() ||
      !finalPath.isFile() ||
      !sameSnapshot(opened, afterRead) ||
      !sameSnapshot(opened, finalPath)
    ) {
      throw new Error(`${label}_changed`);
    }
    fchmodSync(snapshotDescriptor, 0o400);
    const snapshotIdentity = fstatSync(snapshotDescriptor);
    if (!snapshotIdentity.isFile() || snapshotIdentity.size !== total) {
      throw new Error(`${label}_snapshot_invalid`);
    }
    return {
      snapshotRoot,
      snapshotPath,
      digest: `sha256:${hash.digest("hex")}`,
      size: total,
      snapshotIdentity,
    };
  } catch (error) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  } finally {
    for (const descriptor of [snapshotDescriptor, sourceDescriptor]) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the validation result if descriptor cleanup fails.
        }
      }
    }
  }
}

export function snapshotOciArchive(archivePath, beforeOpenForTest) {
  const snapshot = snapshotStableFile({
    sourcePath: archivePath,
    maxBytes: MAX_OCI_ARCHIVE_BYTES,
    label: "oci_archive",
    snapshotName: "roebel-web-staging.oci.tar",
    beforeOpenForTest,
  });
  return { ...snapshot, archiveDigest: snapshot.digest };
}

export function snapshotOciLayerBlob({
  blobPath,
  descriptor,
  index,
  beforeOpenForTest,
}) {
  if (!descriptor || !SHA256.test(descriptor.digest ?? "") || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > MAX_OCI_BLOB_MEMBER_BYTES) {
    throw new Error(`oci_layer_descriptor_invalid:${index}`);
  }
  const snapshot = snapshotStableFile({
    sourcePath: blobPath,
    maxBytes: descriptor.size,
    label: `oci_layer_blob_${index}`,
    snapshotName: "layer.blob",
    beforeOpenForTest,
  });
  if (snapshot.size !== descriptor.size || snapshot.digest !== descriptor.digest) {
    rmSync(snapshot.snapshotRoot, { recursive: true, force: true });
    throw new Error(`oci_layer_blob_invalid:${index}`);
  }
  return snapshot;
}

function parseTarNumber(field) {
  if (field.length === 0) return null;
  if ((field[0] & 0x80) !== 0) {
    const bytes = Buffer.from(field);
    bytes[0] &= 0x7f;
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) + BigInt(byte);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  const value = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 8);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isZeroBlock(block) {
  return block.length === 512 && block.every((byte) => byte === 0);
}

function validateTarHeader(header, maxExpandedBytes) {
  const storedChecksum = parseTarNumber(header.subarray(148, 156));
  if (storedChecksum === null) return null;
  let computedChecksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    computedChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (storedChecksum !== computedChecksum) return null;
  const size = parseTarNumber(header.subarray(124, 136));
  if (size === null || size < 0 || size > maxExpandedBytes) return null;
  return { size, paddedPayloadBytes: Math.ceil(size / 512) * 512 };
}

function tarString(field) {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function canonicalOuterMemberPath(header) {
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  let value = prefix ? `${prefix}/${name}` : name;
  while (value.startsWith("./")) value = value.slice(2);
  if (value.endsWith("/")) value = value.slice(0, -1);
  if (value.startsWith("/") || value.includes("//") || value.split("/").includes("..")) {
    return null;
  }
  return value;
}

function outerMemberLimit(path) {
  if (path === "index.json" || path === "oci-layout") return MAX_OCI_METADATA_MEMBER_BYTES;
  if (/^blobs\/sha256\/[0-9a-f]{64}$/u.test(path)) return MAX_OCI_BLOB_MEMBER_BYTES;
  return null;
}

export async function validateOciOuterArchive(
  archivePath,
  limitsForTest = {},
  validatedSnapshotDescriptor,
) {
  const memberCountLimit = limitsForTest.memberCount ?? MAX_OCI_MEMBER_COUNT;
  const aggregateMemberBytesLimit = limitsForTest.aggregateMemberBytes ?? MAX_OCI_ARCHIVE_BYTES;
  if (
    !Number.isSafeInteger(memberCountLimit) ||
    memberCountLimit < 1 ||
    memberCountLimit > MAX_OCI_MEMBER_COUNT ||
    !Number.isSafeInteger(aggregateMemberBytesLimit) ||
    aggregateMemberBytesLimit < 1 ||
    aggregateMemberBytesLimit > MAX_OCI_ARCHIVE_BYTES
  ) {
    throw new Error("oci_archive_validation_limits_invalid");
  }
  let archiveDescriptor = validatedSnapshotDescriptor;
  let ownsDescriptor = false;
  const header = Buffer.allocUnsafe(512);
  const readBuffer = Buffer.allocUnsafe(MAX_READ_BUFFER_BYTES);
  let headerBytes = 0;
  let remainingPayloadBytes = 0;
  let memberCount = 0;
  let aggregateMemberBytes = 0;
  let zeroBlocks = 0;
  let ended = false;
  const seen = new Set();

  try {
    const beforeRead = lstatSync(archivePath);
    if (!beforeRead.isFile()) return false;
    if (archiveDescriptor === undefined) {
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      const nonBlock = fsConstants.O_NONBLOCK ?? 0;
      archiveDescriptor = openSync(archivePath, fsConstants.O_RDONLY | noFollow | nonBlock);
      ownsDescriptor = true;
    }
    const opened = fstatSync(archiveDescriptor);
    if (!opened.isFile() || !sameSnapshot(beforeRead, opened)) return false;
    let position = 0;
    while (true) {
      const count = readSync(
        archiveDescriptor,
        readBuffer,
        0,
        readBuffer.length,
        position,
      );
      if (count === 0) break;
      position += count;
      const chunk = readBuffer.subarray(0, count);
      let cursor = 0;
      while (cursor < chunk.length) {
        if (ended) {
          for (; cursor < chunk.length; cursor += 1) if (chunk[cursor] !== 0) return false;
          continue;
        }
        if (remainingPayloadBytes > 0) {
          const consumed = Math.min(remainingPayloadBytes, chunk.length - cursor);
          remainingPayloadBytes -= consumed;
          cursor += consumed;
          continue;
        }
        const copied = Math.min(512 - headerBytes, chunk.length - cursor);
        chunk.copy(header, headerBytes, cursor, cursor + copied);
        headerBytes += copied;
        cursor += copied;
        if (headerBytes < 512) continue;

        headerBytes = 0;
        if (isZeroBlock(header)) {
          zeroBlocks += 1;
          if (zeroBlocks === 2) ended = true;
          continue;
        }
        if (zeroBlocks !== 0) return false;
        memberCount += 1;
        if (memberCount > memberCountLimit) return false;

        const path = canonicalOuterMemberPath(header);
        const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
        if (path === null || (type !== "0" && type !== "5")) return false;
        if (seen.has(path)) return false;
        seen.add(path);
        if (type === "5") {
          const directory = validateTarHeader(header, 0);
          if (!directory || directory.size !== 0 || !["", "blobs", "blobs/sha256"].includes(path)) return false;
          continue;
        }
        const maxMemberBytes = outerMemberLimit(path);
        if (maxMemberBytes === null) return false;
        const member = validateTarHeader(header, maxMemberBytes);
        if (!member) return false;
        aggregateMemberBytes += member.size;
        if (aggregateMemberBytes > aggregateMemberBytesLimit) return false;
        remainingPayloadBytes = member.paddedPayloadBytes;
      }
    }
    const afterRead = fstatSync(archiveDescriptor);
    const finalPath = lstatSync(archivePath);
    if (!sameSnapshot(opened, afterRead) || !sameSnapshot(opened, finalPath)) return false;
  } catch {
    return false;
  } finally {
    if (ownsDescriptor && archiveDescriptor !== undefined) {
      try {
        closeSync(archiveDescriptor);
      } catch {
        // Preserve the validation result if descriptor cleanup fails.
      }
    }
  }
  return ended && headerBytes === 0 && remainingPayloadBytes === 0 && seen.has("index.json") && seen.has("oci-layout");
}

export async function validateTarLayerStream(
  blobPath,
  isGzip,
  maxExpandedBytes = MAX_EXPANDED_LAYER_BYTES,
  aggregateBudget,
) {
  if (
    !Number.isSafeInteger(maxExpandedBytes) ||
    maxExpandedBytes < 1024 ||
    maxExpandedBytes > MAX_EXPANDED_LAYER_BYTES
  ) {
    throw new Error("max_expanded_layer_bytes_invalid");
  }
  if (
    aggregateBudget !== undefined &&
    (!aggregateBudget ||
      !Number.isSafeInteger(aggregateBudget.expandedBytes) ||
      !Number.isSafeInteger(aggregateBudget.headerCount) ||
      aggregateBudget.expandedBytes < 0 ||
      aggregateBudget.headerCount < 0)
  ) {
    throw new Error("aggregate_layer_budget_invalid");
  }
  const aggregateExpandedLimit = aggregateBudget?.maxExpandedBytes ?? MAX_AGGREGATE_EXPANDED_LAYER_BYTES;
  const aggregateHeaderLimit = aggregateBudget?.maxHeaderCount ?? MAX_AGGREGATE_TAR_HEADERS;
  if (
    !Number.isSafeInteger(aggregateExpandedLimit) ||
    !Number.isSafeInteger(aggregateHeaderLimit) ||
    aggregateExpandedLimit < 1 ||
    aggregateHeaderLimit < 1 ||
    aggregateExpandedLimit > MAX_AGGREGATE_EXPANDED_LAYER_BYTES ||
    aggregateHeaderLimit > MAX_AGGREGATE_TAR_HEADERS
  ) {
    throw new Error("aggregate_layer_budget_invalid");
  }
  const source = createReadStream(blobPath);
  const stream = isGzip ? source.pipe(createGunzip()) : source;
  const header = Buffer.allocUnsafe(512);
  let headerBytes = 0;
  let remainingPayloadBytes = 0;
  let expandedBytes = 0;
  let headerCount = 0;
  let zeroBlocks = 0;
  let ended = false;

  try {
    for await (const chunk of stream) {
      expandedBytes += chunk.length;
      if (expandedBytes > maxExpandedBytes) return false;
      if (aggregateBudget) {
        aggregateBudget.expandedBytes += chunk.length;
        if (aggregateBudget.expandedBytes > aggregateExpandedLimit) return false;
      }
      let cursor = 0;
      while (cursor < chunk.length) {
        if (ended) {
          for (; cursor < chunk.length; cursor += 1) if (chunk[cursor] !== 0) return false;
          continue;
        }
        if (remainingPayloadBytes > 0) {
          const consumed = Math.min(remainingPayloadBytes, chunk.length - cursor);
          remainingPayloadBytes -= consumed;
          cursor += consumed;
          continue;
        }

        const copied = Math.min(512 - headerBytes, chunk.length - cursor);
        chunk.copy(header, headerBytes, cursor, cursor + copied);
        headerBytes += copied;
        cursor += copied;
        if (headerBytes < 512) continue;

        headerBytes = 0;
        if (isZeroBlock(header)) {
          zeroBlocks += 1;
          if (zeroBlocks === 2) ended = true;
          continue;
        }
        if (zeroBlocks !== 0) return false;
        headerCount += 1;
        if (headerCount > MAX_TAR_HEADERS_PER_LAYER) return false;
        if (aggregateBudget) {
          aggregateBudget.headerCount += 1;
          if (aggregateBudget.headerCount > aggregateHeaderLimit) return false;
        }
        const member = validateTarHeader(header, maxExpandedBytes);
        if (member === null) return false;
        remainingPayloadBytes = member.paddedPayloadBytes;
      }
    }
  } catch {
    return false;
  }
  return ended && headerBytes === 0 && remainingPayloadBytes === 0;
}

async function verifyLayerArchives(layoutRoot, receipt) {
  const index = readJson(join(layoutRoot, "index.json"), "extracted_oci_index");
  const manifest = readJson(
    join(layoutRoot, "blobs", "sha256", receipt.manifestDigest.slice(7)),
    "extracted_oci_manifest",
  );
  if (
    !Array.isArray(manifest.layers) ||
    manifest.layers.length !== receipt.layerDigests.length ||
    manifest.layers.length > MAX_STAGING_WEB_OCI_LAYER_COUNT
  ) {
    throw new Error("oci_layer_set_invalid");
  }
  const aggregateBudget = { expandedBytes: 0, headerCount: 0 };
  for (let indexValue = 0; indexValue < manifest.layers.length; indexValue += 1) {
    const descriptor = manifest.layers[indexValue];
    if (descriptor.digest !== receipt.layerDigests[indexValue]) throw new Error("oci_layer_set_invalid");
    const blobPath = join(layoutRoot, "blobs", "sha256", descriptor.digest.slice(7));
    const snapshot = snapshotOciLayerBlob({ blobPath, descriptor, index: indexValue });
    try {
      const prefix = readStableFilePrefix(snapshot.snapshotPath, 4, "oci_layer_snapshot");
      const isGzip = prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
      if (GZIP_LAYER_MEDIA_TYPES.has(descriptor.mediaType)) {
        if (!isGzip) throw new Error(`oci_layer_compression_invalid:${indexValue}`);
      } else if (TAR_LAYER_MEDIA_TYPES.has(descriptor.mediaType)) {
        if (isGzip) throw new Error(`oci_layer_compression_invalid:${indexValue}`);
      } else {
        throw new Error(`oci_layer_media_type_invalid:${indexValue}`);
      }
      if (!(await validateTarLayerStream(snapshot.snapshotPath, isGzip, MAX_EXPANDED_LAYER_BYTES, aggregateBudget))) {
        throw new Error(`oci_layer_archive_invalid:${indexValue}`);
      }
    } finally {
      rmSync(snapshot.snapshotRoot, { recursive: true, force: true });
    }
  }
  if (index.manifests?.[0]?.digest !== receipt.manifestDigest) {
    throw new Error("oci_manifest_binding_invalid");
  }
}

async function verifyArchiveReceipt(
  archivePath,
  sourceRevision,
  {
    beforeExtractionForTest,
    expectedSnapshotIdentity,
    outerArchiveValidationLimitsForTest,
  } = {},
) {
  const beforeOpen = lstatSync(archivePath);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const nonBlock = fsConstants.O_NONBLOCK ?? 0;
  const archiveDescriptor = openSync(archivePath, fsConstants.O_RDONLY | noFollow | nonBlock);
  const opened = fstatSync(archiveDescriptor);
  const layoutRoot = mkdtempSync(join(tmpdir(), "roebel-web-evidence-oci-"));
  try {
    if (
      !beforeOpen.isFile() ||
      !opened.isFile() ||
      !sameSnapshot(beforeOpen, opened) ||
      (expectedSnapshotIdentity !== undefined && !sameSnapshot(expectedSnapshotIdentity, opened))
    ) {
      throw new Error("oci_archive_snapshot_changed");
    }
    if (!(await validateOciOuterArchive(
      archivePath,
      outerArchiveValidationLimitsForTest,
      archiveDescriptor,
    ))) {
      throw new Error("oci_archive_members_invalid");
    }
    beforeExtractionForTest?.(archivePath);
    // The child receives the already-open validated inode as fd 3; it never
    // resolves the archive pathname again.
    const extraction = spawnSync("tar", ["-xf", "/dev/fd/3", "-C", layoutRoot], {
      encoding: "utf8",
      maxBuffer: MAX_TAR_LIST_BYTES,
      stdio: ["ignore", "pipe", "pipe", archiveDescriptor],
    });
    if (extraction.status !== 0 || extraction.error) throw new Error("oci_archive_extract_invalid");
    const afterExtraction = fstatSync(archiveDescriptor);
    const finalPath = lstatSync(archivePath);
    if (!sameSnapshot(opened, afterExtraction) || !sameSnapshot(opened, finalPath)) {
      throw new Error("oci_archive_snapshot_changed");
    }
    const receipt = verifyStagingWebOci(layoutRoot, sourceRevision, { deferLayerBlobValidation: true });
    await verifyLayerArchives(layoutRoot, receipt);
    return { receipt, snapshotIdentity: opened };
  } finally {
    try {
      closeSync(archiveDescriptor);
    } catch {
      // Preserve the verification result if descriptor cleanup fails.
    }
    rmSync(layoutRoot, { recursive: true, force: true });
  }
}

function bindingForVerifiedSnapshot(snapshot, receipt, receiptBytes) {
  if (receipt?.schemaVersion !== OCI_RECEIPT_SCHEMA) throw new Error("oci_receipt_schema_invalid");
  if (!SHA256.test(receipt.manifestDigest)) throw new Error("oci_manifest_digest_invalid");
  return {
    schemaVersion: OCI_BINDING_SCHEMA,
    archiveDigest: snapshot.archiveDigest,
    receiptDigest: `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`,
    manifestDigest: receipt.manifestDigest,
    configDigest: receipt.configDigest,
    layerDigests: receipt.layerDigests,
  };
}

async function verifiedOciBinding({ archivePath, archiveChecksumPath, receiptPath, sourceRevision }) {
  const snapshot = snapshotOciArchive(archivePath);
  try {
    const checksumBytes = readStableBoundedFile(
      archiveChecksumPath,
      MAX_CHECKSUM_BYTES,
      "oci_archive_checksum",
    );
    if (checksumBytes.length < 1) throw new Error("oci_archive_checksum_size_invalid");
    const checksumMatch = /^([0-9a-f]{64})  (\/[^\r\n]+)\n$/u.exec(checksumBytes.toString("utf8"));
    if (!checksumMatch || checksumMatch[2] !== archivePath) {
      throw new Error("oci_archive_checksum_invalid");
    }
    if (snapshot.archiveDigest !== `sha256:${checksumMatch[1]}`) {
      throw new Error("oci_archive_checksum_mismatch");
    }

    const receiptBytes = readStableBoundedFile(receiptPath, MAX_RECEIPT_BYTES, "oci_receipt");
    if (receiptBytes.length < 1) throw new Error("oci_receipt_size_invalid");
    let receipt;
    try {
      receipt = JSON.parse(receiptBytes.toString("utf8"));
    } catch {
      throw new Error("oci_receipt_invalid");
    }
    if (receipt?.schemaVersion !== OCI_RECEIPT_SCHEMA) throw new Error("oci_receipt_schema_invalid");
    const { receipt: verifiedReceipt } = await verifyArchiveReceipt(
      snapshot.snapshotPath,
      sourceRevision,
      { expectedSnapshotIdentity: snapshot.snapshotIdentity },
    );
    if (!isDeepStrictEqual(receipt, verifiedReceipt)) throw new Error("oci_receipt_archive_mismatch");
    return bindingForVerifiedSnapshot(snapshot, verifiedReceipt, receiptBytes);
  } finally {
    rmSync(snapshot.snapshotRoot, { recursive: true, force: true });
  }
}

function buildMeasurementEvidence({
  sourceRevision,
  stageTimingsPath,
  runtimeTimingPath,
  appPathsManifestPath,
  canonicalRouteManifestOutputPath,
  pipelineStartedAtMs,
  pipelineFinishedAtMs,
  maxRouteManifestBytes,
  verifiedOci,
}) {
  const timings = validatedTimingChain({
    stageIntervals: parseStageTimings(stageTimingsPath),
    runtimeIntervals: parseRuntimeTimings(runtimeTimingPath, sourceRevision),
    pipelineStartedAtMs,
    pipelineFinishedAtMs,
  });
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    sourceRevision,
    artifactClass: MEASUREMENT_ARTIFACT_CLASS,
    measurementScope: "post_checkout_verified_web_pipeline",
    timings,
    routeInventory: routeInventory(
      appPathsManifestPath,
      canonicalRouteManifestOutputPath,
      maxRouteManifestBytes,
    ),
    verifiedOci,
  };
}

function writeEvidenceOutput(evidence, outputPath, maxEvidenceBytes) {
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  if (bytes.length > maxEvidenceBytes) throw new Error("build_evidence_too_large");
  writeFileSync(outputPath, bytes, { mode: 0o600, flag: "wx" });
}

export async function writeStagingWebBuildEvidence({
  sourceRevision,
  stageTimingsPath,
  runtimeTimingPath,
  appPathsManifestPath,
  canonicalRouteManifestOutputPath,
  ociArchivePath,
  ociArchiveChecksumPath,
  ociReceiptPath,
  outputPath,
  pipelineStartedAtMs,
  pipelineFinishedAtMs,
  maxRouteManifestBytes,
  maxEvidenceBytes,
}) {
  if (!SOURCE_REVISION.test(sourceRevision ?? "")) throw new Error("source_revision_invalid");
  for (const [label, value] of Object.entries({
    stageTimingsPath,
    runtimeTimingPath,
    appPathsManifestPath,
    canonicalRouteManifestOutputPath,
    ociArchivePath,
    ociArchiveChecksumPath,
    ociReceiptPath,
    outputPath,
  })) {
    if (typeof value !== "string" || !value.startsWith("/")) throw new Error(`${label}_invalid`);
  }
  assertByteLimit(maxEvidenceBytes, "max_evidence_bytes");
  const evidence = buildMeasurementEvidence({
    sourceRevision,
    stageTimingsPath,
    runtimeTimingPath,
    appPathsManifestPath,
    canonicalRouteManifestOutputPath,
    pipelineStartedAtMs,
    pipelineFinishedAtMs,
    maxRouteManifestBytes,
    verifiedOci: await verifiedOciBinding({
      archivePath: ociArchivePath,
      archiveChecksumPath: ociArchiveChecksumPath,
      receiptPath: ociReceiptPath,
      sourceRevision,
    }),
  });
  writeEvidenceOutput(evidence, outputPath, maxEvidenceBytes);
  return evidence;
}

function exposeSameSnapshotInode(snapshotPath, outputPath, expectedIdentity) {
  // link(2) is an exclusive atomic publication boundary: it fails if the
  // destination already exists and exposes the very inode that was validated.
  let linked = false;
  let snapshotDescriptor;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const nonBlock = fsConstants.O_NONBLOCK ?? 0;
    snapshotDescriptor = openSync(snapshotPath, fsConstants.O_RDONLY | noFollow | nonBlock);
    const opened = fstatSync(snapshotDescriptor);
    const beforeLink = lstatSync(snapshotPath);
    if (!opened.isFile() || !sameSnapshot(expectedIdentity, opened) || !sameSnapshot(opened, beforeLink)) {
      throw new Error("oci_archive_snapshot_changed");
    }
    linkSync(snapshotPath, outputPath);
    linked = true;
    const afterLink = fstatSync(snapshotDescriptor);
    const exposed = lstatSync(outputPath);
    if (
      afterLink.dev !== opened.dev ||
      afterLink.ino !== opened.ino ||
      afterLink.size !== opened.size ||
      afterLink.mtimeMs !== opened.mtimeMs ||
      afterLink.nlink !== opened.nlink + 1 ||
      exposed.dev !== opened.dev ||
      exposed.ino !== opened.ino ||
      exposed.size !== opened.size ||
      exposed.mtimeMs !== opened.mtimeMs
    ) {
      throw new Error("oci_archive_atomic_exposure_invalid");
    }
    unlinkSync(snapshotPath);
  } catch (error) {
    if (linked) rmSync(outputPath, { force: true });
    throw error;
  } finally {
    if (snapshotDescriptor !== undefined) {
      try {
        closeSync(snapshotDescriptor);
      } catch {
        // Preserve the publication result if descriptor cleanup fails.
      }
    }
  }
}

export async function prepareStagingWebOciAndEvidence({
  sourceRevision,
  stageTimingsPath,
  runtimeTimingPath,
  appPathsManifestPath,
  canonicalRouteManifestOutputPath,
  ociArchiveInputPath,
  ociArchiveOutputPath,
  ociArchiveChecksumOutputPath,
  ociReceiptOutputPath,
  outputPath,
  pipelineStartedAtMs,
  pipelineFinishedAtMs,
  maxRouteManifestBytes,
  maxEvidenceBytes,
  afterSnapshotForTest,
  beforeExtractionForTest,
  outerArchiveValidationLimitsForTest,
}) {
  if (!SOURCE_REVISION.test(sourceRevision ?? "")) throw new Error("source_revision_invalid");
  for (const [label, value] of Object.entries({
    stageTimingsPath,
    runtimeTimingPath,
    appPathsManifestPath,
    canonicalRouteManifestOutputPath,
    ociArchiveInputPath,
    ociArchiveOutputPath,
    ociArchiveChecksumOutputPath,
    ociReceiptOutputPath,
    outputPath,
  })) {
    if (typeof value !== "string" || !value.startsWith("/")) throw new Error(`${label}_invalid`);
  }
  assertByteLimit(maxEvidenceBytes, "max_evidence_bytes");

  // The first archive operation is a bounded, race-resistant private copy.
  // Every subsequent consumer uses that exact private snapshot.
  const snapshot = snapshotOciArchive(ociArchiveInputPath);
  const createdOutputs = [];
  try {
    afterSnapshotForTest?.(snapshot.snapshotPath, snapshot);
    const { receipt: verifiedReceipt, snapshotIdentity } = await verifyArchiveReceipt(
      snapshot.snapshotPath,
      sourceRevision,
      {
        beforeExtractionForTest,
        expectedSnapshotIdentity: snapshot.snapshotIdentity,
        outerArchiveValidationLimitsForTest,
      },
    );
    const receiptBytes = Buffer.from(`${JSON.stringify(verifiedReceipt, null, 2)}\n`, "utf8");
    if (receiptBytes.length > MAX_RECEIPT_BYTES) throw new Error("oci_receipt_too_large");
    const checksumBytes = Buffer.from(
      `${snapshot.archiveDigest.slice(7)}  ${ociArchiveOutputPath}\n`,
      "utf8",
    );
    if (checksumBytes.length > MAX_CHECKSUM_BYTES) throw new Error("oci_archive_checksum_too_large");
    // In CLI prepare mode this is sampled only after the validated snapshot
    // has been extracted and verified, so that work is part of the measured
    // post-checkout pipeline instead of disappearing after its finish time.
    const effectivePipelineFinishedAtMs = pipelineFinishedAtMs ?? Date.now();
    const evidence = buildMeasurementEvidence({
      sourceRevision,
      stageTimingsPath,
      runtimeTimingPath,
      appPathsManifestPath,
      canonicalRouteManifestOutputPath,
      pipelineStartedAtMs,
      pipelineFinishedAtMs: effectivePipelineFinishedAtMs,
      maxRouteManifestBytes,
      verifiedOci: bindingForVerifiedSnapshot(snapshot, verifiedReceipt, receiptBytes),
    });
    createdOutputs.push(canonicalRouteManifestOutputPath);

    writeFileSync(ociReceiptOutputPath, receiptBytes, { mode: 0o600, flag: "wx" });
    createdOutputs.push(ociReceiptOutputPath);
    writeFileSync(ociArchiveChecksumOutputPath, checksumBytes, { mode: 0o600, flag: "wx" });
    createdOutputs.push(ociArchiveChecksumOutputPath);
    writeEvidenceOutput(evidence, outputPath, maxEvidenceBytes);
    createdOutputs.push(outputPath);

    exposeSameSnapshotInode(snapshot.snapshotPath, ociArchiveOutputPath, snapshotIdentity);
    createdOutputs.push(ociArchiveOutputPath);
    return evidence;
  } catch (error) {
    for (const path of createdOutputs.reverse()) rmSync(path, { force: true });
    throw error;
  } finally {
    rmSync(snapshot.snapshotRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("usage");
    values.set(key, value);
  }
  if (values.size !== 14) throw new Error("usage");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const evidence = await prepareStagingWebOciAndEvidence({
    sourceRevision: args.get("--source-revision"),
    stageTimingsPath: args.get("--stage-timings"),
    runtimeTimingPath: args.get("--runtime-timing"),
    appPathsManifestPath: args.get("--app-paths-manifest"),
    canonicalRouteManifestOutputPath: args.get("--canonical-route-manifest-output"),
    ociArchiveInputPath: args.get("--oci-archive-input"),
    ociArchiveOutputPath: args.get("--oci-archive-output"),
    ociArchiveChecksumOutputPath: args.get("--oci-archive-checksum-output"),
    ociReceiptOutputPath: args.get("--oci-receipt-output"),
    outputPath: args.get("--output"),
    pipelineStartedAtMs: Number(args.get("--pipeline-started-at-ms")),
    pipelineFinishedAtMs: args.get("--pipeline-finished-at-ms") === "after-verification"
      ? undefined
      : Number(args.get("--pipeline-finished-at-ms")),
    maxRouteManifestBytes: Number(args.get("--max-route-manifest-bytes")),
    maxEvidenceBytes: Number(args.get("--max-evidence-bytes")),
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
