import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  verifyPreviewNginxPolicy,
  verifyPublicDemoOutput,
} from "./verify-public-demo-output.mjs";

async function fixture(contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roebel-public-demo-"));
  await mkdir(path.join(directory, "_next"));
  await writeFile(path.join(directory, "index.html"), contents, "utf8");
  await writeFile(path.join(directory, "_next", "app.js"), "console.log('static preview')", "utf8");
  return directory;
}

test("accepts a static, self-contained public demo artifact", async () => {
  const directory = await fixture("<main>synthetische Demo</main>");
  try {
    const result = await verifyPublicDemoOutput(directory);
    assert.equal(result.fileCount, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a capability fingerprint without echoing the matched artifact", async () => {
  const directory = await fixture("const capability = 'walletChanged';");
  try {
    await assert.rejects(
      () => verifyPublicDemoOutput(directory),
      /forbidden wallet capability/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a Circles client fingerprint", async () => {
  const directory = await fixture("const read = 'getMuenzenBalance';");
  try {
    await assert.rejects(
      () => verifyPublicDemoOutput(directory),
      /forbidden Circles client reference/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a credential-shaped configuration name without exposing a value", async () => {
  const directory = await fixture("const mode = 'service_role';");
  try {
    await assert.rejects(
      () => verifyPublicDemoOutput(directory),
      /forbidden credential-like token/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an endpoint in a route-owned public asset", async () => {
  const directory = await fixture("<script src=\"https://example.invalid/app.js\"></script>");
  try {
    await assert.rejects(
      () => verifyPublicDemoOutput(directory),
      /route asset contains forbidden absolute network endpoint/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires a browser connection-deny policy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roebel-public-demo-csp-"));
  const config = path.join(directory, "nginx.conf");
  await writeFile(
    config,
    "add_header Content-Security-Policy \"default-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'\" always;",
    "utf8",
  );
  try {
    await verifyPreviewNginxPolicy(config);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
