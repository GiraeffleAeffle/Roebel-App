// Deploys the CommunityRegistry (one per chain — unowned, no constructor args).
// Staged for the operator:
//   npx hardhat run scripts/deploy-community-registry.cjs --network gnosis
// Then record the address in docs and packages/blockchain, and verify.
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer — set DEPLOYER_PRIVATE_KEY in .env");
  console.log(`Deploying CommunityRegistry to ${hre.network.name} as ${deployer.address}`);

  const Registry = await hre.ethers.getContractFactory("CommunityRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log(`CommunityRegistry: ${address}`);
  console.log(`Verify: npx hardhat verify --network ${hre.network.name} ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
