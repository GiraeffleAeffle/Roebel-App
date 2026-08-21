import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyPublicRuntimeConfig,
  preparePublicRuntimeApplication,
} from "../scripts/inject-public-runtime-config.mjs";

const environment = {
  ROEBEL_PUBLIC_SUPABASE_URL: "https://public.example.invalid",
  ROEBEL_PUBLIC_SUPABASE_ANON_KEY:
    "public-anon-key-with-more-than-20-characters",
  ROEBEL_PUBLIC_THIRDWEB_CLIENT_ID: "thirdweb_public_client_123456",
  ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL: "/api/bundler",
};

const fixture = [
  "https://runtime-config-required.invalid",
  "__ROEBEL_RUNTIME_SUPABASE_ANON_KEY__",
  "__ROEBEL_RUNTIME_THIRDWEB_CLIENT_ID__",
  "/__roebel_runtime_gnosis_bundler_url__",
].join("|");

test("injects only reviewed public runtime values without emitting them", async () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-public-runtime-"));
  try {
    const next = join(root, ".next");
    mkdirSync(join(next, "static", "chunks"), { recursive: true });
    writeFileSync(join(next, "static", "chunks", "client.js"), fixture);
    writeFileSync(join(root, "server.js"), fixture);

    const receipt = await applyPublicRuntimeConfig({
      environment,
      roots: [next, join(root, "server.js")],
    });

    assert.equal(
      receipt.schemaVersion,
      "roebel_public_runtime_config_receipt_v1"
    );
    assert.equal(receipt.patchedFiles, 2);
    assert.equal(receipt.valuesEmitted, false);
    assert.deepEqual(Object.values(receipt.replacements), [2, 2, 2, 2]);
    const patched = `${readFileSync(join(next, "static", "chunks", "client.js"), "utf8")}|${readFileSync(join(root, "server.js"), "utf8")}`;
    for (const token of fixture.split("|"))
      assert.doesNotMatch(
        patched,
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u")
      );
    for (const value of Object.values(environment))
      assert.match(
        patched,
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u")
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports an explicitly disabled optional Gnosis bundler", async () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-public-runtime-optional-"));
  try {
    const client = join(root, "client.js");
    writeFileSync(client, fixture);
    const receipt = await applyPublicRuntimeConfig({
      environment: {
        ...environment,
        ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL: "",
      },
      roots: [client],
    });

    assert.equal(receipt.replacements.ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL, 1);
    assert.doesNotMatch(
      readFileSync(client, "utf8"),
      /__roebel_runtime_gnosis_bundler_url__/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed for placeholder values, missing tokens and symlink traversal", async () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-public-runtime-negative-"));
  try {
    writeFileSync(join(root, "client.js"), fixture);
    await assert.rejects(
      applyPublicRuntimeConfig({
        environment: {
          ...environment,
          ROEBEL_PUBLIC_SUPABASE_URL: "https://runtime-config-required.invalid",
        },
        roots: [join(root, "client.js")],
      }),
      /public_runtime_config_invalid:ROEBEL_PUBLIC_SUPABASE_URL/
    );

    const partiallyPatchable = `before|${fixture.split("|")[0]}`;
    writeFileSync(join(root, "missing.js"), partiallyPatchable);
    await assert.rejects(
      applyPublicRuntimeConfig({
        environment,
        roots: [join(root, "missing.js")],
      }),
      /public_runtime_config_token_missing:/
    );
    assert.equal(
      readFileSync(join(root, "missing.js"), "utf8"),
      partiallyPatchable
    );

    await assert.rejects(
      applyPublicRuntimeConfig({
        environment: {
          ...environment,
          ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL: "/api/bundler'breakout",
        },
        roots: [join(root, "client.js")],
      }),
      /public_runtime_config_invalid:ROEBEL_PUBLIC_GNOSIS_BUNDLER_URL/
    );

    symlinkSync(join(root, "client.js"), join(root, "linked.js"));
    await assert.rejects(
      applyPublicRuntimeConfig({
        environment,
        roots: [join(root, "linked.js")],
      }),
      /public_runtime_config_symlink_forbidden/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializes a bounded writable shadow while preserving the read-only source", async () => {
  const root = mkdtempSync(join(tmpdir(), "roebel-public-runtime-shadow-"));
  try {
    const standalone = join(root, "standalone");
    const app = join(standalone, "apps", "web");
    const next = join(app, ".next");
    const runtimeRoot = join(root, "roebel-web-runtime-shadow");
    mkdirSync(join(standalone, "node_modules"), { recursive: true });
    mkdirSync(join(standalone, "packages"), { recursive: true });
    mkdirSync(join(app, "node_modules"), { recursive: true });
    mkdirSync(join(app, "public"), { recursive: true });
    mkdirSync(join(next, "static", "chunks"), { recursive: true });
    writeFileSync(join(standalone, "package.json"), "{}");
    writeFileSync(join(app, "package.json"), "{}");
    writeFileSync(join(app, "server.js"), 'module.exports = "server";\n');
    writeFileSync(join(next, "static", "chunks", "client.js"), fixture);
    writeFileSync(join(next, "unchanged.json"), '{"unchanged":true}\n');

    const receipt = await preparePublicRuntimeApplication({
      environment,
      runtimeRoot,
      sourceAppRoot: app,
    });

    assert.equal(receipt.patchedFiles, 1);
    assert.equal(receipt.copiedFiles, 2);
    assert.equal(receipt.linkedFiles, 1);
    assert.equal(receipt.valuesEmitted, false);
    assert.deepEqual(Object.values(receipt.replacements), [1, 1, 1, 1]);
    assert.equal(
      readFileSync(join(next, "static", "chunks", "client.js"), "utf8"),
      fixture
    );
    assert.equal(
      lstatSync(
        join(runtimeRoot, "apps", "web", ".next", "unchanged.json")
      ).isSymbolicLink(),
      true
    );
    assert.equal(lstatSync(receipt.serverPath).isFile(), true);
    assert.equal(
      lstatSync(
        join(runtimeRoot, "apps", "web", "node_modules")
      ).isSymbolicLink(),
      true
    );
    const patched = readFileSync(
      join(
        runtimeRoot,
        "apps",
        "web",
        ".next",
        "static",
        "chunks",
        "client.js"
      ),
      "utf8"
    );
    for (const token of fixture.split("|"))
      assert.doesNotMatch(patched, new RegExp(token, "u"));
    for (const value of Object.values(environment))
      assert.match(patched, new RegExp(value, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
