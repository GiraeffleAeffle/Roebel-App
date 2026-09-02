/**
 * Mint a test identity directly, bypassing the whole request/approval dance.
 *
 * Only possible because this environment never calls finalizeMigration(), so
 * migrationMint stays owner-callable forever. Use it to promote an app login to
 * citizen or attester so you can test the *approver's* side of the UI, or to set up
 * a scenario without clicking through it first.
 *
 * The address you pass is normally your app SMART ACCOUNT address, not an EOA --
 * that is the address the app holds the NFT with. Read it from the staging Supabase
 * `users.wallet_address` row after logging in, or from `status.cjs --whoami`.
 *
 * Usage:
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/seed-identity.cjs <0xaddress> [--citizen] [--attester]
 *   (defaults to --citizen if neither is given)
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const ABI = [
  "function migrationMint(address[])",
  "function migrationFinalized() view returns (bool)",
  "function hasCitizenNFT(address) view returns (bool)",
  "function hasAttesterNFT(address) view returns (bool)",
  "function citizenCount() view returns (uint256)",
  "function attesterCount() view returns (uint256)",
];

async function main() {
  L.assertTestEnvOptIn();
  const args = process.argv.slice(2);
  const target = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  if (!target)
    throw new Error(
      "Pass an address: seed-identity.cjs 0x... [--citizen] [--attester]"
    );
  const wantAttester = args.includes("--attester");
  const wantCitizen = args.includes("--citizen") || !wantAttester;

  const {
    manifest: m,
    provider: p,
    burner,
  } = await L.loadValidatedTestEnvironment();
  const addr = ethers.getAddress(target);

  for (const [role, contractAddr, want] of [
    ["citizen", m.contracts.citizenNFTv2, wantCitizen],
    ["attester", m.contracts.attesterNFTv2, wantAttester],
  ]) {
    if (!want) continue;
    L.assertNotProduction(contractAddr);
    const c = new ethers.Contract(contractAddr, ABI, burner);
    if (await c.migrationFinalized()) {
      throw new Error(
        `${role} migration is FINALIZED -- this environment can no longer seed. Redeploy.`
      );
    }
    const already =
      role === "citizen"
        ? await c.hasCitizenNFT(addr)
        : await c.hasAttesterNFT(addr);
    if (already) {
      console.log(`${addr} already holds the ${role} NFT -- skipping`);
      continue;
    }

    const tx = await c.migrationMint([addr]);
    await tx.wait();
    const count =
      role === "citizen" ? await c.citizenCount() : await c.attesterCount();
    console.log(
      `minted ${role} NFT to ${addr}  (tx ${tx.hash}, ${role}Count now ${count})`
    );

    // Minting attesters raises attesterCount, which raises every percentage-band
    // quorum. Past ~7 the 5 co-signers can no longer satisfy a revocation.
    if (role === "attester" && count > 7n) {
      console.log(
        `  WARNING: attesterCount is ${count}. Revocation now needs more signatures than`
      );
      console.log(
        `  the 5 co-signers can supply. Relax bands: node scripts/test-env/set-bands.cjs --fast`
      );
    }
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
