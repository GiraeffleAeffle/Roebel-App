#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
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
    allowEmpty: true,
    validate(value) {
      if (value === "") return true;
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
      typeof value === "string" &&
      (value.length > 0 || binding.allowEmpty === true) &&
      !/\s/u.test(value);
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

function replaceBindings(before, bindings, replacements) {
  let after = before;
  for (const binding of bindings) {
    const count = after.split(binding.token).length - 1;
    if (count > 0) {
      replacements[binding.environment] += count;
      after = after.replaceAll(binding.token, binding.value);
    }
  }
  return after;
}

function assertRuntimeRoot(runtimeRoot) {
  const allowedParent = resolve(tmpdir());
  const resolvedRuntimeRoot = resolve(runtimeRoot);
  const child = relative(allowedParent, resolvedRuntimeRoot);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(child) ||
    !child.split(/[\\/]/u).at(-1)?.startsWith("roebel-web-runtime-")
  ) {
    throw new Error("public_runtime_config_runtime_root_invalid");
  }
  return resolvedRuntimeRoot;
}

async function collectRuntimeTree({
  bindings,
  destination,
  directories,
  files,
  replacements,
  source,
}) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink())
    throw new Error("public_runtime_config_symlink_forbidden");
  if (metadata.isDirectory()) {
    directories.push(destination);
    for (const entry of (await readdir(source)).sort()) {
      await collectRuntimeTree({
        bindings,
        destination: join(destination, entry),
        directories,
        files,
        replacements,
        source: join(source, entry),
      });
    }
    return;
  }
  if (!metadata.isFile())
    throw new Error("public_runtime_config_file_type_invalid");

  let after = null;
  if (PATCHABLE_EXTENSIONS.has(extname(source))) {
    const before = await readFile(source, "utf8");
    const replaced = replaceBindings(before, bindings, replacements);
    if (replaced !== before) after = replaced;
  }
  files.push({
    after,
    destination,
    mode: metadata.mode & 0o777,
    source,
  });
}

async function linkDirectory(source, destination) {
  const metadata = await lstat(source);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("public_runtime_config_dependency_root_invalid");
  await symlink(source, destination, "dir");
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
    const after = replaceBindings(before, bindings, replacements);
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

export async function preparePublicRuntimeApplication({
  environment,
  runtimeRoot,
  sourceAppRoot,
}) {
  if (
    typeof sourceAppRoot !== "string" ||
    sourceAppRoot.length === 0 ||
    typeof runtimeRoot !== "string" ||
    runtimeRoot.length === 0
  ) {
    throw new Error("public_runtime_config_application_roots_invalid");
  }

  const bindings = resolveBindings(environment);
  const resolvedSourceAppRoot = resolve(sourceAppRoot);
  const resolvedRuntimeRoot = assertRuntimeRoot(runtimeRoot);
  const sourceStandaloneRoot = resolve(resolvedSourceAppRoot, "..", "..");
  const runtimeAppRoot = join(resolvedRuntimeRoot, "apps", "web");
  const replacements = Object.fromEntries(
    bindings.map((binding) => [binding.environment, 0])
  );
  const directories = [];
  const files = [];

  await collectRuntimeTree({
    bindings,
    destination: join(runtimeAppRoot, ".next"),
    directories,
    files,
    replacements,
    source: join(resolvedSourceAppRoot, ".next"),
  });

  const serverSource = join(resolvedSourceAppRoot, "server.js");
  const serverMetadata = await lstat(serverSource);
  if (!serverMetadata.isFile() || serverMetadata.isSymbolicLink())
    throw new Error("public_runtime_config_server_invalid");
  const serverBefore = await readFile(serverSource, "utf8");
  const serverAfter = replaceBindings(serverBefore, bindings, replacements);
  files.push({
    after: serverAfter,
    destination: join(runtimeAppRoot, "server.js"),
    mode: serverMetadata.mode & 0o777,
    patched: serverAfter !== serverBefore,
    source: serverSource,
  });

  const missing = Object.entries(replacements)
    .filter(([, count]) => count === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`public_runtime_config_token_missing:${missing.join(",")}`);
  }

  await rm(resolvedRuntimeRoot, { recursive: true, force: true });
  await mkdir(runtimeAppRoot, { recursive: true });
  await linkDirectory(
    join(sourceStandaloneRoot, "node_modules"),
    join(resolvedRuntimeRoot, "node_modules")
  );
  await linkDirectory(
    join(sourceStandaloneRoot, "packages"),
    join(resolvedRuntimeRoot, "packages")
  );
  await symlink(
    join(sourceStandaloneRoot, "package.json"),
    join(resolvedRuntimeRoot, "package.json")
  );
  await linkDirectory(
    join(resolvedSourceAppRoot, "node_modules"),
    join(runtimeAppRoot, "node_modules")
  );
  await linkDirectory(
    join(resolvedSourceAppRoot, "public"),
    join(runtimeAppRoot, "public")
  );
  await symlink(
    join(resolvedSourceAppRoot, "package.json"),
    join(runtimeAppRoot, "package.json")
  );

  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
  let linkedFiles = 0;
  let copiedFiles = 0;
  let patchedFiles = 0;
  for (const file of files) {
    if (file.after === null) {
      await symlink(file.source, file.destination);
      linkedFiles += 1;
    } else {
      await writeFile(file.destination, file.after, { mode: file.mode });
      copiedFiles += 1;
      if (file.patched !== false) patchedFiles += 1;
    }
  }

  return {
    schemaVersion: "roebel_public_runtime_config_receipt_v1",
    patchedFiles,
    copiedFiles,
    linkedFiles,
    replacements,
    valuesEmitted: false,
    serverPath: join(runtimeAppRoot, "server.js"),
  };
}

async function main() {
  const appRoot = fileURLToPath(new URL("./", import.meta.url));
  const receipt = await preparePublicRuntimeApplication({
    environment: process.env,
    runtimeRoot: join(tmpdir(), "roebel-web-runtime-app"),
    sourceAppRoot: appRoot,
  });
  const { serverPath, ...publicReceipt } = receipt;
  process.stdout.write(`${JSON.stringify(publicReceipt)}\n`);
  await import(pathToFileURL(serverPath).href);
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
