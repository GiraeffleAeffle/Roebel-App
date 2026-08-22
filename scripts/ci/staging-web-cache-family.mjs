#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_IMAGE =
  "docker.io/library/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf";
const PNPM_VERSION = "9.15.0";
const INPUTS = [
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/web/package.json",
  "apps/web/next.config.mjs",
  "apps/web/postcss.config.js",
  "apps/web/tailwind.config.ts",
  "apps/web/tsconfig.json",
];

function readRegularFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`staging_web_cache_input_invalid:${path}`);
  }
  return readFileSync(path);
}

export function stagingWebCacheFamily(contextRoot) {
  if (!isAbsolute(contextRoot)) {
    throw new Error("staging_web_cache_context_not_absolute");
  }
  const hash = createHash("sha256");
  hash.update(`node-image\0${NODE_IMAGE}\0pnpm\0${PNPM_VERSION}\0`);
  for (const relativePath of INPUTS) {
    hash.update(`${relativePath}\0`);
    hash.update(readRegularFile(join(contextRoot, relativePath)));
    hash.update("\0");
  }
  const script = join(
    dirname(fileURLToPath(import.meta.url)),
    "build-staging-web-runtime.sh",
  );
  hash.update("scripts/ci/build-staging-web-runtime.sh\0");
  hash.update(readRegularFile(script));
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error("usage: staging-web-cache-family.mjs <absolute-context>");
  }
  process.stdout.write(`${stagingWebCacheFamily(process.argv[2])}\n`);
}
