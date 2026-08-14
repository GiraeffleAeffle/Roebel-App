#!/usr/bin/env node

import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SAFE_PUBLIC_VALUE = /^[A-Za-z0-9:/?&=._~%+-]+$/u;

const PUBLIC_BINDINGS = [
  {
    environment: "ROEBEL_PUBLIC_SUPABASE_URL",
    token: "https://runtime-config-required.invalid",
    validate(value) {
      const url = new URL(value);
      return (
        SAFE_PUBLIC_VALUE.test(value) &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.hostname !== "runtime-config-required.invalid"
      );
    },
  },
  {
    environment: "ROEBEL_PUBLIC_SUPABASE_ANON_KEY",
    token: "__ROEBEL_RUNTIME_SUPABASE_ANON_KEY__",
    validate: isPublicToken,
  },
  {
    environment: "ROEBEL_PUBLIC_THIRDWEB_CLIENT_ID",
    token: "__ROEBEL_RUNTIME_THIRDWEB_CLIENT_ID__",
    validate(value) {
      return /^[A-Za-z0-9_-]{10,200}$/u.test(value);
    },
  },
  {
    environment: "ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL",
    token: "/__roebel_runtime_gnosis_bundler_url__",
    validate(value) {
      if (/^\/[A-Za-z0-9._~%+/-]+$/u.test(value)) return true;
      const url = new URL(value);
      return (
        SAFE_PUBLIC_VALUE.test(value) &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    },
  },
];

const PATCHABLE_EXTENSIONS = new Set([".html", ".js", ".json"]);

function isPublicToken(value) {
  return (
    value.length >= 20 &&
    value.length <= 2_048 &&
    /^[A-Za-z0-9._-]+$/u.test(value)
  );
}

function resolveBindings(environment) {
  return PUBLIC_BINDINGS.map((binding) => {
    const value = environment[binding.environment];
    let valid =
      typeof value === "string" && value.length > 0 && !/\s/u.test(value);
    if (valid) {
      try {
        valid =
          binding.validate(value) &&
          PUBLIC_BINDINGS.every(({ token }) => !value.includes(token));
      } catch {
        valid = false;
      }
    }
    if (!valid)
      throw new Error(`public_runtime_config_invalid:${binding.environment}`);
    return { ...binding, value };
  });
}

async function collectPatchableFiles(path, files) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink())
    throw new Error("public_runtime_config_symlink_forbidden");
  if (metadata.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) {
      await collectPatchableFiles(join(path, entry), files);
    }
    return;
  }
  if (metadata.isFile() && PATCHABLE_EXTENSIONS.has(extname(path))) {
    files.push({ path, mode: metadata.mode & 0o777 });
  }
}

export async function applyPublicRuntimeConfig({ environment, roots }) {
  if (
    !Array.isArray(roots) ||
    roots.length === 0 ||
    roots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    throw new Error("public_runtime_config_roots_invalid");
  }
  const bindings = resolveBindings(environment);
  const files = [];
  for (const root of roots) await collectPatchableFiles(root, files);

  const replacements = Object.fromEntries(
    bindings.map((binding) => [binding.environment, 0])
  );
  const patches = [];
  for (const file of files) {
    const before = await readFile(file.path, "utf8");
    let after = before;
    for (const binding of bindings) {
      const count = after.split(binding.token).length - 1;
      if (count > 0) {
        replacements[binding.environment] += count;
        after = after.replaceAll(binding.token, binding.value);
      }
    }
    if (after !== before) patches.push({ ...file, after });
  }

  const missing = Object.entries(replacements)
    .filter(([, count]) => count === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`public_runtime_config_token_missing:${missing.join(",")}`);
  }

  for (const { path, mode, after } of patches) {
    const temporary = `${path}.runtime-config-${process.pid}`;
    await writeFile(temporary, after, { mode });
    await rename(temporary, path);
  }

  return {
    schemaVersion: "roebel_public_runtime_config_receipt_v1",
    patchedFiles: patches.length,
    replacements,
    valuesEmitted: false,
  };
}

async function main() {
  const appRoot = fileURLToPath(new URL("./", import.meta.url));
  const receipt = await applyPublicRuntimeConfig({
    environment: process.env,
    roots: [join(appRoot, ".next"), join(appRoot, "server.js")],
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  await import(new URL("./server.js", import.meta.url));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "public_runtime_config_failed"}\n`
    );
    process.exitCode = 1;
  });
}
