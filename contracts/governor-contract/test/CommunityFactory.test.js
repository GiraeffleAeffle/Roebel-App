const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runFactory, validateConfig } = require("../scripts/community-factory.cjs");

// A DeployPlan as @netizen-labs/protocol's getPreset("town").deploy produces it.
const TOWN_PLAN = {
  membership: {
    attestationAttester: [3000, 2, 7],
    attestationCitizen: [0, 1, 1],
    revocationAttester: [6700, 3, 65535],
    revocationCitizen: [0, 1, 1],
    rejectionAttester: [2500, 2, 5],
    rejectionCitizen: [2500, 2, 5],
    attesterBands: { approval: [5000, 3, 7], rejection: [5000, 3, 7] },
    validityPeriodSeconds: 0,
  },
  governance: {
    engine: "maci",
    coordinator: "shamir",
    quorumBps: 400,
    quorumAbsolute: 2,
    timelockMinDelaySeconds: 3600,
  },
  treasury: { safeThreshold: 3, safeOwners: 5, splits: { dividend: 50, endowment: 30, reinvest: 20 } },
  registry: true,
};

// Any valid Baby Jubjub-ish field elements work for a deploy test — nothing is proven here.
const COORD_PUBKEY = {
  x: "10457101036533406547632367118273992217979173478358440826365724437999023779287",
  y: "19824078218392094440610104313265183977899662750282163392862422243483260492317",
};

async function baseConfig(outDir) {
  const signers = await ethers.getSigners();
  const [, attA, attB, attC, citD, citE, safeStandIn, coordinator] = signers;
  return {
    slug: "waren",
    name: "Waren (Müritz)",
    manifestURI: "https://waren.example/.well-known/netizen.json",
    deployPlan: TOWN_PLAN,
    attesterFounders: [attA.address, attB.address, attC.address],
    // attA is both attester and citizen founder (mirrors production: attesters ⊂ citizens)
    citizenFounders: [attA.address, citD.address, citE.address],
    safe: safeStandIn.address,
    coordinator: { address: coordinator.address, pubKey: COORD_PUBKEY },
    votingPeriodSeconds: 3600,
    skipVk: true,
    outDir,
  };
}

describe("CommunityFactory — the Phase-3 exit test: full civic set in one guided flow", function () {
  // The whole MACI stack deploys in-process; give it room.
  this.timeout(180_000);

  let outDir, cfg, registry, result;

  before(async function () {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "community-factory-"));
    const Registry = await ethers.getContractFactory("CommunityRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
    cfg = await baseConfig(outDir);
    cfg.registry = await registry.getAddress();
    result = await runFactory(cfg, { log: () => {} });
  });

  after(function () {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("mints the founder sets and hands the NFTs to the Safe", async function () {
    const citizenNFT = await ethers.getContractAt("CitizenNFTv2", result.contracts.citizenNft);
    const attesterNFT = await ethers.getContractAt("AttesterNFTv2", result.contracts.attesterNft);
    expect(await citizenNFT.citizenCount()).to.equal(3n);
    expect(await attesterNFT.attesterCount()).to.equal(3n);
    expect(await citizenNFT.owner()).to.equal(cfg.safe);
    expect(await attesterNFT.owner()).to.equal(cfg.safe);
  });

  it("binds the gatekeeper to the community's CitizenNFT and MACI core", async function () {
    const gatekeeper = await ethers.getContractAt("SignUpTokenGatekeeper", result.contracts.gatekeeper);
    expect(await gatekeeper.token()).to.equal(result.contracts.citizenNft);
    expect(await gatekeeper.maci()).to.equal(result.contracts.maci);
  });

  it("locks down the Timelock: Governor proposes and cancels, deployer holds nothing", async function () {
    const timelock = await ethers.getContractAt("TimelockController", result.contracts.timelock);
    const [deployer] = await ethers.getSigners();
    expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), result.contracts.governor)).to.equal(true);
    expect(await timelock.hasRole(await timelock.CANCELLER_ROLE(), result.contracts.governor)).to.equal(true);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(false);
  });

  it("wires the Governor to the community's stack with the plan's parameters", async function () {
    const governor = await ethers.getContractAt("MaciAttesterGovernor", result.contracts.governor);
    expect(await governor.quorumPercentage()).to.equal(4n); // 400 bps
    expect(await governor.quorumAbsolute()).to.equal(2n);
    expect(await governor.coordinator()).to.equal(cfg.coordinator.address);
  });

  it("registers the community in the CommunityRegistry, controlled by its own Timelock", async function () {
    const rec = await registry.get(ethers.id("waren"));
    expect(rec.citizenNft).to.equal(result.contracts.citizenNft);
    expect(rec.governor).to.equal(result.contracts.governor);
    expect(rec.maci).to.equal(result.contracts.maci);
    expect(rec.safe).to.equal(cfg.safe);
    expect(rec.manifestURI).to.equal(cfg.manifestURI);
    expect(rec.controller).to.equal(result.contracts.timelock);
  });

  it("emits the manifest contracts block + provenance to the output file", async function () {
    const written = JSON.parse(fs.readFileSync(result.outFile, "utf8"));
    expect(written.maciVersion).to.equal("2.5.0");
    expect(written.communityId).to.equal(ethers.id("waren"));
    expect(written.contracts).to.deep.equal(result.contracts);
    expect(written.parameters.vkRegistered).to.equal(false); // skipVk dry-run is honest about it
    expect(written.parameters.maciDeployBlock).to.be.a("number");
  });
});

describe("CommunityFactory — config validation", function () {
  it("rejects a fractional-percent quorum instead of silently flooring it", async function () {
    const cfg = await baseConfig(os.tmpdir());
    cfg.deployPlan = structuredClone(TOWN_PLAN);
    cfg.deployPlan.governance.quorumBps = 250; // 2.5% — not expressible as integer percent
    expect(() => validateConfig(cfg)).to.throw(/whole percent/);
  });

  it("rejects fewer than 3 founders", async function () {
    const cfg = await baseConfig(os.tmpdir());
    cfg.citizenFounders = cfg.citizenFounders.slice(0, 2);
    expect(() => validateConfig(cfg)).to.throw(/>=3 citizenFounders/);
  });

  it("rejects a plan missing the attester bands", async function () {
    const cfg = await baseConfig(os.tmpdir());
    cfg.deployPlan = structuredClone(TOWN_PLAN);
    delete cfg.deployPlan.membership.attesterBands;
    expect(() => validateConfig(cfg)).to.throw(/attesterBands/);
  });
});
