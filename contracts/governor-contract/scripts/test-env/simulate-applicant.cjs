/**
 * Simulate an applicant creating a citizenship request, without opening the app.
 *
 * Useful as a smoke test of the deployed environment, and for testing the APPROVER
 * side of the UI: run this to manufacture a pending request, then approve it from the
 * app as an attester. The applicant is a throwaway EOA derived from the burner key,
 * so it is reproducible and needs no key management.
 *
 * Usage:
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/simulate-applicant.cjs [--index N]
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const ABI = [
  "function createAttestationRequest(string) returns (uint256)",
  "function requestCount() view returns (uint256)",
  "function hasCitizenNFT(address) view returns (bool)",
];

function deriveApplicant(index) {
  const child = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "string", "uint256"],
      [L.burnerKey(), "roebel-onchain-test-env/applicant/v1", index]
    )
  );
  return new ethers.Wallet(child);
}

async function main() {
  L.assertTestEnvOptIn();
  const i = process.argv.includes("--index")
    ? Number(process.argv[process.argv.indexOf("--index") + 1])
    : 1;
  const {
    manifest: m,
    provider: p,
    burner,
  } = await L.loadValidatedTestEnvironment();
  const applicant = deriveApplicant(i).connect(p);

  console.log(
    "applicant EOA:",
    applicant.address,
    "(derived, index " + i + ")"
  );
  const c = new ethers.Contract(m.contracts.citizenNFTv2, ABI, applicant);
  if (await c.hasCitizenNFT(applicant.address)) {
    console.log(
      "This applicant already holds a CitizenNFT. Use --index N for a fresh one."
    );
    return;
  }

  const bal = await p.getBalance(applicant.address);
  if (bal < ethers.parseEther("0.002")) {
    console.log("funding applicant with 0.005 xDAI ...");
    await (
      await burner.sendTransaction({
        to: applicant.address,
        value: ethers.parseEther("0.005"),
      })
    ).wait();
  }

  const before = await c.requestCount();
  const tx = await c.createAttestationRequest(`ipfs://smoke-test-${i}`);
  await tx.wait();
  const id = before;
  console.log("created citizenship request #" + id, "(tx " + tx.hash + ")");
  console.log("\ncomplete it with:");
  console.log("  ROEBEL_TEST_ENV=1 node scripts/test-env/cosign.cjs " + id);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
