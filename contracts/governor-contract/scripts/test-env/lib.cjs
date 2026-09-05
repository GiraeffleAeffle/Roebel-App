/**
 * Shared helpers for the Roebel ONCHAIN TEST ENVIRONMENT.
 *
 * This is a parallel AttesterNFTv2 + CitizenNFTv2 pair on Gnosis mainnet (chain 100)
 * that is owned by a burner EOA instead of the Attester Safe, and whose migration is
 * deliberately NEVER finalized. That combination is what makes solo testing possible:
 * the owner can mint identities at will, and three script-controlled co-signer EOAs
 * hold enough Attester + Citizen NFTs to satisfy any approval quorum on their own.
 *
 * NOTHING here may ever touch the production contracts. See assertNotProduction().
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const MANIFEST = path.resolve(__dirname, "../../deployments/gnosis-staging-test-v2.json");
const EXPECTED_CHAIN_ID = 100;

const PINNED_TEST_ENVIRONMENT = Object.freeze({
  contractSetId: "gnosis-staging-test-v2",
  owner: "0x728871179EeD015197CE7320040143534755FE2A",
  contracts: Object.freeze({
    attesterNFTv2: "0x76b558Feb869c77790431497554C9aa8797896Fa",
    citizenNFTv2: "0x4765cB681E8eB080B3191DD550E81eaA41907323",
  }),
  runtimeCodeHashes: Object.freeze({
    attesterNFTv2:
      "0x3c12a034ea9c2749c786497b5d50dcfaa4eff84860819d788517145a2276ee51",
    citizenNFTv2:
      "0x0131b35a46839c2c50e013a5702dd1a75ab2c079890711900071d56486d1bce4",
  }),
});

/** Salt for deriving co-signer keys from the burner key. Changing it changes every co-signer. */
const COSIGNER_SALT = "roebel-onchain-test-env/cosigner/v1";

/** Production Gnosis v2 addresses. Guarded against, never used. */
const PRODUCTION_ADDRESSES = [
  "0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82", // AttesterNFTv2 (prod)
  "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5", // CitizenNFTv2  (prod)
  "0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3", // MaciAttesterGovernor (prod)
  "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa", // Attester Safe (prod owner)
].map((a) => a.toLowerCase());

/** Throw if an address we are about to WRITE to belongs to the production stack. */
function assertNotProduction(...addresses) {
  for (const a of addresses) {
    if (a && PRODUCTION_ADDRESSES.includes(String(a).toLowerCase())) {
      throw new Error(
        `REFUSING: ${a} is a PRODUCTION contract. The test-env scripts must never write to prod.`
      );
    }
  }
}

/**
 * Opt-in guard. Every mutating test-env script requires ROEBEL_TEST_ENV=1 so it can
 * never be run by muscle memory or by copy-pasting a prod deploy command.
 */
function assertTestEnvOptIn() {
  if (process.env.ROEBEL_TEST_ENV !== "1") {
    throw new Error(
      "REFUSING: set ROEBEL_TEST_ENV=1 to run a test-environment script."
    );
  }
}

function burnerKey() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw)
    throw new Error(
      "DEPLOYER_PRIVATE_KEY missing from contracts/governor-contract/.env"
    );
  const pk = raw.startsWith("0x") ? raw : "0x" + raw;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk))
    throw new Error("DEPLOYER_PRIVATE_KEY is not a 32-byte hex key");
  return pk;
}

/**
 * Deterministically derive N co-signer EOAs from the burner key.
 *
 * These hold BOTH Attester and Citizen NFTs, so scripts can supply an entire quorum.
 * Because they are derived (not random) they are recoverable from the burner key
 * alone -- no extra secret to store, and a fresh checkout can drive approvals again.
 *
 * WHY FIVE. CitizenNFTv2.approveRequest enforces one approval per wallet, so a dual
 * holder counts toward exactly ONE role. Under prod-shaped bands with 5 attesters a
 * revocation needs ceil(0.67*5)=4 attester signatures PLUS 1 citizen signature = 5
 * distinct wallets. Three co-signers (the constructor minimum) can join but can never
 * revoke. Five is the smallest count that can drive every gate; the caps (7/5) mean it
 * stays sufficient as citizens accumulate. Minting more than ~7 test attesters breaks
 * this again -- see docs/ONCHAIN_TEST_ENVIRONMENT.md.
 */
function deriveCosigners(count = 5) {
  const pk = burnerKey();
  const wallets = [];
  for (let i = 1; i <= count; i++) {
    const child = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "string", "uint256"],
        [pk, COSIGNER_SALT, i]
      )
    );
    wallets.push(new ethers.Wallet(child));
  }
  return wallets;
}

function provider() {
  return new ethers.JsonRpcProvider(
    process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com"
  );
}

function burnerWallet(p = provider()) {
  return new ethers.Wallet(burnerKey(), p);
}

function manifestExists() {
  return fs.existsSync(MANIFEST);
}

function loadManifest() {
  if (!manifestExists()) {
    throw new Error(
      "Reviewed deployments/gnosis-staging-test-v2.json missing. Restore the reviewed manifest; do not redeploy."
    );
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (m.environment !== "test")
    throw new Error("Manifest is not marked environment=test. Refusing.");
  if (m.network !== "gnosis" || Number(m.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error("Manifest is not pinned to Gnosis chain 100. Refusing.");
  }
  assertNotProduction(m.contracts.attesterNFTv2, m.contracts.citizenNFTv2);
  assertPinnedManifest(m);
  return m;
}

function sameAddress(left, right) {
  try {
    return ethers.getAddress(left) === ethers.getAddress(right);
  } catch {
    return false;
  }
}

function assertPinnedManifest(m) {
  if (m.contractSetId !== PINNED_TEST_ENVIRONMENT.contractSetId) {
    throw new Error("Manifest contract-set identity differs. Refusing.");
  }
  for (const field of ["owner"]) {
    if (!sameAddress(m[field], PINNED_TEST_ENVIRONMENT[field])) {
      throw new Error(
        `Manifest ${field} differs from the reviewed test environment. Refusing.`
      );
    }
  }
  for (const role of ["attesterNFTv2", "citizenNFTv2"]) {
    if (
      !sameAddress(m.contracts?.[role], PINNED_TEST_ENVIRONMENT.contracts[role])
    ) {
      throw new Error(
        `Manifest ${role} differs from the reviewed test pair. Refusing.`
      );
    }
    if (
      String(m.runtimeCodeHashes?.[role]).toLowerCase() !==
      PINNED_TEST_ENVIRONMENT.runtimeCodeHashes[role]
    ) {
      throw new Error(`Manifest ${role} runtime code hash differs. Refusing.`);
    }
  }
}

async function assertGnosisChain(p) {
  const network = await p.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `REFUSING: connected to chain ${network.chainId}, expected Gnosis (${EXPECTED_CHAIN_ID}).`
    );
  }
}

async function runtimeCodeHash(p, address) {
  const code = await p.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`No runtime code at ${address}. Refusing.`);
  }
  return ethers.keccak256(code).toLowerCase();
}

/**
 * Validate chain, owner, Citizen->Attester binding and both runtime hashes before
 * any mutating script obtains a write handle.
 */
async function assertManifestRuntime(m, p, options = {}) {
  const { burnerAddress, requirePinned = true } = options;
  await assertGnosisChain(p);
  if (
    m.environment !== "test" ||
    m.network !== "gnosis" ||
    Number(m.chainId) !== EXPECTED_CHAIN_ID
  ) {
    throw new Error("Manifest environment/network/chain differs. Refusing.");
  }
  assertNotProduction(
    m.contracts?.attesterNFTv2,
    m.contracts?.citizenNFTv2,
    m.owner
  );
  if (requirePinned) assertPinnedManifest(m);

  const identityAbi = ["function owner() view returns (address)"];
  const citizenAbi = [
    ...identityAbi,
    "function attesterNFT() view returns (address)",
  ];
  const attester = new ethers.Contract(
    m.contracts.attesterNFTv2,
    identityAbi,
    p
  );
  const citizen = new ethers.Contract(m.contracts.citizenNFTv2, citizenAbi, p);
  const [
    attesterOwner,
    citizenOwner,
    citizenAttester,
    attesterHash,
    citizenHash,
  ] = await Promise.all([
    attester.owner(),
    citizen.owner(),
    citizen.attesterNFT(),
    runtimeCodeHash(p, m.contracts.attesterNFTv2),
    runtimeCodeHash(p, m.contracts.citizenNFTv2),
  ]);

  if (
    !sameAddress(attesterOwner, m.owner) ||
    !sameAddress(citizenOwner, m.owner)
  ) {
    throw new Error(
      "Live contract owner differs from the reviewed manifest. Refusing."
    );
  }
  if (!sameAddress(citizenAttester, m.contracts.attesterNFTv2)) {
    throw new Error(
      "Live CitizenNFT is bound to a different AttesterNFT. Refusing."
    );
  }
  if (
    attesterHash !== String(m.runtimeCodeHashes?.attesterNFTv2).toLowerCase() ||
    citizenHash !== String(m.runtimeCodeHashes?.citizenNFTv2).toLowerCase()
  ) {
    throw new Error(
      "Live runtime code hash differs from the reviewed manifest. Refusing."
    );
  }
  if (burnerAddress && !sameAddress(burnerAddress, m.owner)) {
    throw new Error(
      "Configured burner does not control the reviewed test environment. Refusing."
    );
  }
}

async function loadValidatedTestEnvironment() {
  const manifest = loadManifest();
  const p = provider();
  const burner = burnerWallet(p);
  await assertManifestRuntime(manifest, p, { burnerAddress: burner.address });
  const derived = deriveCosigners(manifest.cosigners.length).map(
    (wallet) => wallet.address
  );
  if (
    derived.length !== manifest.cosigners.length ||
    derived.some(
      (address, index) => !sameAddress(address, manifest.cosigners[index])
    )
  ) {
    throw new Error(
      "Derived co-signers differ from the reviewed manifest. Refusing."
    );
  }
  return { manifest, provider: p, burner };
}

function saveManifest(m) {
  assertPinnedManifest(m);
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  return MANIFEST;
}

function saveCandidateManifest(m, output) {
  if (!output) {
    throw new Error(
      "Pass --candidate-manifest <path>; refusing to overwrite the reviewed manifest."
    );
  }
  const candidate = path.resolve(output);
  if ([MANIFEST, path.resolve(__dirname, "../../deployments/gnosis-test.json")].includes(candidate)) {
    throw new Error(
      "Candidate manifest must not overwrite a reviewed deployment manifest."
    );
  }
  if (
    m.environment !== "test" ||
    m.network !== "gnosis" ||
    Number(m.chainId) !== EXPECTED_CHAIN_ID
  ) {
    throw new Error(
      "Candidate manifest is not pinned to the Gnosis test environment. Refusing."
    );
  }
  assertNotProduction(
    m.contracts?.attesterNFTv2,
    m.contracts?.citizenNFTv2,
    m.owner
  );
  fs.writeFileSync(candidate, JSON.stringify(m, null, 2) + "\n", {
    flag: "wx",
  });
  return candidate;
}

/** Bands are [percentBps, floor, cap]; cap 65535 == no cap; [0,n,n] == fixed n. */
const NO_CAP = 65535;

/** Production-shaped bands. The threshold math is a thing we WANT to exercise. */
const PROD_SHAPED = {
  attester: { approval: [5000, 3, 7], rejection: [5000, 3, 7] },
  citizen: {
    attestationAttester: [3000, 2, 7],
    attestationCitizen: [0, 1, 1],
    revocationAttester: [6700, 3, NO_CAP],
    revocationCitizen: [0, 1, 1],
    rejectionAttester: [2500, 2, 5],
    rejectionCitizen: [2500, 2, 5],
  },
};

/** Everything 1-of-1: the fastest possible loop when you are iterating on UI. */
const FAST = {
  attester: { approval: [0, 1, 1], rejection: [0, 1, 1] },
  citizen: {
    attestationAttester: [0, 1, 1],
    attestationCitizen: [0, 1, 1],
    revocationAttester: [0, 1, 1],
    revocationCitizen: [0, 1, 1],
    rejectionAttester: [0, 1, 1],
    rejectionCitizen: [0, 1, 1],
  },
};

function loadArtifact(name) {
  const p = path.resolve(
    __dirname,
    `../../artifacts/contracts/verification-system/${name}.sol/${name}.json`
  );
  if (!fs.existsSync(p))
    throw new Error(`Artifact for ${name} missing -- run: npx hardhat compile`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

module.exports = {
  MANIFEST,
  EXPECTED_CHAIN_ID,
  PINNED_TEST_ENVIRONMENT,
  NO_CAP,
  PROD_SHAPED,
  FAST,
  assertNotProduction,
  assertTestEnvOptIn,
  assertGnosisChain,
  assertManifestRuntime,
  burnerKey,
  burnerWallet,
  deriveCosigners,
  loadArtifact,
  loadManifest,
  loadValidatedTestEnvironment,
  manifestExists,
  provider,
  saveCandidateManifest,
  saveManifest,
};
