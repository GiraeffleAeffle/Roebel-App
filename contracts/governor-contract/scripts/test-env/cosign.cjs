/**
 * Complete a pending request in the test environment by signing as the co-signers.
 *
 * This is the script that makes solo testing work. You create the request from the app
 * as a normal user; this supplies the rest of the quorum. It works out how many
 * signatures are still missing in each role, picks co-signers that have not already
 * voted and are not the target of the request, and sends exactly that many transactions.
 *
 * Usage:
 *   ROEBEL_TEST_ENV=1 node scripts/test-env/cosign.cjs <requestId> [options]
 *
 *   --attester   act on the AttesterNFTv2 contract (default: CitizenNFTv2)
 *   --reject     reject instead of approve
 *   --dry-run    print the plan without sending anything
 */
const { ethers } = require("ethers");
const L = require("./lib.cjs");

const STATUS = ["Pending", "Approved", "Rejected", "Executed"];
const TYPE = ["Attestation", "Revocation"];

const CITIZEN_ABI = [
  "function getRequest(uint256) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 attesterSignatures, uint256 citizenSignatures, uint256 createdAt)",
  "function getRequestRejections(uint256) view returns (uint256 attesterRejections, uint256 citizenRejections)",
  "function requiredAttesterApprovalsFor(uint256) view returns (uint256)",
  "function requiredCitizenApprovalsFor(uint256) view returns (uint256)",
  "function requiredAttesterRejectionsFor(uint256) view returns (uint256)",
  "function requiredCitizenRejectionsFor(uint256) view returns (uint256)",
  "function hasApprovedRequest(uint256, address) view returns (bool)",
  "function hasRejectedRequest(uint256, address) view returns (bool)",
  "function approveRequest(uint256, bool)",
  "function rejectRequest(uint256, bool)",
  "function hasCitizenNFT(address) view returns (bool)",
];

const ATTESTER_ABI = [
  "function getRequest(uint256) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 signatureCount, uint256 createdAt)",
  "function getRequestRejections(uint256) view returns (uint256)",
  "function requiredApprovalsFor(uint256) view returns (uint256)",
  "function requiredRejectionsFor(uint256) view returns (uint256)",
  "function hasApprovedRequest(uint256, address) view returns (bool)",
  "function hasRejectedRequest(uint256, address) view returns (bool)",
  "function approveRequest(uint256)",
  "function rejectRequest(uint256)",
  "function hasAttesterNFT(address) view returns (bool)",
];

async function main() {
  L.assertTestEnvOptIn();
  const args = process.argv.slice(2);
  const requestId = args.find((a) => /^\d+$/.test(a));
  if (requestId === undefined)
    throw new Error("Pass a request id, e.g. cosign.cjs 0");
  const onAttester = args.includes("--attester");
  const reject = args.includes("--reject");
  const dry = args.includes("--dry-run");

  const { manifest: m, provider: p } = await L.loadValidatedTestEnvironment();
  const addr = onAttester
    ? m.contracts.attesterNFTv2
    : m.contracts.citizenNFTv2;
  L.assertNotProduction(addr);

  const wallets = L.deriveCosigners(m.cosigners.length).map((w) =>
    w.connect(p)
  );
  const abi = onAttester ? ATTESTER_ABI : CITIZEN_ABI;
  const read = new ethers.Contract(addr, abi, p);

  const req = await read.getRequest(requestId);
  console.log(
    `=== ${onAttester ? "AttesterNFTv2" : "CitizenNFTv2"} request #${requestId} ===`
  );
  console.log("contract :", addr);
  console.log("type     :", TYPE[Number(req.requestType)]);
  console.log("status   :", STATUS[Number(req.status)]);
  console.log("target   :", req.target);
  if (Number(req.status) !== 0) {
    console.log("\nNothing to do -- request is not Pending.");
    return;
  }

  // Work out what is still missing, per role.
  let plan = []; // { wallet, asAttester }
  const eligible = [];
  for (const w of wallets) {
    const [approved, rejected] = await Promise.all([
      read.hasApprovedRequest(requestId, w.address),
      read.hasRejectedRequest(requestId, w.address),
    ]);
    // The contract forbids the target of a request from voting on it.
    if (
      approved ||
      rejected ||
      w.address.toLowerCase() === req.target.toLowerCase()
    )
      continue;
    eligible.push(w);
  }

  if (onAttester) {
    const need = reject
      ? await read.requiredRejectionsFor(requestId)
      : await read.requiredApprovalsFor(requestId);
    const have = reject
      ? await read.getRequestRejections(requestId)
      : req.signatureCount;
    const missing = Number(need) - Number(have);
    console.log(
      `quorum   : ${have}/${need} ${reject ? "rejections" : "approvals"}`
    );
    plan = eligible
      .slice(0, Math.max(0, missing))
      .map((w) => ({ wallet: w, asAttester: true }));
    if (plan.length < missing)
      throw new Error(
        `Need ${missing} more signatures but only ${eligible.length} co-signers are eligible.`
      );
  } else {
    const [needA, needC] = reject
      ? await Promise.all([
          read.requiredAttesterRejectionsFor(requestId),
          read.requiredCitizenRejectionsFor(requestId),
        ])
      : await Promise.all([
          read.requiredAttesterApprovalsFor(requestId),
          read.requiredCitizenApprovalsFor(requestId),
        ]);
    const [haveA, haveC] = reject
      ? await read.getRequestRejections(requestId)
      : [req.attesterSignatures, req.citizenSignatures];
    const missA = Math.max(0, Number(needA) - Number(haveA));
    const missC = Math.max(0, Number(needC) - Number(haveC));
    console.log(
      `quorum   : attester ${haveA}/${needA}, citizen ${haveC}/${needC}`
    );
    if (missA + missC > eligible.length) {
      throw new Error(
        `Need ${missA + missC} more distinct signers but only ${eligible.length} co-signers are eligible. ` +
          `A wallet counts toward exactly one role, so mint more co-signers or relax bands with set-bands.cjs --fast.`
      );
    }
    plan = [
      ...eligible.slice(0, missA).map((w) => ({ wallet: w, asAttester: true })),
      ...eligible
        .slice(missA, missA + missC)
        .map((w) => ({ wallet: w, asAttester: false })),
    ];
  }

  if (plan.length === 0) {
    console.log("\nQuorum already met -- nothing to send.");
    return;
  }
  console.log(`\nplan: ${plan.length} transaction(s)`);
  for (const s of plan)
    console.log(
      `  ${s.wallet.address} signs as ${s.asAttester ? "ATTESTER" : "CITIZEN"}`
    );
  if (dry) {
    console.log("\n--dry-run: nothing sent.");
    return;
  }

  for (const s of plan) {
    const c = new ethers.Contract(addr, abi, s.wallet);
    const tx = reject
      ? onAttester
        ? await c.rejectRequest(requestId)
        : await c.rejectRequest(requestId, s.asAttester)
      : onAttester
        ? await c.approveRequest(requestId)
        : await c.approveRequest(requestId, s.asAttester);
    await tx.wait();
    console.log("  sent:", tx.hash);
  }

  const after = await read.getRequest(requestId);
  console.log("\nfinal status:", STATUS[Number(after.status)]);
  if (!onAttester && Number(after.requestType) === 0) {
    console.log(
      "target has CitizenNFT:",
      await read.hasCitizenNFT(after.target)
    );
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
