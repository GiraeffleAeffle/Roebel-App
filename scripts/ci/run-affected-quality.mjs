import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { QUALITY_WORKSPACES } from "./affected-staging-components.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WORKSPACE_BY_NAME = new Map(
  QUALITY_WORKSPACES.map(({ name, root }) => [name, root]),
);

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function parseQualityPackages(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("QUALITY_PACKAGES must be valid JSON.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > QUALITY_WORKSPACES.length ||
    parsed.some((name) => typeof name !== "string" || !WORKSPACE_BY_NAME.has(name)) ||
    new Set(parsed).size !== parsed.length ||
    parsed.join("\n") !== [...parsed].sort().join("\n")
  ) {
    throw new Error("QUALITY_PACKAGES must be a closed, sorted workspace list.");
  }
  return Object.freeze(parsed);
}

export function buildQualityCommands({ full, packages, webTests, testedPackages }) {
  if (full) {
    return Object.freeze([
      Object.freeze(["test:web"]),
      Object.freeze(["lint"]),
      Object.freeze(["typecheck"]),
      Object.freeze(["exec", "turbo", "build", "--filter=!@roebel/web"]),
    ]);
  }
  if (packages.length === 0) {
    throw new Error("Scoped quality requires at least one workspace package.");
  }
  const filters = packages.flatMap((name) => ["--filter", `...${name}...`]);
  return Object.freeze([
    ...(webTests ? [Object.freeze(["test:web"])] : []),
    ...testedPackages.map((name) => Object.freeze(["--filter", name, "test"])),
    Object.freeze(["exec", "turbo", "lint", "typecheck", ...filters]),
    Object.freeze([
      "exec",
      "turbo",
      "build",
      "--filter=!@roebel/web",
      ...filters,
    ]),
  ]);
}

function packageHasTests(name) {
  const root = WORKSPACE_BY_NAME.get(name);
  if (!root) throw new Error(`Unknown quality package: ${name}`);
  const manifest = JSON.parse(readFileSync(`${ROOT}/${root}/package.json`, "utf8"));
  return typeof manifest.scripts?.test === "string" && manifest.scripts.test.length > 0;
}

function main() {
  const full = parseBoolean(process.env.QUALITY_FULL, "QUALITY_FULL");
  const webTests = parseBoolean(process.env.QUALITY_WEB_TESTS, "QUALITY_WEB_TESTS");
  const packages = parseQualityPackages(process.env.QUALITY_PACKAGES ?? "");
  if (full && packages.length > 0) {
    throw new Error("Full quality must not carry a scoped package declaration.");
  }
  const testedPackages = packages.filter(packageHasTests);
  const commands = buildQualityCommands({ full, packages, webTests, testedPackages });
  for (const args of commands) {
    const result = spawnSync("pnpm", args, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
