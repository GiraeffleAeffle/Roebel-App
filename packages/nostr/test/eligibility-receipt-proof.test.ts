import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMunicipalCivicEligibilityReceiptProofVerifier,
  municipalCivicEligibilityReceiptProofPublicKey,
  signMunicipalCivicEligibilityReceiptProof,
  type MunicipalCivicEligibilityReceiptProofInputV1,
} from "../src/index";

test("an Ed25519 municipal issuer signs only the canonical closed receipt proof input", () => {
  const privateKey = new Uint8Array(32).fill(7);
  const keyId = "roebel-staging-eligibility-issuer-2026-09";
  const proofInput: MunicipalCivicEligibilityReceiptProofInputV1 = {
    domain: "municipal-civic-eligibility-receipt/v1",
    schemaVersion: "municipal_civic_eligibility_receipt_v1",
    receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${"a".repeat(64)}`,
    payloadChecksum: "a".repeat(64),
    statusRef: `https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility/status/${"a".repeat(64)}`,
  };

  const proof = signMunicipalCivicEligibilityReceiptProof(proofInput, {
    privateKey,
    keyId,
  });
  const verify = createMunicipalCivicEligibilityReceiptProofVerifier({
    publicKey: municipalCivicEligibilityReceiptProofPublicKey(privateKey),
    keyId,
  });

  assert.deepEqual(Object.keys(proof).sort(), ["algorithm", "keyId", "signature"]);
  assert.equal(proof.algorithm, "Ed25519");
  assert.equal(verify(proofInput, proof), true);
  assert.equal(
    verify({ ...proofInput, payloadChecksum: "b".repeat(64) }, proof),
    false,
  );
  assert.equal(verify(proofInput, { ...proof, keyId: `${keyId}-other` }), false);
});
