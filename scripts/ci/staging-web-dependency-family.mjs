#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_IMAGE =
  "docker.io/library/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf";
const PNPM_VERSION = "9.15.0";
const REQUIRED_ROOT_INPUTS = [
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];

function regularFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`staging_web_dependency_input_invalid:${path}`);
  }
  return readFileSync(path);
}

function collectFiles(root, directory, predicate, optional = false) {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`staging_web_dependency_input_symlink:${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, relative(root, path), predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      files.push(relative(root, path));
    }
  }
  return files;
}

function collectPackageManifests(root, directory) {
  const absolute = join(root, directory);
  const entries = readdirSync(absolute, { withFileTypes: true });
  const manifest = entries.find((entry) => entry.name === "package.json");
  if (manifest) {
    const path = join(absolute, manifest.name);
    if (!manifest.isFile() || manifest.isSymbolicLink()) {
      throw new Error(`staging_web_dependency_input_invalid:${path}`);
    }
    return [relative(root, path)];
  }
  const manifests = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`staging_web_dependency_input_symlink:${join(absolute, entry.name)}`);
    }
    if (entry.isDirectory()) {
      manifests.push(...collectPackageManifests(root, relative(root, join(absolute, entry.name))));
    }
  }
  return manifests;
}

export function stagingWebDependencyFamily(contextRoot) {
  if (!isAbsolute(contextRoot)) {
    throw new Error("staging_web_dependency_context_not_absolute");
  }
  const inputs = [
    ...REQUIRED_ROOT_INPUTS,
    ...collectPackageManifests(contextRoot, "apps"),
    ...collectPackageManifests(contextRoot, "packages"),
    ...collectFiles(contextRoot, "patches", () => true, true),
  ].sort();
  if (!inputs.some((path) => path === "apps/web/package.json")) {
    throw new Error("staging_web_dependency_manifest_missing");
  }

  const hash = createHash("sha256");
  hash.update(`node-image\0${NODE_IMAGE}\0pnpm\0${PNPM_VERSION}\0`);
  for (const relativePath of inputs) {
    hash.update(`${relativePath}\0`);
    hash.update(regularFile(join(contextRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error("usage: staging-web-dependency-family.mjs <absolute-context>");
  }
  process.stdout.write(`${stagingWebDependencyFamily(process.argv[2])}\n`);
}
