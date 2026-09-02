/**
 * Deploy the Roebel ONCHAIN TEST ENVIRONMENT to Gnosis mainnet (chain 100).
 *
 * Deliberate differences from the production deploy (scripts/deploy-gnosis-v2.cjs):
 *
 *   1. owner = the burner EOA, NOT the Attester Safe.
 *      -> retuning thresholds is one transaction, not a multi-sig ceremony.
 *   2. finalizeMigration() is NEVER called.
 *      -> migrationMint stays open forever, so the owner can mint a Citizen or
 *         Attester NFT into any address on demand. This is the seed/reset button.
 *   3. The three constructor-mandated founders are EOAs derived from the burner key.
 *      -> scripts can sign as them, so one person holds a whole approval quorum.
 *
 * Chain 100 on purpose: the app's smart-account EIP-712 domain, every edge function's
 * ERC-1271 check, and the thirdweb bundler/paymaster are all pinned to Gnosis. Moving
 * the test env to Chiado would change the domain separator and break identity
 * verification, so the test set lives beside prod rather than on another chain.
 *
 * Usage:
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/deploy.cjs --candidate-manifest <path> [--fast-bands]
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/deploy.cjs --dry-run [--fast-bands]
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const DRY = process.argv.includes("--dry-run");
const FAST_BANDS = process.argv.includes("--fast-bands");
const CANDIDATE_ARG = process.argv.indexOf("--candidate-manifest");
const CANDIDATE_MANIFEST =
  CANDIDATE_ARG >= 0 ? process.argv[CANDIDATE_ARG + 1] : null;

/** xDAI given to each co-signer so it can pay for its own approve() transactions. */
const COSIGNER_FUNDING = ethers.parseEther("0.01");

async function deploy(name, wallet, args) {
  const art = L.loadArtifact(name);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  L.assertTestEnvOptIn();

  if (
    CANDIDATE_ARG >= 0 &&
    (!CANDIDATE_MANIFEST || CANDIDATE_MANIFEST.startsWith("--"))
  ) {
    throw new Error("--candidate-manifest requires a new output path.");
  }
  if (!DRY && !CANDIDATE_MANIFEST) {
    throw new Error(
      "Pass --candidate-manifest <new-path>; deployments/gnosis-test.json is reviewed and immutable."
    );
  }

  const p = L.provider();
  await L.assertGnosisChain(p);

  const burner = L.burnerWallet(p);
  // 5 co-signers: the constructors take exactly 3 founders, and the other 2 are
  // migration-minted straight after. 5 is the minimum that can satisfy a revocation
  // quorum (4 attester + 1 citizen, distinct wallets). See lib.cjs "WHY FIVE".
  const cosigners = L.deriveCosigners(5);
  const founders = cosigners.slice(0, 3).map((w) => w.address);
  const extraCosigners = cosigners.slice(3).map((w) => w.address);
  const bands = FAST_BANDS ? L.FAST : L.PROD_SHAPED;

  const balance = await p.getBalance(burner.address);

  console.log("=== Roebel ONCHAIN TEST ENV deploy (Gnosis chain 100) ===");
  console.log("owner / deployer :", burner.address);
  console.log("xDAI balance     :", ethers.formatEther(balance));
  console.log("founders (3)     :", founders.join(", "));
  console.log("extra co-signers :", extraCosigners.join(", "));
  console.log(
    "bands            :",
    FAST_BANDS ? "FAST (everything 1-of-1)" : "PROD-SHAPED"
  );
  console.log("migration        : left OPEN on purpose (never finalized)");

  if (balance < ethers.parseEther("0.05")) {
    throw new Error(
      `Burner has only ${ethers.formatEther(balance)} xDAI. Fund it before deploying.`
    );
  }
  if (DRY) {
    console.log("\n--dry-run: nothing broadcast.");
    return;
  }

  // --- AttesterNFTv2 -----------------------------------------------------------
  // Name/symbol differ from prod so the test NFT is identifiable in any wallet or
  // explorer. (CitizenNFTv2 hardcodes its ERC721 name, so it cannot be relabelled --
  // the address and the in-app banner are what distinguish it there.)
  console.log("\n[1/5] deploying AttesterNFTv2 ...");
  const attester = await deploy("AttesterNFTv2", burner, [
    burner.address,
    "Roebel TEST Attester",
    "tROEBEL-ATT",
    founders,
    bands.attester.approval,
    bands.attester.rejection,
  ]);
  const attesterAddr = await attester.getAddress();
  L.assertNotProduction(attesterAddr);
  console.log("      AttesterNFTv2 :", attesterAddr);

  // --- CitizenNFTv2 ------------------------------------------------------------
  // Struct order matches CitizenNFTv2.CitizenThresholds.
  console.log("[2/5] deploying CitizenNFTv2 ...");
  const c = bands.citizen;
  const citizen = await deploy("CitizenNFTv2", burner, [
    attesterAddr,
    burner.address,
    founders,
    [
      c.attestationAttester,
      c.attestationCitizen,
      c.revocationAttester,
      c.revocationCitizen,
      c.rejectionAttester,
      c.rejectionCitizen,
    ],
    0, // validityPeriod 0 = re-attestation dormancy OFF, same as prod launch
  ]);
  const citizenAddr = await citizen.getAddress();
  L.assertNotProduction(citizenAddr);
  console.log("      CitizenNFTv2  :", citizenAddr);

  // --- Top up the co-signer set to 5 -------------------------------------------
  // migrationMint is idempotent per address (it skips existing holders) and stays
  // open forever in this environment, which is exactly what makes it the seed button.
  console.log("[3/5] migration-minting co-signers #4 and #5 ...");
  await (await attester.migrationMint(extraCosigners)).wait();
  await (await citizen.migrationMint(extraCosigners)).wait();
  console.log("      ", extraCosigners.join(", "), "-> attester + citizen");

  // --- Fund the co-signers so they can pay for their own approvals -------------
  console.log("[4/5] funding co-signers with 0.01 xDAI each ...");
  for (const w of cosigners) {
    const bal = await p.getBalance(w.address);
    if (bal >= COSIGNER_FUNDING) {
      console.log("      ", w.address, "already funded, skipping");
      continue;
    }
    const tx = await burner.sendTransaction({
      to: w.address,
      value: COSIGNER_FUNDING,
    });
    await tx.wait();
    console.log("      ", w.address, "funded");
  }

  // --- Manifest ----------------------------------------------------------------
  console.log("[5/5] writing manifest ...");
  const deployBlock = await p.getBlockNumber();
  const manifest = {
    environment: "test",
    reviewStatus: "candidate",
    contractSetId: null,
    warning:
      "TEST CONTRACTS. Burner-owned, migration never finalized, anyone holding the burner key can mint identities. NEVER reference these from production config.",
    network: "gnosis",
    chainId: 100,
    deployedAt: new Date().toISOString(),
    deployBlock,
    owner: burner.address,
    cosigners: cosigners.map((w) => w.address),
    founders,
    cosignerDerivation:
      "keccak256(burnerPrivKey, 'roebel-onchain-test-env/cosigner/v1', i) for i in 1..5",
    bandProfile: FAST_BANDS ? "fast" : "prod-shaped",
    bands,
    migrationFinalized: false,
    contracts: { attesterNFTv2: attesterAddr, citizenNFTv2: citizenAddr },
    runtimeCodeHashes: {
      attesterNFTv2: ethers.keccak256(await p.getCode(attesterAddr)),
      citizenNFTv2: ethers.keccak256(await p.getCode(citizenAddr)),
    },
  };
  await L.assertManifestRuntime(manifest, p, {
    burnerAddress: burner.address,
    requirePinned: false,
  });
  const path = L.saveCandidateManifest(manifest, CANDIDATE_MANIFEST);
  console.log("      ", path);

  const [attCount, citCount] = await Promise.all([
    attester.attesterCount(),
    citizen.citizenCount ? citizen.citizenCount() : Promise.resolve("n/a"),
  ]);
  const spent = balance - (await p.getBalance(burner.address));

  console.log("\n=== done ===");
  console.log(
    "attesterCount :",
    attCount.toString(),
    "(the 3 founding co-signers)"
  );
  console.log("citizenCount  :", citCount.toString());
  console.log("xDAI spent    :", ethers.formatEther(spent));
  console.log("\nEnv for the staging app:");
  console.log(
    "  A newly deployed pair needs a reviewed contract-set id before an app may use it."
  );
  console.log("  Do not reuse gnosis-staging-test-v1 for different addresses.");
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
