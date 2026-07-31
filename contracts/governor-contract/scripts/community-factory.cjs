/**
 * Community Factory — one guided flow from preset to registered civic stack.
 *
 * Generalizes the proven Röbel sequence (deploy-gnosis-v2.cjs + deploy-maci-gnosis-v2.cjs —
 * same order, same ceremony params) from hardcoded constants to a DeployPlan produced by
 * @netizen-labs/protocol presets. Deploys identity (AttesterNFTv2 + CitizenNFTv2), governance
 * (gatekeeper → MACI v2.5 stack → Timelock → MaciAttesterGovernor), registers the set in the
 * CommunityRegistry with the community's own Timelock as controller, and emits the manifest
 * `contracts` block as output. Spec: docs/superpowers/specs/2026-07-31-community-factory-design.md.
 * MACI stays v2.5 per docs/future-research/2026-07-31_MACI_V3_MIGRATION_DECISION.md.
 *
 *   COMMUNITY_CONFIG=path/to/community.json \
 *     npx hardhat run scripts/community-factory.cjs --network gnosis
 *
 * Dry-run: --network hardhat with "skipVk": true in the config.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

// Ceremony params — bound to the one production zkey artifact (14-9-2-3); do not vary per community.
const STATE_TREE_DEPTH = 14;
const INT_STATE_TREE_DEPTH = 5;
const MESSAGE_TREE_DEPTH = 9;
const MESSAGE_BATCH_DEPTH = 2;
const VOTE_OPTION_TREE_DEPTH = 3;
const MESSAGE_BATCH_SIZE = 5 ** MESSAGE_BATCH_DEPTH;
const MODE_NON_QV = 1;
const MACI_VERSION = "2.5.0";

function bad(msg) {
  throw new Error(`community-factory: ${msg}`);
}

function assertBand(b, label) {
  if (!Array.isArray(b) || b.length !== 3 || !b.every((n) => Number.isInteger(n) && n >= 0)) {
    bad(`${label} must be a [bps, floor, cap] integer band`);
  }
}

function validateConfig(cfg) {
  for (const k of ["slug", "name", "manifestURI", "deployPlan", "attesterFounders", "citizenFounders", "safe", "coordinator", "votingPeriodSeconds"]) {
    if (cfg[k] === undefined || cfg[k] === null) bad(`config.${k} is required`);
  }
  if (!/^[a-z0-9-]+$/.test(cfg.slug)) bad("slug must be lowercase kebab-case (it becomes the communityId)");
  if (cfg.attesterFounders.length < 3) bad("need >=3 attesterFounders (AttesterNFTv2 constructor floor)");
  if (cfg.citizenFounders.length < 3) bad("need >=3 citizenFounders (CitizenNFTv2 constructor floor)");
  const p = cfg.deployPlan;
  const m = p?.membership, g = p?.governance;
  if (!m || !g) bad("deployPlan.membership and deployPlan.governance are required (use getPreset(id).deploy)");
  for (const k of ["attestationAttester", "attestationCitizen", "revocationAttester", "revocationCitizen", "rejectionAttester", "rejectionCitizen"]) {
    assertBand(m[k], `membership.${k}`);
  }
  assertBand(m.attesterBands?.approval, "membership.attesterBands.approval");
  assertBand(m.attesterBands?.rejection, "membership.attesterBands.rejection");
  if (!Number.isInteger(m.validityPeriodSeconds) || m.validityPeriodSeconds < 0) bad("membership.validityPeriodSeconds must be an integer >= 0");
  // The Governor takes integer percent; a fractional percent would silently misstate the constitution.
  if (!Number.isInteger(g.quorumBps) || g.quorumBps % 100 !== 0) {
    bad(`governance.quorumBps (${g?.quorumBps}) must be a whole percent (multiple of 100) — MaciAttesterGovernor takes integer percent`);
  }
  if (!Number.isInteger(g.quorumAbsolute) || g.quorumAbsolute < 0) bad("governance.quorumAbsolute must be an integer >= 0");
  if (!Number.isInteger(g.timelockMinDelaySeconds) || g.timelockMinDelaySeconds <= 0) bad("governance.timelockMinDelaySeconds must be a positive integer");
  if (!cfg.coordinator.address || !cfg.coordinator.pubKey?.x || !cfg.coordinator.pubKey?.y) bad("coordinator.address and coordinator.pubKey{x,y} are required");
  return cfg;
}

async function deployContract(name, signer, ...args) {
  const F = await hre.ethers.getContractFactory(name, signer);
  const c = await F.deploy(...args);
  await c.waitForDeployment();
  return c;
}

function poseidonArtifact(which) {
  const candidates = [
    path.resolve(__dirname, "../node_modules/maci-contracts/build/artifacts/contracts/crypto", `${which}.sol`, `${which}.json`),
    path.resolve(__dirname, "../../../node_modules/maci-contracts/build/artifacts/contracts/crypto", `${which}.sol`, `${which}.json`),
  ];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) bad(`prebuilt ${which} artifact not found:\n  ` + candidates.join("\n  "));
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function deployPoseidon(which, signer) {
  const art = poseidonArtifact(which);
  const F = new hre.ethers.ContractFactory(art.abi, art.bytecode, signer);
  const c = await F.deploy();
  await c.waitForDeployment();
  return c.getAddress();
}

async function deployLinked(name, signer, libraries, ...args) {
  const F = await hre.ethers.getContractFactory(name, { signer, libraries });
  const fee = await hre.ethers.provider.getFeeData();
  const c = await F.deploy(...args, {
    gasLimit: 6_000_000n,
    ...(fee.maxFeePerGas ? { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas } : {}),
  });
  await c.waitForDeployment();
  return c.getAddress();
}

/** Runs the full factory. Returns { communityId, contracts, parameters, outFile? }. */
async function runFactory(cfg, { log = console.log } = {}) {
  validateConfig(cfg);
  const { ethers, network } = hre;
  const plan = cfg.deployPlan;
  const m = plan.membership;
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  const safe = ethers.getAddress(cfg.safe);
  if (network.name === "gnosis" && (await ethers.provider.getCode(safe)) === "0x") {
    bad(`safe ${safe} has no code on gnosis — the Safe must exist before the factory runs`);
  }

  const attFounders = cfg.attesterFounders.map((a) => ethers.getAddress(a));
  const citFounders = cfg.citizenFounders.map((a) => ethers.getAddress(a));
  const symbolRoot = cfg.slug.toUpperCase();

  log(`=== Community Factory — ${cfg.name} (${cfg.slug}) on ${network.name} ===`);

  // --- Stage A: identity ---
  log("[A1] AttesterNFTv2…");
  const attesterNFT = await deployContract(
    "AttesterNFTv2", deployer,
    deployerAddr, `${cfg.name} Attester`, `${symbolRoot}-ATTESTER`,
    attFounders, m.attesterBands.approval, m.attesterBands.rejection,
  );
  const attesterNftAddr = await attesterNFT.getAddress();
  log("      →", attesterNftAddr);

  log("[A2] CitizenNFTv2…");
  // CitizenThresholds struct order — build explicitly from named keys, never object order.
  const citizenThresholds = [
    m.attestationAttester, m.attestationCitizen,
    m.revocationAttester, m.revocationCitizen,
    m.rejectionAttester, m.rejectionCitizen,
  ];
  const citizenNFT = await deployContract(
    "CitizenNFTv2", deployer,
    attesterNftAddr, deployerAddr, citFounders, citizenThresholds, m.validityPeriodSeconds,
  );
  const citizenNftAddr = await citizenNFT.getAddress();
  log("      →", citizenNftAddr);

  const cCount = await citizenNFT.citizenCount();
  const aCount = await attesterNFT.attesterCount();
  if (cCount !== BigInt(citFounders.length) || aCount !== BigInt(attFounders.length)) {
    bad(`founder mint mismatch (citizens ${cCount}/${citFounders.length}, attesters ${aCount}/${attFounders.length}) — aborting before ownership handoff`);
  }

  log("[A3] transferOwnership → Safe", safe);
  await (await attesterNFT.transferOwnership(safe)).wait();
  await (await citizenNFT.transferOwnership(safe)).wait();
  if (ethers.getAddress(await attesterNFT.owner()) !== safe || ethers.getAddress(await citizenNFT.owner()) !== safe) {
    bad("ownership transfer did not land on the Safe");
  }

  // --- Stage B: governance ---
  log("[B1] SignUpTokenGatekeeper + ConstantInitialVoiceCreditProxy…");
  const gatekeeper = await deployContract("SignUpTokenGatekeeper", deployer, citizenNftAddr);
  const gatekeeperAddr = await gatekeeper.getAddress();
  const voiceCreditProxyAddr = await (await deployContract("ConstantInitialVoiceCreditProxy", deployer, 1)).getAddress();

  log("[B2] Poseidon T3–T6 + Poll/MP/Tally factories…");
  const poseidonAddrs = {
    PoseidonT3: await deployPoseidon("PoseidonT3", deployer),
    PoseidonT4: await deployPoseidon("PoseidonT4", deployer),
    PoseidonT5: await deployPoseidon("PoseidonT5", deployer),
    PoseidonT6: await deployPoseidon("PoseidonT6", deployer),
  };
  const pollFactoryAddr = await deployLinked("PollFactory", deployer, poseidonAddrs);
  const mpFactoryAddr = await deployLinked("MessageProcessorFactory", deployer, poseidonAddrs);
  const tallyFactoryAddr = await deployLinked("TallyFactory", deployer, poseidonAddrs);

  log("[B3] MACI core…");
  const { genEmptyBallotRoots } = require("maci-contracts");
  const emptyBallotRoots = genEmptyBallotRoots(STATE_TREE_DEPTH);
  const maciAddr = await deployLinked(
    "MACI", deployer, poseidonAddrs,
    pollFactoryAddr, mpFactoryAddr, tallyFactoryAddr, gatekeeperAddr, voiceCreditProxyAddr,
    STATE_TREE_DEPTH, emptyBallotRoots,
  );
  const maciDeployBlock = await ethers.provider.getBlockNumber();
  await (await gatekeeper.setMaciInstance(maciAddr)).wait();
  log("      →", maciAddr, `(block ${maciDeployBlock})`);

  log("[B4] Verifier + VkRegistry…");
  const verifierAddr = await (await deployContract("Verifier", deployer)).getAddress();
  const vkRegistry = await deployContract("VkRegistry", deployer);
  const vkRegistryAddr = await vkRegistry.getAddress();
  if (cfg.skipVk) {
    log("      → skipVk: verifying keys NOT registered (dry-run / register-vk-batch25.cjs later)");
  } else {
    const { extractVk } = require("maci-circuits");
    const { VerifyingKey } = require("maci-domainobjs");
    const zkP = process.env.ZKEY_PROCESS_MESSAGES, zkT = process.env.ZKEY_TALLY_VOTES;
    if (!zkP || !fs.existsSync(zkP) || !zkT || !fs.existsSync(zkT)) {
      bad("ZKEY_PROCESS_MESSAGES / ZKEY_TALLY_VOTES missing — run scripts/download-zkeys.sh, or set skipVk");
    }
    const processVk = VerifyingKey.fromObj(await extractVk(zkP)).asContractParam();
    const tallyVk = VerifyingKey.fromObj(await extractVk(zkT)).asContractParam();
    await (await vkRegistry.setVerifyingKeysBatch(
      STATE_TREE_DEPTH, INT_STATE_TREE_DEPTH, MESSAGE_TREE_DEPTH, VOTE_OPTION_TREE_DEPTH, MESSAGE_BATCH_SIZE,
      [MODE_NON_QV], [processVk], [tallyVk],
    )).wait();
  }

  log("[B5] TimelockController + MaciAttesterGovernor…");
  const timelock = await deployContract(
    "TimelockController", deployer,
    BigInt(plan.governance.timelockMinDelaySeconds), [], [ethers.ZeroAddress], deployerAddr,
  );
  const timelockAddr = await timelock.getAddress();
  const governor = await deployContract("MaciAttesterGovernor", deployer, {
    attesterNFT: attesterNftAddr,
    citizenNFT: citizenNftAddr,
    maci: maciAddr,
    verifier: verifierAddr,
    vkRegistry: vkRegistryAddr,
    coordinator: ethers.getAddress(cfg.coordinator.address),
    coordinatorPubKey: { x: cfg.coordinator.pubKey.x, y: cfg.coordinator.pubKey.y },
    treeDepths: {
      intStateTreeDepth: INT_STATE_TREE_DEPTH,
      messageTreeSubDepth: MESSAGE_BATCH_DEPTH,
      messageTreeDepth: MESSAGE_TREE_DEPTH,
      voteOptionTreeDepth: VOTE_OPTION_TREE_DEPTH,
    },
    mode: MODE_NON_QV,
    timelock: timelockAddr,
    votingPeriod: BigInt(cfg.votingPeriodSeconds),
    quorumPercentage: BigInt(plan.governance.quorumBps / 100),
    quorumAbsolute: BigInt(plan.governance.quorumAbsolute),
    tallyGracePeriod: BigInt(cfg.tallyGracePeriodSeconds ?? 604800),
  });
  const governorAddr = await governor.getAddress();
  log("      → Timelock:", timelockAddr, "| Governor:", governorAddr);

  log("[B6] Timelock lockdown…");
  await (await timelock.grantRole(await timelock.PROPOSER_ROLE(), governorAddr)).wait();
  await (await timelock.grantRole(await timelock.CANCELLER_ROLE(), governorAddr)).wait();
  await (await timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployerAddr)).wait();

  // --- Stage C: registry + output ---
  const communityId = ethers.id(cfg.slug);
  const contracts = {
    citizenNft: citizenNftAddr,
    attesterNft: attesterNftAddr,
    governor: governorAddr,
    timelock: timelockAddr,
    maci: maciAddr,
    safe,
    gatekeeper: gatekeeperAddr,
  };

  if (cfg.registry) {
    log("[C1] CommunityRegistry.register — controller = the community's Timelock…");
    const registry = await ethers.getContractAt("CommunityRegistry", ethers.getAddress(cfg.registry), deployer);
    await (await registry.register(communityId, {
      ...contracts,
      circlesGroup: ethers.ZeroAddress,
      manifestURI: cfg.manifestURI,
      controller: timelockAddr,
    })).wait();
    log("      → registered as", communityId);
  } else {
    log("[C1] no registry address configured — skipping onchain registration");
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const result = {
    slug: cfg.slug,
    name: cfg.name,
    chainId,
    maciVersion: MACI_VERSION,
    deployedAt: new Date().toISOString(),
    communityId,
    contracts,
    registry: cfg.registry ?? null,
    parameters: {
      deployPlan: plan,
      votingPeriodSeconds: cfg.votingPeriodSeconds,
      tallyGracePeriodSeconds: cfg.tallyGracePeriodSeconds ?? 604800,
      coordinator: cfg.coordinator,
      maciDeployBlock,
      stateTreeDepth: STATE_TREE_DEPTH,
      intStateTreeDepth: INT_STATE_TREE_DEPTH,
      messageTreeDepth: MESSAGE_TREE_DEPTH,
      voteOptionTreeDepth: VOTE_OPTION_TREE_DEPTH,
      messageBatchSize: MESSAGE_BATCH_SIZE,
      mode: "NON_QV",
      vkRegistered: !cfg.skipVk,
    },
  };

  const outDir = cfg.outDir ?? path.resolve(__dirname, "../deployments/communities");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${cfg.slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  log("\nWritten:", outFile);
  log("The `contracts` object drops into the community's manifest verbatim.");
  return { ...result, outFile };
}

async function main() {
  const configPath = process.env.COMMUNITY_CONFIG;
  if (!configPath) bad("set COMMUNITY_CONFIG=path/to/community.json");
  const cfg = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
  const { network } = hre;
  if (network.name !== "gnosis" && network.name !== "hardhat") {
    bad(`refusing to run on "${network.name}" — expected "gnosis" (or "hardhat" dry-run)`);
  }
  if (network.name === "hardhat" && !cfg.skipVk) {
    bad('hardhat dry-run needs "skipVk": true (no zkeys on the in-process chain)');
  }
  await runFactory(cfg);
  console.log("\n=== DONE ===");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runFactory, validateConfig };
