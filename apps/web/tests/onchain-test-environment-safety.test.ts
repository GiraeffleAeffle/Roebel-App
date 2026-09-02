import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const contractRoot = new URL(
  "../../../contracts/governor-contract/",
  import.meta.url
);

test("pins the reviewed Gnosis test pair and runtime code hashes", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("deployments/gnosis-test.json", contractRoot), "utf8")
  );
  assert.equal(manifest.environment, "test");
  assert.equal(manifest.network, "gnosis");
  assert.equal(manifest.chainId, 100);
  assert.equal(
    manifest.contracts.attesterNFTv2,
    "0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3"
  );
  assert.equal(
    manifest.contracts.citizenNFTv2,
    "0x0Be374808A567c9088aC8208B90a4239432B3220"
  );
  assert.equal(
    manifest.runtimeCodeHashes.attesterNFTv2,
    "0x3c12a034ea9c2749c786497b5d50dcfaa4eff84860819d788517145a2276ee51"
  );
  assert.equal(
    manifest.runtimeCodeHashes.citizenNFTv2,
    "0x481949efe62483d881190ec16e7ac6ffd796b0e601ea952507fa6eee1986bafb"
  );
});

test("mutating helpers validate chain, owner, pair and code before writing", () => {
  const library = readFileSync(
    new URL("scripts/test-env/lib.cjs", contractRoot),
    "utf8"
  );
  for (const required of [
    /EXPECTED_CHAIN_ID = 100/u,
    /assertPinnedManifest/u,
    /attester\.owner\(\)/u,
    /citizen\.owner\(\)/u,
    /citizen\.attesterNFT\(\)/u,
    /runtimeCodeHash/u,
    /burnerAddress/u,
    /Derived co-signers differ/u,
    /saveCandidateManifest/u,
    /flag: "wx"/u,
  ]) {
    assert.match(library, required);
  }

  for (const script of [
    "cosign.cjs",
    "seed-identity.cjs",
    "set-bands.cjs",
    "simulate-applicant.cjs",
  ]) {
    const source = readFileSync(
      new URL(`scripts/test-env/${script}`, contractRoot),
      "utf8"
    );
    assert.match(source, /assertTestEnvOptIn\(\)/u);
    assert.match(source, /await L\.loadValidatedTestEnvironment\(\)/u);
  }

  const deploy = readFileSync(
    new URL("scripts/test-env/deploy.cjs", contractRoot),
    "utf8"
  );
  assert.match(deploy, /--candidate-manifest/u);
  assert.match(deploy, /saveCandidateManifest/u);
  assert.doesNotMatch(deploy, /L\.saveManifest\(manifest\)/u);
});

test("documents request thresholds as creation-time snapshots", () => {
  const docs = readFileSync(
    new URL("../../../docs/ONCHAIN_TEST_ENVIRONMENT.md", import.meta.url),
    "utf8"
  );
  const setBands = readFileSync(
    new URL("scripts/test-env/set-bands.cjs", contractRoot),
    "utf8"
  );
  assert.match(docs, /affects only requests created afterwards/u);
  assert.match(docs, /snapshots its approval and rejection thresholds/u);
  assert.match(setBands, /keep their snapshotted thresholds/u);
  assert.doesNotMatch(setBands, /re-evaluate against/u);
});
