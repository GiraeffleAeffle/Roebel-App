/**
 * Show the current state of the onchain test environment: contracts, counts, live
 * thresholds, co-signer gas balances, and every pending request.
 *
 * Usage:
 *   node scripts/test-env/status.cjs [--whoami 0xaddress]
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const STATUS = ["Pending", "Approved", "Rejected", "Executed"];
const TYPE = ["Attestation", "Revocation"];

const CIT = [
  "function citizenCount() view returns (uint256)",
  "function requestCount() view returns (uint256)",
  "function migrationFinalized() view returns (bool)",
  "function owner() view returns (address)",
  "function getRequest(uint256) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 attesterSignatures, uint256 citizenSignatures, uint256 createdAt)",
  "function requiredAttesterApprovalsFor(uint256) view returns (uint256)",
  "function requiredCitizenApprovalsFor(uint256) view returns (uint256)",
  "function hasCitizenNFT(address) view returns (bool)",
  "function isActive(address) view returns (bool)",
];
const ATT = [
  "function attesterCount() view returns (uint256)",
  "function requestCount() view returns (uint256)",
  "function migrationFinalized() view returns (bool)",
  "function owner() view returns (address)",
  "function hasAttesterNFT(address) view returns (bool)",
];

async function main() {
  const m = L.loadManifest();
  const p = L.provider();
  await L.assertManifestRuntime(m, p);
  const cit = new ethers.Contract(m.contracts.citizenNFTv2, CIT, p);
  const att = new ethers.Contract(m.contracts.attesterNFTv2, ATT, p);

  console.log("=== Roebel ONCHAIN TEST ENV (Gnosis chain 100) ===");
  console.log("deployed      :", m.deployedAt, "| bands:", m.bandProfile);
  console.log("AttesterNFTv2 :", m.contracts.attesterNFTv2);
  console.log("CitizenNFTv2  :", m.contracts.citizenNFTv2);
  console.log("owner (burner):", await cit.owner());

  const [cc, ac, cFin, aFin] = await Promise.all([
    cit.citizenCount(),
    att.attesterCount(),
    cit.migrationFinalized(),
    att.migrationFinalized(),
  ]);
  console.log(
    `citizens: ${cc} | attesters: ${ac} | migration open: citizen=${!cFin} attester=${!aFin}`
  );
  if (cFin || aFin)
    console.log(
      "  WARNING: migration is finalized -- seeding no longer possible."
    );

  console.log("\nco-signer gas balances:");
  for (const address of m.cosigners) {
    const bal = await p.getBalance(address);
    const low = bal < ethers.parseEther("0.002");
    console.log(
      `  ${address}  ${ethers.formatEther(bal)} xDAI${low ? "   <-- LOW, top up" : ""}`
    );
  }

  const n = await cit.requestCount();
  console.log(`\ncitizen requests: ${n}`);
  for (let i = 0n; i < n; i++) {
    const r = await cit.getRequest(i);
    const s = Number(r.status);
    const [na, nc] =
      s === 0
        ? await Promise.all([
            cit.requiredAttesterApprovalsFor(i),
            cit.requiredCitizenApprovalsFor(i),
          ])
        : [0n, 0n];
    const quorum =
      s === 0
        ? ` att ${r.attesterSignatures}/${na}, cit ${r.citizenSignatures}/${nc}`
        : "";
    console.log(
      `  #${i} ${TYPE[Number(r.requestType)]} ${STATUS[s]} target=${r.target}${quorum}`
    );
    if (s === 0)
      console.log(
        `      complete it: ROEBEL_TEST_ENV=1 node scripts/test-env/cosign.cjs ${i}`
      );
  }

  const who = process.argv.includes("--whoami")
    ? process.argv[process.argv.indexOf("--whoami") + 1]
    : null;
  if (who) {
    const a = ethers.getAddress(who);
    console.log(`\n${a}:`);
    console.log(
      "  citizen :",
      await cit.hasCitizenNFT(a),
      "| active:",
      await cit.isActive(a)
    );
    console.log("  attester:", await att.hasAttesterNFT(a));
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
