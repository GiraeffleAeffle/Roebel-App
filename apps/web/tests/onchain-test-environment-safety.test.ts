import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveIdentityContractSet } from "../../../packages/blockchain/src/identity-contract-set.ts";

const contractRoot = new URL(
  "../../../contracts/governor-contract/",
  import.meta.url
);

test("preserves the historical v1 Gnosis test pair and runtime code hashes", () => {
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

test("the current v2 profile matches its independently deployed owner and manifest", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("deployments/gnosis-staging-test-v2.json", contractRoot), "utf8",
  ));
  const selected = resolveIdentityContractSet({
    id: manifest.contractSetId,
    attesterNFT: manifest.contracts.attesterNFTv2,
    citizenNFT: manifest.contracts.citizenNFTv2,
  });
  assert.equal(selected.id, "gnosis-staging-test-v2");
  assert.equal(selected.authorityBinding, "none");
  assert.equal(manifest.owner, "0x728871179EeD015197CE7320040143534755FE2A");
  assert.equal(manifest.cosigners.length, 5);
  assert.equal(manifest.migrationFinalized, false);
  assert.equal(manifest.deploymentTransactions.length, 9);
  assert.equal(manifest.runtimeCodeHashes.citizenNFTv2,
    "0x0131b35a46839c2c50e013a5702dd1a75ab2c079890711900071d56486d1bce4");
  const library = readFileSync(new URL("scripts/test-env/lib.cjs", contractRoot), "utf8");
  for (const value of [manifest.owner, manifest.contractSetId,
    ...Object.values(manifest.contracts), ...Object.values(manifest.runtimeCodeHashes)]) {
    assert.ok(library.includes(String(value)));
  }
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
