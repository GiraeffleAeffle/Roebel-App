export const IDENTITY_CONTRACT_SET_IDS = {
  production: "gnosis-production-v2",
  stagingTest: "gnosis-staging-test-v1",
} as const;

export type IdentityContractSetId =
  (typeof IDENTITY_CONTRACT_SET_IDS)[keyof typeof IDENTITY_CONTRACT_SET_IDS];

export type IdentityContractAddress = `0x${string}`;

export type IdentityContractSet = Readonly<{
  id: IdentityContractSetId | "gnosis-runtime-injection-required";
  chainId: 100;
  attesterNFT: IdentityContractAddress;
  citizenNFT: IdentityContractAddress;
  isTest: boolean;
  usable: boolean;
  isRuntimePlaceholder: boolean;
  authorityBinding: "production-identity-contracts" | "none";
  productionGovernanceWritesAllowed: boolean;
  credentialLabel: "Bürger-Pass" | "Test-Bürger-Pass";
  warning: string | null;
}>;

export type IdentityContractSetConfiguration = Readonly<{
  id?: string;
  attesterNFT?: string;
  citizenNFT?: string;
}>;

const PRODUCTION = Object.freeze({
  id: IDENTITY_CONTRACT_SET_IDS.production,
  chainId: 100,
  attesterNFT: "0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82",
  citizenNFT: "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5",
  isTest: false,
  usable: true,
  isRuntimePlaceholder: false,
  authorityBinding: "production-identity-contracts",
  productionGovernanceWritesAllowed: true,
  credentialLabel: "Bürger-Pass",
  warning: null,
} as const satisfies IdentityContractSet);

const STAGING_TEST = Object.freeze({
  id: IDENTITY_CONTRACT_SET_IDS.stagingTest,
  chainId: 100,
  attesterNFT: "0x5983F6300bCE3D9C1336a858Bd73F259bB8330F3",
  citizenNFT: "0x0Be374808A567c9088aC8208B90a4239432B3220",
  isTest: true,
  usable: true,
  isRuntimePlaceholder: false,
  authorityBinding: "none",
  productionGovernanceWritesAllowed: false,
  credentialLabel: "Test-Bürger-Pass",
  warning:
    "Test-Bürger-Pass · keine reale Bürgerberechtigung, kommunale Entscheidung, Abstimmungs- oder Zahlungsbefugnis.",
} as const satisfies IdentityContractSet);

const RUNTIME_PLACEHOLDER = Object.freeze({
  id: "gnosis-runtime-injection-required",
  chainId: 100,
  // Deliberately not the replacement tokens and deliberately not usable NFT
  // contracts. They only let Next construct inert handles during compilation.
  attesterNFT: "0x0000000000000000000000000000000000000000",
  citizenNFT: "0x000000000000000000000000000000000000dEaD",
  isTest: true,
  usable: false,
  isRuntimePlaceholder: true,
  authorityBinding: "none",
  productionGovernanceWritesAllowed: false,
  credentialLabel: "Test-Bürger-Pass",
  warning:
    "Runtime-Konfiguration fehlt · keine Bürgerberechtigung oder andere Befugnis.",
} as const satisfies IdentityContractSet);

const SETS_BY_ID: Readonly<Record<IdentityContractSetId, IdentityContractSet>> =
  Object.freeze({
    [PRODUCTION.id]: PRODUCTION,
    [STAGING_TEST.id]: STAGING_TEST,
  });

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function fail(code: string): never {
  throw new Error(`identity_contract_set_${code}`);
}

function isRuntimeBuildSentinel(configuration: {
  id: string;
  attesterNFT: string;
  citizenNFT: string;
}): boolean {
  // Do not spell out the complete replacement tokens here: the runtime injector
  // patches every occurrence in compiled output. Structural checks let this
  // branch match during `next build` and disappear naturally after replacement.
  return (
    /^__ROEBEL_RUNTIME_[A-Z0-9_]+__$/u.test(configuration.id) &&
    /^0x0{37}a71$/iu.test(configuration.attesterNFT) &&
    /^0x0{37}c17$/iu.test(configuration.citizenNFT)
  );
}

/**
 * Selects the complete CitizenNFT/AttesterNFT pair as one indivisible Module.
 *
 * The interface deliberately accepts either no configuration (the production
 * default) or all three public values. Callers cannot independently override a
 * single address, chain or authority label. Unknown, partial and mixed pairs fail
 * while the app is starting, before any read or write handle can be constructed.
 */
export function resolveIdentityContractSet(
  configuration: IdentityContractSetConfiguration = {}
): IdentityContractSet {
  const values = [
    configuration.id,
    configuration.attesterNFT,
    configuration.citizenNFT,
  ];
  const configured = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (configured.length === 0) return PRODUCTION;
  if (configured.length !== values.length) fail("partial");

  if (
    isRuntimeBuildSentinel({
      id: configuration.id!,
      attesterNFT: configuration.attesterNFT!,
      citizenNFT: configuration.citizenNFT!,
    })
  ) {
    return RUNTIME_PLACEHOLDER;
  }

  const selected = SETS_BY_ID[configuration.id as IdentityContractSetId];
  if (!selected) fail("unknown_profile");

  const attester = normalizeAddress(configuration.attesterNFT!);
  const citizen = normalizeAddress(configuration.citizenNFT!);
  const attesterOwner = Object.values(SETS_BY_ID).find(
    (set) => normalizeAddress(set.attesterNFT) === attester
  );
  const citizenOwner = Object.values(SETS_BY_ID).find(
    (set) => normalizeAddress(set.citizenNFT) === citizen
  );

  if (attesterOwner && citizenOwner && attesterOwner.id !== citizenOwner.id) {
    fail("mixed_pair");
  }
  if (!attesterOwner || !citizenOwner) fail("unknown_pair");
  if (
    attester !== normalizeAddress(selected.attesterNFT) ||
    citizen !== normalizeAddress(selected.citizenNFT)
  ) {
    fail("profile_mismatch");
  }

  return selected;
}

/**
 * A mutation boundary for the separately governed production MACI/treasury path.
 * Test identity credentials are useful for the staging rehearsal but can never
 * authorize a production proposal, vote, coordinator action or payment.
 */
export function assertProductionGovernanceWritesAllowed(
  contractSet: IdentityContractSet
): void {
  if (!contractSet.productionGovernanceWritesAllowed) {
    throw new Error("identity_contract_set_no_production_governance_authority");
  }
}

/**
 * Keeps staging-only UI behind the exact reviewed test profile returned by
 * this Module. A merely test-shaped or unusable runtime placeholder must not
 * expose actions that call the synthetic participant gateway.
 */
export function isReviewedStagingTestIdentityContractSet(
  contractSet: IdentityContractSet
): boolean {
  return contractSet === STAGING_TEST;
}
