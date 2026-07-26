import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, safeParseManifest } from "../src/manifest.js";

const roebel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

test("the Röbel dogfood manifest validates against the schema", () => {
  const m = parseManifest(roebel);
  assert.equal(m.id, "roebel");
  assert.equal(m.chain.chainId, 100);
  assert.equal(m.identity.relyingParties.length, 4);
  assert.equal(m.identity.federation.trustedIssuers.length, 0);
});

test("rejects an inline secret where a reference is required", () => {
  const bad = { ...roebel, chain: { ...roebel.chain, rpc: "not-a-url-and-not-a-ref" } };
  assert.equal(safeParseManifest(bad).success, false);
});

test("rejects a missing required section", () => {
  const bad = { ...roebel };
  delete (bad as Record<string, unknown>).identity;
  assert.equal(safeParseManifest(bad).success, false);
});

test("rejects an unknown nsp version", () => {
  const bad = { ...roebel, nsp: "99" };
  assert.equal(safeParseManifest(bad).success, false);
});

test("a node can be any sovereign entity type (town, individual, business, club, agent, ...)", () => {
  assert.equal(parseManifest(roebel).type, "community");
  for (const t of ["individual", "business", "club", "institution", "agent", "town"]) {
    assert.equal(safeParseManifest({ ...roebel, type: t }).success, true, `type ${t} should be valid`);
  }
  // type is optional (a bare node is still valid)
  const noType = { ...roebel };
  delete (noType as Record<string, unknown>).type;
  assert.equal(safeParseManifest(noType).success, true);
});

test("v2 coverage fields parse — AA infra, data backend, sovereign AI, openDesk suite", () => {
  const m = parseManifest(roebel);
  assert.equal(m.identity.authBridge.bundlerRpc, "$GNOSIS_BUNDLER_RPC");
  assert.equal(m.services.backend?.provider, "supabase");
  assert.equal(m.ai?.selfHosted, false);
  // the full openDesk suite is expressible (optional) — a node declares its subset
  const withSuite = {
    ...roebel,
    services: {
      ...roebel.services,
      workspace: { ...roebel.services.workspace, mail: "https://mail.roebel.app", wiki: "https://wiki.roebel.app", video: "https://meet.roebel.app", project: "https://project.roebel.app" },
    },
  };
  assert.equal(safeParseManifest(withSuite).success, true);
});

test("rejects treasury splits that do not sum to 100", () => {
  const bad = { ...roebel, treasury: { ...roebel.treasury, splits: { reserve: 50, ops: 30, dividend: 10 } } };
  assert.equal(safeParseManifest(bad).success, false);
});
