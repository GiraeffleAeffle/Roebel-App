/**
 * Local rehearsal of the Roebel onchain test environment.
 *
 * Deploys the exact same contracts with the exact same constructor arguments the real
 * deploy uses, then drives both gates end to end with 5 co-signers:
 *
 *   join   -> applicant requests, 2 attesters + 1 citizen approve, NFT mints
 *   revoke -> co-signer requests, 4 attesters + 1 citizen approve, NFT burns
 *
 * Run this before spending real xDAI:
 *   npx hardhat run scripts/test-env/rehearse.cjs
 */
const hre = require("hardhat");
const L = require("./lib.cjs");

function ok(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("   ok:", msg);
}

async function main() {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const cos = signers.slice(1, 6); // 5 co-signers
  const applicant = signers[6]; // stands in for an app smart account
  const founders = cos.slice(0, 3).map((s) => s.address);
  const extra = cos.slice(3).map((s) => s.address);
  const B = L.PROD_SHAPED;

  console.log("=== rehearsal: deploying with production-shaped bands ===");
  const Att = await ethers.getContractFactory("AttesterNFTv2", owner);
  const att = await Att.deploy(
    owner.address,
    "Roebel TEST Attester",
    "tROEBEL-ATT",
    founders,
    B.attester.approval,
    B.attester.rejection
  );
  await att.waitForDeployment();

  const Cit = await ethers.getContractFactory("CitizenNFTv2", owner);
  const c = B.citizen;
  const cit = await Cit.deploy(
    await att.getAddress(),
    owner.address,
    founders,
    [
      c.attestationAttester,
      c.attestationCitizen,
      c.revocationAttester,
      c.revocationCitizen,
      c.rejectionAttester,
      c.rejectionCitizen,
    ],
    0
  );
  await cit.waitForDeployment();

  await (await att.migrationMint(extra)).wait();
  await (await cit.migrationMint(extra)).wait();
  ok(
    (await att.attesterCount()) === 5n,
    "attesterCount == 5 after migration-minting #4 and #5"
  );
  ok((await cit.citizenCount()) === 5n, "citizenCount  == 5");
  ok(
    (await att.migrationFinalized()) === false,
    "attester migration still OPEN (seed button intact)"
  );
  ok(
    (await cit.migrationFinalized()) === false,
    "citizen migration still OPEN"
  );

  // --- JOIN -------------------------------------------------------------------
  console.log("\n=== gate 1: citizenship request -> mint ===");
  const rc = await (
    await cit
      .connect(applicant)
      .createAttestationRequest("ipfs://test-evidence")
  ).wait();
  const joinId = 0n;
  const needAtt = await cit.requiredAttesterApprovalsFor(joinId);
  const needCit = await cit.requiredCitizenApprovalsFor(joinId);
  console.log(
    "   quorum: " + needAtt + " attester + " + needCit + " citizen signatures"
  );
  ok(needAtt + needCit <= 5n, "join quorum is reachable by 5 co-signers");

  for (let i = 0; i < Number(needAtt); i++)
    await (await cit.connect(cos[i]).approveRequest(joinId, true)).wait();
  ok(
    (await cit.hasCitizenNFT(applicant.address)) === false,
    "not minted yet after attester signatures alone"
  );
  for (let i = 0; i < Number(needCit); i++) {
    await (
      await cit.connect(cos[Number(needAtt) + i]).approveRequest(joinId, false)
    ).wait();
  }
  ok(
    (await cit.hasCitizenNFT(applicant.address)) === true,
    "CitizenNFT MINTED to the applicant"
  );
  ok((await cit.isActive(applicant.address)) === true, "applicant is active");

  // --- REVOKE -----------------------------------------------------------------
  console.log("\n=== gate 2: revocation request -> burn ===");
  await (
    await cit
      .connect(cos[0])
      .createRevocationRequest(applicant.address, "ipfs://test-revocation")
  ).wait();
  const revId = 1n;
  const rNeedAtt = await cit.requiredAttesterApprovalsFor(revId);
  const rNeedCit = await cit.requiredCitizenApprovalsFor(revId);
  console.log(
    "   quorum: " + rNeedAtt + " attester + " + rNeedCit + " citizen signatures"
  );
  ok(
    rNeedAtt + rNeedCit <= 5n,
    "revoke quorum is reachable by 5 co-signers (THE reason for 5)"
  );

  for (let i = 0; i < Number(rNeedAtt); i++)
    await (await cit.connect(cos[i]).approveRequest(revId, true)).wait();
  for (let i = 0; i < Number(rNeedCit); i++) {
    await (
      await cit.connect(cos[Number(rNeedAtt) + i]).approveRequest(revId, false)
    ).wait();
  }
  ok(
    (await cit.hasCitizenNFT(applicant.address)) === false,
    "CitizenNFT REVOKED"
  );

  console.log(
    "\n=== rehearsal passed: constructor args and quorum math are correct ==="
  );
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
