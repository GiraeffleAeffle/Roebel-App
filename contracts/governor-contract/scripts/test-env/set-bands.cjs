/**
 * Retune the signature thresholds of the test environment in one transaction each.
 *
 * Only possible because the test contracts are owned by the burner EOA rather than
 * the Attester Safe -- in production every one of these is a multi-sig ceremony.
 *
 *   --fast  every gate becomes 1-of-1. Fastest UI iteration loop.
 *   --prod  restore production-shaped percentage bands (the default deploy state).
 *
 * Usage:
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/set-bands.cjs --fast
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const CIT = [
  "function setAttestationBands((uint16,uint16,uint16),(uint16,uint16,uint16))",
  "function setRevocationBands((uint16,uint16,uint16),(uint16,uint16,uint16))",
  "function setRejectionBands((uint16,uint16,uint16),(uint16,uint16,uint16))",
];
const ATT = [
  "function setApprovalBand((uint16,uint16,uint16))",
  "function setRejectionBand((uint16,uint16,uint16))",
];

async function main() {
  L.assertTestEnvOptIn();
  const fast = process.argv.includes("--fast");
  const prod = process.argv.includes("--prod");
  if (fast === prod) throw new Error("Pass exactly one of --fast or --prod.");
  const B = fast ? L.FAST : L.PROD_SHAPED;

  const { manifest: m, burner } = await L.loadValidatedTestEnvironment();
  L.assertNotProduction(m.contracts.attesterNFTv2, m.contracts.citizenNFTv2);
  const cit = new ethers.Contract(m.contracts.citizenNFTv2, CIT, burner);
  const att = new ethers.Contract(m.contracts.attesterNFTv2, ATT, burner);
  const c = B.citizen;

  console.log(`applying ${fast ? "FAST (1-of-1)" : "PROD-SHAPED"} bands ...`);
  await (await att.setApprovalBand(B.attester.approval)).wait();
  await (await att.setRejectionBand(B.attester.rejection)).wait();
  await (
    await cit.setAttestationBands(c.attestationAttester, c.attestationCitizen)
  ).wait();
  await (
    await cit.setRevocationBands(c.revocationAttester, c.revocationCitizen)
  ).wait();
  await (
    await cit.setRejectionBands(c.rejectionAttester, c.rejectionCitizen)
  ).wait();

  m.bandProfile = fast ? "fast" : "prod-shaped";
  m.bands = B;
  L.saveManifest(m);
  console.log(
    "done. Manifest updated. Existing pending requests keep their snapshotted thresholds."
  );
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
