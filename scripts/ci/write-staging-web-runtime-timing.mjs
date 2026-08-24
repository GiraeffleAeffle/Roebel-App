#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  StableFileError,
  readStableBoundedFile,
} from "./read-stable-bounded-file.mjs";

const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const DOCKER_SCHEMA = "roebel_staging_web_docker_timing_v1";
const RUNTIME_SCHEMA = "roebel_staging_web_runtime_timing_v1";
export const MAX_DOCKER_TIMING_BYTES = 65_536;

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_invalid`);
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_shape_invalid`);
  }
}

function assertTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}_invalid`);
}

function interval(startedAtMs, finishedAtMs, label) {
  assertTimestamp(startedAtMs, `${label}_started_at_ms`);
  assertTimestamp(finishedAtMs, `${label}_finished_at_ms`);
  if (finishedAtMs < startedAtMs) throw new Error(`${label}_negative_duration`);
  return { startedAtMs, finishedAtMs };
}

function readJson(path, label) {
  try {
    return JSON.parse(readStableBoundedFile(path, MAX_DOCKER_TIMING_BYTES, label).toString("utf8"));
  } catch (error) {
    if (error instanceof StableFileError) throw error;
    throw new Error(`${label}_invalid`);
  }
}

export function writeStagingWebRuntimeTiming({
  sourceRevision,
  dockerTimingPath,
  outputPath,
  runtimeAssemblyStartedAtMs,
  runtimeAssemblyFinishedAtMs,
}) {
  if (!SOURCE_REVISION.test(sourceRevision ?? "")) throw new Error("source_revision_invalid");
  if (typeof dockerTimingPath !== "string" || !dockerTimingPath.startsWith("/")) {
    throw new Error("docker_timing_path_invalid");
  }
  if (typeof outputPath !== "string" || !outputPath.startsWith("/")) {
    throw new Error("output_path_invalid");
  }

  const dockerTiming = readJson(dockerTimingPath, "docker_timing");
  assertExactKeys(
    dockerTiming,
    [
      "nextCompileFinishedAtMs",
      "nextCompileStartedAtMs",
      "offlineMaterializationFinishedAtMs",
      "offlineMaterializationStartedAtMs",
      "schemaVersion",
    ],
    "docker_timing",
  );
  if (dockerTiming.schemaVersion !== DOCKER_SCHEMA) throw new Error("docker_timing_schema_invalid");

  const phases = {
    offlineMaterialization: interval(
      dockerTiming.offlineMaterializationStartedAtMs,
      dockerTiming.offlineMaterializationFinishedAtMs,
      "offline_materialization",
    ),
    nextCompile: interval(
      dockerTiming.nextCompileStartedAtMs,
      dockerTiming.nextCompileFinishedAtMs,
      "next_compile",
    ),
    runtimeAssembly: interval(
      runtimeAssemblyStartedAtMs,
      runtimeAssemblyFinishedAtMs,
      "runtime_assembly",
    ),
  };
  if (
    phases.nextCompile.startedAtMs < phases.offlineMaterialization.finishedAtMs ||
    phases.runtimeAssembly.startedAtMs < phases.nextCompile.finishedAtMs
  ) {
    throw new Error("runtime_timing_order_invalid");
  }

  const timing = {
    schemaVersion: RUNTIME_SCHEMA,
    sourceRevision,
    phases,
  };
  writeFileSync(outputPath, `${JSON.stringify(timing)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return timing;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("usage");
    values.set(key, value);
  }
  if (values.size !== 5) throw new Error("usage");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const timing = writeStagingWebRuntimeTiming({
    sourceRevision: args.get("--source-revision"),
    dockerTimingPath: args.get("--docker-timing-path"),
    outputPath: args.get("--output"),
    runtimeAssemblyStartedAtMs: Number(args.get("--runtime-assembly-started-at-ms")),
    runtimeAssemblyFinishedAtMs: Number(args.get("--runtime-assembly-finished-at-ms")),
  });
  process.stdout.write(`${JSON.stringify(timing)}\n`);
}
