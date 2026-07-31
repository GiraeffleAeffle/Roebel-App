/**
 * Registers an EXISTING deployment in the CommunityRegistry — the manual path
 * for communities that predate the Community Factory (Röbel itself). New
 * communities never need this: community-factory.cjs registers in stage C.
 *
 *   COMMUNITY_RECORD=deployments/roebel-registry-record.json \
 *     npx hardhat run scripts/register-existing-community.cjs --network gnosis
 *
 * The record's `controller` owns the entry from block one — the deployer never does.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const recPath = process.env.COMMUNITY_RECORD;
  if (!recPath) throw new Error("set COMMUNITY_RECORD=path/to/record.json");
  const rec = JSON.parse(fs.readFileSync(path.resolve(recPath), "utf8"));
  for (const k of ["slug", "registry", "manifestURI", "controller", "contracts"]) {
    if (!rec[k]) throw new Error(`record.${k} is required`);
  }

  const id = ethers.id(rec.slug);
  const registry = await ethers.getContractAt("CommunityRegistry", ethers.getAddress(rec.registry));
  const [deployer] = await ethers.getSigners();
  console.log(`Registering "${rec.slug}" (${id}) on ${network.name} as ${await deployer.getAddress()}`);

  const tx = await registry.register(id, {
    citizenNft: ethers.getAddress(rec.contracts.citizenNft),
    attesterNft: ethers.getAddress(rec.contracts.attesterNft),
    governor: ethers.getAddress(rec.contracts.governor),
    timelock: ethers.getAddress(rec.contracts.timelock),
    maci: ethers.getAddress(rec.contracts.maci),
    safe: ethers.getAddress(rec.contracts.safe),
    gatekeeper: rec.contracts.gatekeeper ? ethers.getAddress(rec.contracts.gatekeeper) : ethers.ZeroAddress,
    circlesGroup: rec.contracts.circlesGroup ? ethers.getAddress(rec.contracts.circlesGroup) : ethers.ZeroAddress,
    manifestURI: rec.manifestURI,
    controller: ethers.getAddress(rec.controller),
  });
  const receipt = await tx.wait();
  console.log("Registered in tx", receipt.hash);

  const stored = await registry.get(id);
  console.log("Readback: governor", stored.governor, "| controller", stored.controller, "| manifestURI", stored.manifestURI);
}

main().catch((e) => { console.error(e); process.exit(1); });
