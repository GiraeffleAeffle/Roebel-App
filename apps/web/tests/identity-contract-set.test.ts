import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  assertProductionGovernanceWritesAllowed,
  IDENTITY_CONTRACT_SET_IDS,
  resolveIdentityContractSet,
} from "../../../packages/blockchain/src/identity-contract-set.ts";

const production = resolveIdentityContractSet();
const stagingTest = resolveIdentityContractSet({
  id: "gnosis-staging-test-v1",
  attesterNFT: "0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3",
  citizenNFT: "0x0Be374808A567c9088aC8208B90a4239432B3220",
});

test("selects one complete known identity pair and derives authority metadata", () => {
  assert.equal(
    resolveIdentityContractSet({
      id: "gnosis-production-v2",
      attesterNFT: production.attesterNFT,
      citizenNFT: production.citizenNFT,
    }),
    production
  );
  assert.deepEqual(
    {
      id: production.id,
      chainId: production.chainId,
      isTest: production.isTest,
      authorityBinding: production.authorityBinding,
      productionGovernanceWritesAllowed:
        production.productionGovernanceWritesAllowed,
    },
    {
      id: IDENTITY_CONTRACT_SET_IDS.production,
      chainId: 100,
      isTest: false,
      authorityBinding: "production-identity-contracts",
      productionGovernanceWritesAllowed: true,
    }
  );
  assert.deepEqual(
    {
      id: stagingTest.id,
      chainId: stagingTest.chainId,
      isTest: stagingTest.isTest,
      authorityBinding: stagingTest.authorityBinding,
      credentialLabel: stagingTest.credentialLabel,
      productionGovernanceWritesAllowed:
        stagingTest.productionGovernanceWritesAllowed,
    },
    {
      id: IDENTITY_CONTRACT_SET_IDS.stagingTest,
      chainId: 100,
      isTest: true,
      authorityBinding: "none",
      credentialLabel: "Test-Bürger-Pass",
      productionGovernanceWritesAllowed: false,
    }
  );
  assert.match(stagingTest.warning ?? "", /keine reale Bürgerberechtigung/u);
  assert.doesNotThrow(() =>
    assertProductionGovernanceWritesAllowed(production)
  );
  assert.throws(
    () => assertProductionGovernanceWritesAllowed(stagingTest),
    /identity_contract_set_no_production_governance_authority/u
  );
});

test("fails closed for partial, mixed, unknown and profile-mismatched pairs", () => {
  assert.throws(
    () => resolveIdentityContractSet({ id: "gnosis-staging-test-v1" }),
    /identity_contract_set_partial/u
  );
  assert.throws(
    () =>
      resolveIdentityContractSet({
        id: "gnosis-staging-test-v1",
        attesterNFT: stagingTest.attesterNFT,
        citizenNFT: production.citizenNFT,
      }),
    /identity_contract_set_mixed_pair/u
  );
  assert.throws(
    () =>
      resolveIdentityContractSet({
        id: "unknown",
        attesterNFT: stagingTest.attesterNFT,
        citizenNFT: stagingTest.citizenNFT,
      }),
    /identity_contract_set_unknown_profile/u
  );
  assert.throws(
    () =>
      resolveIdentityContractSet({
        id: "gnosis-staging-test-v1",
        attesterNFT: "0x0000000000000000000000000000000000000001",
        citizenNFT: stagingTest.citizenNFT,
      }),
    /identity_contract_set_unknown_pair/u
  );
  assert.throws(
    () =>
      resolveIdentityContractSet({
        id: "gnosis-production-v2",
        attesterNFT: stagingTest.attesterNFT,
        citizenNFT: stagingTest.citizenNFT,
      }),
    /identity_contract_set_profile_mismatch/u
  );
});

test("the immutable Web build sentinel is inert and cannot masquerade as production", () => {
  const sentinel = resolveIdentityContractSet({
    id: "__ROEBEL_RUNTIME_IDENTITY_CONTRACT_SET__",
    attesterNFT: "0x0000000000000000000000000000000000000a71",
    citizenNFT: "0x0000000000000000000000000000000000000c17",
  });
  assert.equal(sentinel.id, "gnosis-runtime-injection-required");
  assert.equal(sentinel.usable, false);
  assert.equal(sentinel.isRuntimePlaceholder, true);
  assert.equal(sentinel.isTest, true);
  assert.equal(sentinel.authorityBinding, "none");
  assert.equal(sentinel.productionGovernanceWritesAllowed, false);
  assert.notEqual(sentinel.attesterNFT, production.attesterNFT);
  assert.notEqual(sentinel.citizenNFT, production.citizenNFT);
});

test("Web and Expo identity handles cross the one contract-set seam", () => {
  const files = [
    "../src/lib/contracts.ts",
    "../src/lib/verification-contracts.ts",
    "../src/lib/server/verify-citizen.ts",
    "../../expo/constants/gnosis.ts",
    "../../expo/constants/thirdweb.ts",
    "../../expo/constants/verification-contracts.ts",
  ];
  for (const path of files) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /identityContractSet/u, `${path} bypasses the Module`);
    assert.doesNotMatch(
      source,
      /process\.env\.(?:NEXT|EXPO)_PUBLIC_(?:ATTESTER|CITIZEN)_NFT/u
    );
  }

  const webAdapter = readFileSync(
    new URL("../src/lib/identity-contract-set.ts", import.meta.url),
    "utf8"
  );
  const expoAdapter = readFileSync(
    new URL("../../expo/constants/identity-contract-set.ts", import.meta.url),
    "utf8"
  );
  assert.match(webAdapter, /NEXT_PUBLIC_IDENTITY_CONTRACT_SET/u);
  assert.match(webAdapter, /NEXT_PUBLIC_ATTESTER_NFT_ADDRESS/u);
  assert.match(webAdapter, /NEXT_PUBLIC_CITIZEN_NFT_ADDRESS/u);
  assert.match(expoAdapter, /EXPO_PUBLIC_IDENTITY_CONTRACT_SET/u);
  assert.match(expoAdapter, /EXPO_PUBLIC_ATTESTER_NFT_ADDRESS/u);
  assert.match(expoAdapter, /EXPO_PUBLIC_CITIZEN_NFT_ADDRESS/u);
});

test("production governance, coordinator, Circles and treasury surfaces stay explicit", () => {
  const productionPinned = [
    "../src/lib/shamir/signature-verification.ts",
    "../src/lib/gnosis.ts",
    "../src/lib/muenzen/constants.ts",
    "../src/lib/maci-config.ts",
  ];
  for (const path of productionPinned) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(
      source,
      /resolveIdentityContractSet\(\)/u,
      `${path} is not explicitly production-pinned`
    );
    assert.match(
      source,
      /production/u,
      `${path} does not label the authority boundary`
    );
    assert.doesNotMatch(source, /gnosis-staging-test-v1/u);
    assert.doesNotMatch(source, /@\/lib\/identity-contract-set/u);
  }

  const packageIndex = readFileSync(
    new URL("../../../packages/blockchain/src/index.ts", import.meta.url),
    "utf8"
  );
  const contractsDialog = readFileSync(
    new URL(
      "../src/components/proposals/ContractsInfoDialog.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(packageIndex, /productionIdentityContractSet\.attesterNFT/u);
  assert.match(packageIndex, /productionIdentityContractSet\.citizenNFT/u);
  assert.match(contractsDialog, /CONTRACTS\.attesterNFT/u);
  assert.match(contractsDialog, /CONTRACTS\.citizenNFT/u);
});

test("a test banner cannot hide a production identity write handle", () => {
  const runtimeInjector = readFileSync(
    new URL("../scripts/inject-public-runtime-config.mjs", import.meta.url),
    "utf8"
  );
  assert.match(runtimeInjector, new RegExp(stagingTest.attesterNFT, "u"));
  assert.match(runtimeInjector, new RegExp(stagingTest.citizenNFT, "u"));
  assert.match(
    runtimeInjector,
    /public_runtime_identity_contract_set_invalid/u
  );

  const webBanner = readFileSync(
    new URL("../src/components/IdentityContractSetBanner.tsx", import.meta.url),
    "utf8"
  );
  const webLayout = readFileSync(
    new URL("../src/app/layout.tsx", import.meta.url),
    "utf8"
  );
  const expoBanner = readFileSync(
    new URL("../../expo/components/TestEnvBanner.tsx", import.meta.url),
    "utf8"
  );
  const expoLayout = readFileSync(
    new URL("../../expo/app/_layout.tsx", import.meta.url),
    "utf8"
  );
  assert.match(webBanner, /identityContractSet\.isTest/u);
  assert.match(webBanner, /identityContractSet\.warning/u);
  assert.match(expoBanner, /identityContractSet\.isTest/u);
  assert.match(expoBanner, /keine reale/u);
  assert.match(webLayout, /<IdentityContractSetBanner\s*\/>/u);
  assert.match(expoLayout, /<TestEnvBanner\s*\/>/u);

  for (const path of [
    "../src/components/proposals/CreateProposalForm.tsx",
    "../src/app/proposals/[id]/page.tsx",
    "../src/app/app/proposals/[id]/page.tsx",
    "../../expo/lib/governance-utils.ts",
    "../../expo/app/proposal/[id].tsx",
    "../../expo/components/VoteButtons.tsx",
    "../../expo/components/VoteButtonsEnhanced.tsx",
  ]) {
    assert.match(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      /governanceCitizenNFTContract/u,
      `${path} could grant production governance through a test identity handle`
    );
  }

  for (const path of [
    "../src/components/proposals/CreateProposalForm.tsx",
    "../../expo/components/VoteButtons.tsx",
    "../../expo/components/VoteButtonsEnhanced.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /assertProductionGovernanceWritesAllowed/u);
    assert.match(source, /productionGovernanceWritesAllowed/u);
  }
});
