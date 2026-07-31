const { expect } = require("chai");
const { ethers } = require("hardhat");

// A registry record is the manifest `contracts` block plus manifestURI and
// controller. addr(n) fabricates distinct checksummed addresses per slot.
const addr = (n) => ethers.getAddress("0x" + String(n).padStart(40, "0"));

const ID_A = ethers.id("roebel");
const ID_B = ethers.id("waren");

function record(controller, n = 1) {
  return {
    citizenNft: addr(n),
    attesterNft: addr(n + 1),
    governor: addr(n + 2),
    timelock: addr(n + 3),
    maci: addr(n + 4),
    safe: addr(n + 5),
    gatekeeper: ethers.ZeroAddress, // optional slots stay zero
    circlesGroup: ethers.ZeroAddress,
    manifestURI: "https://roebel.app/.well-known/netizen.json",
    controller,
  };
}

async function deploy() {
  const [deployer, community, stranger, next] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("CommunityRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  return { registry, deployer, community, stranger, next };
}

describe("CommunityRegistry — register", function () {
  it("registers a community and emits, with explicit controller", async function () {
    const { registry, deployer, community } = await deploy();
    await expect(registry.register(ID_A, record(community.address)))
      .to.emit(registry, "CommunityRegistered")
      .withArgs(ID_A, community.address);
    const c = await registry.get(ID_A);
    expect(c.citizenNft).to.equal(addr(1));
    expect(c.manifestURI).to.equal("https://roebel.app/.well-known/netizen.json");
    expect(c.controller).to.equal(community.address);
    // deployer registered but is NOT the controller — handoff happened at register time
    expect(c.controller).to.not.equal(deployer.address);
  });

  it("defaults a zero controller to msg.sender", async function () {
    const { registry, deployer } = await deploy();
    await registry.register(ID_A, record(ethers.ZeroAddress));
    expect((await registry.get(ID_A)).controller).to.equal(deployer.address);
  });

  it("is first-come-first-served: duplicate id reverts", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.register(ID_A, record(community.address)))
      .to.be.revertedWithCustomError(registry, "IdTaken")
      .withArgs(ID_A);
  });
});

describe("CommunityRegistry — update", function () {
  it("controller updates the record; controller field in payload is ignored", async function () {
    const { registry, community, stranger } = await deploy();
    await registry.register(ID_A, record(community.address));
    // payload tries to smuggle a controller rotation through update()
    const updated = { ...record(stranger.address, 10), manifestURI: "ipfs://new" };
    await expect(registry.connect(community).update(ID_A, updated))
      .to.emit(registry, "CommunityUpdated")
      .withArgs(ID_A);
    const c = await registry.get(ID_A);
    expect(c.citizenNft).to.equal(addr(10));
    expect(c.manifestURI).to.equal("ipfs://new");
    expect(c.controller).to.equal(community.address); // rotation only via setController
  });

  it("a stranger cannot update", async function () {
    const { registry, community, stranger } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(stranger).update(ID_A, record(stranger.address)))
      .to.be.revertedWithCustomError(registry, "NotController")
      .withArgs(ID_A, stranger.address);
  });

  it("updating an unknown id reverts", async function () {
    const { registry, community } = await deploy();
    await expect(registry.connect(community).update(ID_B, record(community.address)))
      .to.be.revertedWithCustomError(registry, "UnknownId")
      .withArgs(ID_B);
  });
});

describe("CommunityRegistry — setController", function () {
  it("rotates control; old controller loses access, new one gains it", async function () {
    const { registry, community, next } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(community).setController(ID_A, next.address))
      .to.emit(registry, "ControllerChanged")
      .withArgs(ID_A, community.address, next.address);
    await expect(registry.connect(community).update(ID_A, record(community.address)))
      .to.be.revertedWithCustomError(registry, "NotController");
    await registry.connect(next).update(ID_A, record(next.address, 20));
    expect((await registry.get(ID_A)).citizenNft).to.equal(addr(20));
  });

  it("cannot rotate to the zero address (would brick the record)", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await expect(registry.connect(community).setController(ID_A, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "ZeroController");
  });
});

describe("CommunityRegistry — reads", function () {
  it("get() of an unknown id reverts (distinguishable from a zeroed record)", async function () {
    const { registry } = await deploy();
    await expect(registry.get(ID_B))
      .to.be.revertedWithCustomError(registry, "UnknownId")
      .withArgs(ID_B);
  });

  it("enumerates all registered communities in order", async function () {
    const { registry, community } = await deploy();
    await registry.register(ID_A, record(community.address));
    await registry.register(ID_B, record(community.address, 30));
    expect(await registry.count()).to.equal(2n);
    expect(await registry.idAt(0)).to.equal(ID_A);
    expect(await registry.idAt(1)).to.equal(ID_B);
  });
});
