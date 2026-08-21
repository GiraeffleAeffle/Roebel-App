import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyPublicDemoBuildGraph } from "./verify-public-demo-build-graph.mjs";

async function buildFixture({ config = null, publicEntrypoint = "import type { ReactNode } from 'react';\nexport default function Demo(){ return null; }" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roebel-public-demo-graph-"));
  await mkdir(path.join(directory, "app"));
  await mkdir(path.join(directory, "src", "entrypoints"), { recursive: true });
  await writeFile(path.join(directory, "app", "page.tsx"), 'import Entrypoint from "@roebel-data/entrypoint";\nexport default Entrypoint;', "utf8");
  await writeFile(path.join(directory, "src", "entrypoints", "public-demo.tsx"), publicEntrypoint, "utf8");
  await writeFile(path.join(directory, "src", "entrypoints", "public-demo-manifest.ts"), "export const manifest = {};", "utf8");
  await writeFile(
    path.join(directory, "next.config.ts"),
    config ?? [
      '"src/entrypoints/public-demo.tsx"',
      '"src/entrypoints/public-demo-manifest.ts"',
      'distDir: publicDemoOnly ? ".next-public-demo" : ".next"',
      '"@roebel-data/entrypoint$"',
      '"@roebel-data/manifest$"',
    ].join("\n"),
    "utf8",
  );
  return { directory };
}

test("accepts a sealed public static graph", async () => {
  const { directory } = await buildFixture();
  try {
    const result = await verifyPublicDemoBuildGraph({ appDirectory: directory });
    assert.equal(result.checkedBoundaries, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a missing static build boundary", async () => {
  const { directory } = await buildFixture({ config: "" });
  try {
    await assert.rejects(
      () => verifyPublicDemoBuildGraph({ appDirectory: directory }),
      /no longer selects the sealed static graph/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
